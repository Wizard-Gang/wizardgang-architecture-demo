import type { Env } from '../types';
import { recordDemoEvent } from '../lib/audit';
import { requireSameOrigin } from '../lib/admin-auth';
import { ensureDemoSession, withDemoSession, type DemoSession } from '../lib/demo-session';
import { HttpError, errorResponse, json, methodNotAllowed } from '../lib/http';
import { COLLECTIONS, TTL_SECONDS, demoRecords } from '../lib/storage';

const encoder = new TextEncoder();
const GITHUB_EVENTS = new Set(['ping', 'push', 'pull_request', 'workflow_run', 'release']);
const MAX_PAYLOAD_BYTES = 262_144;

interface GitHubPayload {
  action?: unknown;
  after?: unknown;
  head_commit?: { id?: unknown; message?: unknown; url?: unknown };
  hook?: { type?: unknown };
  pull_request?: { html_url?: unknown; number?: unknown; title?: unknown; user?: { login?: unknown } };
  pusher?: { name?: unknown };
  ref?: unknown;
  release?: { html_url?: unknown; name?: unknown; tag_name?: unknown };
  repository?: { full_name?: unknown; html_url?: unknown };
  sender?: { login?: unknown };
  workflow_run?: { conclusion?: unknown; html_url?: unknown; name?: unknown; status?: unknown };
  zen?: unknown;
}

// One verified delivery in the shared records table, keyed by its delivery ID so a replay is refused. GitHub
// deliveries are owned by 'github'; lab deliveries by the visitor's sandbox session and expire with it.
interface WebhookDelivery {
  provider: 'demo' | 'github';
  deliveryId: string;
  eventType: string;
  action: string | null;
  repository: string | null;
  actor: string | null;
  summary: unknown;
  payloadSha256: string;
  receivedAt: string;
}

const GITHUB_OWNER = 'github';

function text(value: unknown, maximum = 160): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

async function sha256(payload: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(payload)));
}

function validDeliveryId(value: string | null): value is string {
  return Boolean(value && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(value));
}

async function verifySignature(secret: string, payload: string, signature: string): Promise<boolean> {
  const expected = await hmac(secret, payload);
  if (!/^[0-9a-f]{64}$/.test(signature) || expected.length !== signature.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return difference === 0;
}

function configuredRepository(env: Env): string {
  try {
    const url = new URL(env.GITHUB_REPO_URL);
    if (url.hostname !== 'github.com') return '';
    return url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  } catch {
    return '';
  }
}

async function boundedBody(request: Request, maximum = MAX_PAYLOAD_BYTES): Promise<string> {
  const declared = Number(request.headers.get('content-length') || '0');
  if (declared > maximum) throw new HttpError(413, 'request_body_too_large');
  const payload = await request.text();
  if (encoder.encode(payload).byteLength > maximum) throw new HttpError(413, 'request_body_too_large');
  return payload;
}

function summaryFor(eventType: string, payload: GitHubPayload): { action: string | null; actor: string | null; summary: Record<string, string | number | null> } {
  const action = text(payload.action, 60);
  const actor = text(payload.sender?.login ?? payload.pusher?.name ?? payload.pull_request?.user?.login, 80);
  if (eventType === 'ping') return { action: null, actor, summary: { message: text(payload.zen, 180), hookType: text(payload.hook?.type, 40) } };
  if (eventType === 'push') return { action: 'pushed', actor, summary: { ref: text(payload.ref, 180), after: text(payload.after, 64), commitId: text(payload.head_commit?.id, 64), commitMessage: text(payload.head_commit?.message, 220), url: text(payload.head_commit?.url, 400) } };
  if (eventType === 'pull_request') return { action, actor, summary: { number: number(payload.pull_request?.number), title: text(payload.pull_request?.title, 220), url: text(payload.pull_request?.html_url, 400) } };
  if (eventType === 'workflow_run') return { action, actor, summary: { name: text(payload.workflow_run?.name, 160), status: text(payload.workflow_run?.status, 40), conclusion: text(payload.workflow_run?.conclusion, 40), url: text(payload.workflow_run?.html_url, 400) } };
  return { action, actor, summary: { tag: text(payload.release?.tag_name, 120), name: text(payload.release?.name, 180), url: text(payload.release?.html_url, 400) } };
}

function parsedJson(payload: string): GitHubPayload {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed as GitHubPayload;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

async function acceptGitHubShape(request: Request, env: Env, options: { provider: 'demo' | 'github'; secret: string; sessionId?: string }): Promise<Response> {
  const eventType = request.headers.get('x-github-event') || '';
  const deliveryId = request.headers.get('x-github-delivery');
  const signatureHeader = request.headers.get('x-hub-signature-256') || '';
  if (!GITHUB_EVENTS.has(eventType)) throw new HttpError(400, 'unsupported_github_event');
  if (!validDeliveryId(deliveryId)) throw new HttpError(400, 'invalid_delivery_id');
  if (!/^sha256=[0-9a-f]{64}$/.test(signatureHeader)) return json({ error: 'invalid_signature' }, { status: 401 });
  const payloadText = await boundedBody(request);
  if (!(await verifySignature(options.secret, payloadText, signatureHeader.slice('sha256='.length)))) return json({ error: 'invalid_signature' }, { status: 401 });
  const payload = parsedJson(payloadText);
  const expectedRepository = configuredRepository(env);
  const repository = text(payload.repository?.full_name, 180);
  if (!expectedRepository || repository?.toLowerCase() !== expectedRepository.toLowerCase()) throw new HttpError(403, 'repository_not_allowed');
  const receivedAt = new Date().toISOString();
  const digest = await sha256(payloadText);
  const { action, actor, summary } = summaryFor(eventType, payload);
  const deliveries = demoRecords(env);
  if (await deliveries.get(COLLECTIONS.webhookDeliveries, deliveryId)) return json({ error: 'duplicate_delivery', deliveryId }, { status: 409 });
  const delivery: WebhookDelivery = { provider: options.provider, deliveryId, eventType, action, repository, actor, summary, payloadSha256: digest, receivedAt };
  await deliveries.put(COLLECTIONS.webhookDeliveries, deliveryId, delivery, options.provider === 'github'
    ? { owner: GITHUB_OWNER, ttlSeconds: TTL_SECONDS.githubDelivery }
    : { owner: options.sessionId ?? GITHUB_OWNER, ttlSeconds: TTL_SECONDS.sandbox });
  const event = await recordDemoEvent(env, 'webhooks', `${options.provider}_webhook_received`, { provider: options.provider, eventType, deliveryId, repository, payloadSha256: digest });
  return json({ accepted: true, provider: options.provider, deliveryId, eventType, action, repository, actor, summary, receivedAt, payloadSha256: digest, auditEventId: event.id }, { status: 202, headers: { 'cache-control': 'no-store' } });
}

export async function githubWebhookResponse(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  try {
    if (!env.GITHUB_WEBHOOK_SECRET) return json({ error: 'github_webhook_not_configured' }, { status: 503 });
    return await acceptGitHubShape(request, env, { provider: 'github', secret: env.GITHUB_WEBHOOK_SECRET });
  } catch (error) {
    return errorResponse(error);
  }
}

function attach(response: Response, session: DemoSession | undefined): Response {
  return session ? withDemoSession(response, session) : response;
}

export async function webhookDemoResponse(request: Request, env: Env): Promise<Response> {
  let session: DemoSession | undefined;
  try {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    const originFailure = requireSameOrigin(request);
    if (originFailure) return originFailure;
    if (!env.DEMO_WEBHOOK_SECRET) return json({ error: 'webhook_demo_not_configured' }, { status: 503 });
    session = await ensureDemoSession(request, env);
    const deliveryId = `visitor-${crypto.randomUUID()}`;
    const repository = configuredRepository(env);
    const version = env.DEPLOYED_VERSION || 'development';
    const payload = JSON.stringify({
      action: 'published',
      release: { tag_name: `v${version.replace(/^v/, '')}`, name: `WizardGang architecture demo ${version}`, html_url: `${env.GITHUB_REPO_URL}/releases` },
      repository: { full_name: repository, html_url: env.GITHUB_REPO_URL },
      sender: { login: 'wizardgang-release-bot' },
    });
    const response = await acceptGitHubShape(new Request(new URL('/webhooks/github', request.url), {
      method: 'POST', body: payload, headers: {
        'content-type': 'application/json',
        'x-github-delivery': deliveryId,
        'x-github-event': 'release',
        'x-hub-signature-256': `sha256=${await hmac(env.DEMO_WEBHOOK_SECRET, payload)}`,
      },
    }), env, { provider: 'demo', secret: env.DEMO_WEBHOOK_SECRET, sessionId: session.id });
    return attach(response, session);
  } catch (error) {
    return attach(errorResponse(error), session);
  }
}

function visibleEvent(delivery: WebhookDelivery): Record<string, unknown> {
  const { provider, deliveryId, eventType, action, repository, actor, summary, receivedAt } = delivery;
  return { provider, deliveryId, eventType, action, repository, actor, summary, receivedAt };
}

async function deliveriesOwnedBy(env: Env, owner: string): Promise<WebhookDelivery[]> {
  return (await demoRecords(env).list<WebhookDelivery>(COLLECTIONS.webhookDeliveries, { owner, limit: 1000 })).map((row) => row.body);
}

export async function webhookEventsResponse(request: Request, env: Env): Promise<Response> {
  let session: DemoSession | undefined;
  try {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    session = await ensureDemoSession(request, env);
    const repository = configuredRepository(env);
    const [own, github] = await Promise.all([deliveriesOwnedBy(env, session.id), deliveriesOwnedBy(env, GITHUB_OWNER)]);
    const events = [...own, ...github.filter((delivery) => delivery.repository === repository)]
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
      .slice(0, 25);
    return attach(json({ events: events.map(visibleEvent), pollingIntervalMs: 2000, repository }, { headers: { 'cache-control': 'no-store' } }), session);
  } catch (error) {
    return attach(errorResponse(error), session);
  }
}

export async function webhookResetResponse(request: Request, env: Env): Promise<Response> {
  let session: DemoSession | undefined;
  try {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    const originFailure = requireSameOrigin(request);
    if (originFailure) return originFailure;
    session = await ensureDemoSession(request, env);
    for (const delivery of await deliveriesOwnedBy(env, session.id)) {
      if (delivery.provider === 'demo') await demoRecords(env).delete(COLLECTIONS.webhookDeliveries, delivery.deliveryId);
    }
    await recordDemoEvent(env, 'webhooks', 'visitor_webhooks_reset', { scope: 'session_demo_events' });
    return attach(json({ reset: true }, { headers: { 'cache-control': 'no-store' } }), session);
  } catch (error) {
    return attach(errorResponse(error), session);
  }
}

export { hmac as signWebhookForTest };
