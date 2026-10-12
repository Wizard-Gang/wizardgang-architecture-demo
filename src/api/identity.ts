import { SAML, ValidateInResponseTo, type CacheItem, type CacheProvider, type Profile } from '@node-saml/node-saml';
import { DOMParser } from '@xmldom/xmldom';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Env } from '../types';
import { recordDemoEvent } from '../lib/audit';
import { HttpError, errorResponse, json, methodNotAllowed, readJson } from '../lib/http';
import {
  IDENTITY_SESSION_COOKIE,
  IDENTITY_FLOW_COOKIE,
  SAML_FLOW_COOKIE,
  clearFlowCookie,
  clearIdentityCookie,
  createDemoAccessToken,
  createIdentitySession,
  identityConfigured,
  identitySubjectAuditId,
  identityReadiness,
  randomValue,
  readFlowCookie,
  readIdentitySession,
  revokeIdentitySession,
  sha256,
  writeFlowCookie,
  type ApplicationRole,
  type IdentityAssurance,
  type IdentityFlow,
  type IdentityProvider,
  type IdentitySession,
  type IdentityValidation,
  type NormalizedIdentity,
} from '../lib/identity-session';
import { principalFromIdentitySession } from '../lib/authorization';
import { COLLECTIONS, demoRecords, secondsUntil } from '../lib/storage';

const encoder = new TextEncoder();
const OIDC_PROVIDERS = new Set<IdentityProvider>(['microsoft', 'google']);
const SESSION_SECONDS = 30 * 60;
const FLOW_SECONDS = 10 * 60;
const MAX_PROVIDER_RESPONSE_BYTES = 1_000_000;

interface ProviderConfiguration {
  configured: boolean;
  label: string;
  protocol: string;
  startPath: string;
}

interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface AuthorizationInput { requestedAction?: unknown }

class IdentityError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function nonEmpty(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function identityProviderConfiguration(env: Env): Record<string, ProviderConfiguration> {
  const session = identityConfigured(env);
  return {
    microsoft: {
      configured: session && nonEmpty(env.MICROSOFT_OAUTH_CLIENT_ID) && nonEmpty(env.MICROSOFT_OAUTH_CLIENT_SECRET) && nonEmpty(env.MICROSOFT_TENANT_ID),
      label: 'Microsoft Entra ID', protocol: 'OpenID Connect / OAuth 2.0', startPath: '/auth/microsoft',
    },
    saml: {
      configured: session && nonEmpty(env.MICROSOFT_TENANT_ID) && nonEmpty(env.SAML_IDP_CERT),
      label: 'Microsoft Entra ID', protocol: 'SAML 2.0', startPath: '/auth/saml',
    },
    google: {
      configured: session && nonEmpty(env.GOOGLE_OAUTH_CLIENT_ID) && nonEmpty(env.GOOGLE_OAUTH_CLIENT_SECRET),
      label: 'Google', protocol: 'OpenID Connect', startPath: '/auth/google',
    },
    github: {
      configured: session && nonEmpty(env.GITHUB_OAUTH_CLIENT_ID) && nonEmpty(env.GITHUB_OAUTH_CLIENT_SECRET),
      label: 'GitHub', protocol: 'OAuth 2.0', startPath: '/auth/github',
    },
  };
}

function identityUnavailableResponse(headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('cache-control', 'no-store');
  responseHeaders.set('retry-after', '30');
  return json({ error: 'identity_not_configured' }, { status: 503, headers: responseHeaders });
}

async function requireIdentityReadiness(env: Env): Promise<Response | null> {
  return await identityReadiness(env) === 'ready' ? null : identityUnavailableResponse();
}

function redirect(location: URL, cookies: string[] = []): Response {
  const headers = new Headers({ location: location.toString(), 'cache-control': 'no-store' });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(null, { status: 303, headers });
}

async function identityRedirect(request: Request, parameters: Record<string, string>, cookies: string[] = []): Promise<Response> {
  const { routeUrl } = await import('../routing/application-routes');
  const provider = parameters.provider ?? parameters.authenticated;
  const demo = provider === 'saml' ? 'saml' : provider === 'microsoft' || provider === 'google' ? 'sso' : 'oauth';
  const location = new URL(`${routeUrl('demos.index')}?demo=${demo}#${demo}`, request.url);
  for (const [key, value] of Object.entries(parameters)) location.searchParams.set(key, value);
  return redirect(location, cookies);
}

function callbackUrl(request: Request, provider: IdentityProvider): string {
  return new URL(`/auth/${provider}/callback`, request.url).toString();
}

function samlEntityId(request: Request): string {
  return new URL('/auth/saml', request.url).toString();
}

function samlCallbackUrl(request: Request): string {
  return new URL('/auth/saml/acs', request.url).toString();
}

async function equalValue(left: string, right: string): Promise<boolean> {
  const [a, b] = [encoder.encode(left), encoder.encode(right)];
  let mismatch = a.byteLength ^ b.byteLength;
  const length = Math.max(a.byteLength, b.byteLength);
  for (let index = 0; index < length; index += 1) mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return mismatch === 0;
}

function trustedUrl(value: unknown, hosts: string[]): string {
  if (typeof value !== 'string') throw new IdentityError('invalid_provider_metadata');
  const exact = value.trim();
  const url = new URL(exact);
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname)) throw new IdentityError('untrusted_provider_endpoint');
  return exact;
}

async function providerJson(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  if (!response.ok || encoder.encode(text).byteLength > MAX_PROVIDER_RESPONSE_BYTES) throw new IdentityError('provider_request_failed');
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new IdentityError('invalid_provider_response');
  }
}

async function oidcMetadata(provider: 'microsoft' | 'google', env: Env): Promise<OidcMetadata> {
  const discoveryUrl = provider === 'microsoft'
    ? `https://login.microsoftonline.com/${encodeURIComponent(env.MICROSOFT_TENANT_ID?.trim() || '')}/v2.0/.well-known/openid-configuration`
    : 'https://accounts.google.com/.well-known/openid-configuration';
  const raw = await providerJson(discoveryUrl, { headers: { accept: 'application/json' } });
  const allowedHosts = provider === 'microsoft'
    ? ['login.microsoftonline.com']
    : ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'];
  return {
    issuer: trustedUrl(raw.issuer, provider === 'microsoft' ? ['login.microsoftonline.com'] : ['accounts.google.com']),
    authorization_endpoint: trustedUrl(raw.authorization_endpoint, allowedHosts),
    token_endpoint: trustedUrl(raw.token_endpoint, allowedHosts),
    jwks_uri: trustedUrl(raw.jwks_uri, allowedHosts),
  };
}

function clientCredentials(provider: IdentityProvider, env: Env): { id: string; secret: string } {
  const pair = provider === 'microsoft'
    ? [env.MICROSOFT_OAUTH_CLIENT_ID, env.MICROSOFT_OAUTH_CLIENT_SECRET]
    : provider === 'google'
      ? [env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET]
      : [env.GITHUB_OAUTH_CLIENT_ID, env.GITHUB_OAUTH_CLIENT_SECRET];
  if (!pair[0] || !pair[1]) throw new IdentityError('provider_not_configured');
  return { id: pair[0], secret: pair[1] };
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier)));
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function safePayload(payload: JWTPayload, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string') result[key] = value.slice(0, 500);
    else if (typeof value === 'number' || typeof value === 'boolean') result[key] = value;
    else if (Array.isArray(value)) result[key] = value.filter((item) => typeof item === 'string').slice(0, 20).map((item) => item.slice(0, 200));
  }
  return result;
}

function stringClaim(payload: JWTPayload, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 500);
  }
  return undefined;
}

function stringClaims(payload: JWTPayload, key: string): string[] {
  const value = payload[key];
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isEmail(value: string | undefined): value is string {
  return Boolean(value && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

function roleFrom(values: string[]): ApplicationRole {
  return values.some((value) => ['operator', 'demo.operator'].includes(value.toLowerCase())) ? 'operator' : 'viewer';
}

function oidcSession(provider: 'microsoft' | 'google', payload: JWTPayload): IdentitySession {
  const issuedAt = new Date(Number(payload.iat) * 1000).toISOString();
  const expiresAt = new Date(Number(payload.exp) * 1000).toISOString();
  const emailCandidate = stringClaim(payload, 'email', 'preferred_username');
  const email = isEmail(emailCandidate) ? emailCandidate : undefined;
  const roles = stringClaims(payload, 'roles');
  const amr = stringClaims(payload, 'amr');
  const identity: NormalizedIdentity = {
    provider, protocol: 'oidc', subject: String(payload.sub),
    ...(email ? { email } : {}),
    ...(typeof payload.email_verified === 'boolean' ? { emailVerified: payload.email_verified } : {}),
    displayName: stringClaim(payload, 'name') || email || `${provider} user`,
    ...(provider === 'microsoft' && stringClaim(payload, 'tid') ? { organization: stringClaim(payload, 'tid') } : {}),
    assurance: provider === 'microsoft' && amr.some((value) => value.toLowerCase() === 'mfa') ? 'mfa' : 'provider-authenticated',
    role: provider === 'microsoft' ? roleFrom(roles) : 'viewer',
    authenticatedAt: typeof payload.auth_time === 'number' ? new Date(payload.auth_time * 1000).toISOString() : issuedAt,
    expiresAt,
  };
  const providerPayload = provider === 'microsoft'
    ? safePayload(payload, ['iss', 'aud', 'sub', 'tid', 'oid', 'name', 'preferred_username', 'email', 'email_verified', 'amr', 'acr', 'roles', 'auth_time', 'iat', 'exp'])
    : safePayload(payload, ['iss', 'aud', 'azp', 'sub', 'email', 'email_verified', 'name', 'picture', 'auth_time', 'iat', 'exp']);
  const validation: IdentityValidation[] = [
    { key: 'state', label: 'State', status: 'valid', detail: 'Matched the encrypted browser flow.' },
    { key: 'nonce', label: 'Nonce', status: 'valid', detail: 'Matched the validated ID token.' },
    { key: 'pkce', label: 'PKCE', status: 'valid', detail: 'S256 verifier was sent only from the Worker.' },
    { key: 'signature', label: 'Signature', status: 'valid', detail: 'Verified against the provider JWKS.' },
    { key: 'issuer', label: 'Issuer', status: 'valid', detail: 'Matched provider discovery metadata.' },
    { key: 'audience', label: 'Audience', status: 'valid', detail: 'Matched this application client ID.' },
    { key: 'expiration', label: 'Expiration', status: 'valid', detail: 'Token is within its validity window.' },
  ];
  return {
    identity, providerPayloadLabel: 'Validated ID token claims', providerPayload, validation,
    protocol: { name: 'Authorization Code + PKCE / OpenID Connect', steps: ['State, nonce, and S256 challenge generated', 'Authorization code received', 'State and PKCE validated server-side', 'ID token signature and claims validated', 'Provider claims normalized', 'WizardGang session issued'] },
    issuedAt, expiresAt,
  };
}

function providerProtocol(provider: IdentityProvider | 'saml'): string {
  return provider === 'saml' ? 'saml2' : provider === 'github' ? 'oauth2' : 'oidc';
}

async function auditIdentity(env: Env, eventType: string, provider: IdentityProvider | 'saml', detail: Record<string, unknown> = {}): Promise<void> {
  const normalizedProvider = provider === 'saml' ? 'microsoft' : provider;
  await recordDemoEvent(env, 'identity', `identity.${eventType}`, { provider: normalizedProvider, protocol: providerProtocol(provider), ...detail });
}

async function auditFailure(env: Env, provider: IdentityProvider | 'saml', reason: string): Promise<void> {
  try { await auditIdentity(env, 'authentication_failed', provider, { reason }); } catch { /* Authentication remains failed closed. */ }
}

export async function authorizationDecisionResponse(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  const unavailable = await requireIdentityReadiness(env);
  if (unavailable) return unavailable;
  try {
    const session = await readIdentitySession(request, env);
    if (!session) throw new HttpError(401, 'authentication_required');
    if (request.headers.get('origin') !== new URL(request.url).origin) throw new HttpError(403, 'same_origin_required');
    const body = await readJson<AuthorizationInput>(request, 1024);
    const action = body.requestedAction === 'demo:write' ? 'demo:write' : body.requestedAction === 'demo:read' ? 'demo:read' : null;
    if (!action) throw new HttpError(400, 'invalid_requested_action');
    const { identity } = session;
    const principal = await principalFromIdentitySession(env, session);
    const allowed = principal.permissions.includes(action);
    const eventType = allowed ? 'authorization_allowed' : 'authorization_denied';
    const event = await recordDemoEvent(env, 'identity', `identity.${eventType}`, { subjectAuditId: await identitySubjectAuditId(env, identity.provider, identity.subject), provider: identity.provider, assurance: identity.assurance, role: identity.role, action });
    return json({ identity: { provider: identity.provider, displayName: identity.displayName, assurance: identity.assurance, role: identity.role }, principal, authorization: { requestedAction: action, decision: allowed ? 'allow' : 'deny', policy: 'Authenticated identities receive demo:read and visitor-sandbox demo:write. Application writes remain scoped to the server-derived visitor sandbox.' }, separation: 'Authentication established the identity. Application policy independently decided the permitted action and data scope.', auditEventId: event.id }, { status: allowed ? 200 : 403, headers: { 'cache-control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}

export async function demoAccessTokenResponse(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  const unavailable = await requireIdentityReadiness(env);
  if (unavailable) return unavailable;
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin) throw new HttpError(403, 'same_origin_required');
    const session = await readIdentitySession(request, env);
    if (!session) throw new HttpError(401, 'authentication_required');
    const { token, claims } = await createDemoAccessToken(env, session);
    const subjectAuditId = await identitySubjectAuditId(env, session.identity.provider, session.identity.subject);
    await recordDemoEvent(env, 'identity', 'identity.demo_access_token_issued', {
      subjectAuditId, provider: claims.provider, permissions: claims.permissions, namespace: claims.namespace, expiresAt: claims.expiresAt,
    });
    return json({ tokenType: 'Bearer', accessToken: token, ...claims, sandboxLabel: 'Your API sandbox' }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}

export async function identitySessionResponse(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  const unavailable = await requireIdentityReadiness(env);
  if (unavailable) return unavailable;
  const session = await readIdentitySession(request, env);
  return json({ authenticated: Boolean(session), providers: identityProviderConfiguration(env), ...(session ? { session } : {}) }, { headers: { 'cache-control': 'no-store' } });
}

export async function identityLogoutResponse(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return json({ error: 'same_origin_required' }, { status: 403, headers: { 'cache-control': 'no-store' } });

  // Both identity keys derive from WG_SESSION_KEY, so they are available together or not at all.
  const ready = await identityReadiness(env) === 'ready';
  const headers = new Headers({ 'cache-control': 'no-store' });
  headers.append('set-cookie', clearIdentityCookie(IDENTITY_SESSION_COOKIE));
  headers.append('set-cookie', clearIdentityCookie(IDENTITY_FLOW_COOKIE));
  headers.append('set-cookie', clearIdentityCookie(SAML_FLOW_COOKIE, 'None'));
  if (!ready) return identityUnavailableResponse(headers);

  await revokeIdentitySession(request, env);
  await recordDemoEvent(env, 'identity', 'identity.session_reset', {});
  return json({ authenticated: false }, { headers });
}

export async function providerStartResponse(request: Request, env: Env, provider: IdentityProvider): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  const unavailable = await requireIdentityReadiness(env);
  if (unavailable) return unavailable;
  if (!identityProviderConfiguration(env)[provider].configured) return identityRedirect(request, { error: 'provider_unconfigured', provider });
  const flow: IdentityFlow = { provider, state: randomValue(), verifier: randomValue(), startedAt: Date.now(), ...(OIDC_PROVIDERS.has(provider) ? { nonce: randomValue() } : {}) };
  let location: URL;
  if (provider === 'github') {
    const credentials = clientCredentials(provider, env);
    location = new URL('https://github.com/login/oauth/authorize');
    location.searchParams.set('client_id', credentials.id);
    location.searchParams.set('redirect_uri', callbackUrl(request, provider));
    location.searchParams.set('scope', 'read:user user:email');
    location.searchParams.set('prompt', 'select_account');
    location.searchParams.set('state', flow.state);
    location.searchParams.set('code_challenge', await pkceChallenge(String(flow.verifier)));
    location.searchParams.set('code_challenge_method', 'S256');
  } else {
    const metadata = await oidcMetadata(provider, env);
    const credentials = clientCredentials(provider, env);
    location = new URL(metadata.authorization_endpoint);
    location.searchParams.set('client_id', credentials.id);
    location.searchParams.set('redirect_uri', callbackUrl(request, provider));
    location.searchParams.set('response_type', 'code');
    location.searchParams.set('scope', 'openid profile email');
    location.searchParams.set('prompt', 'select_account');
    location.searchParams.set('state', flow.state);
    location.searchParams.set('nonce', String(flow.nonce));
    location.searchParams.set('code_challenge', await pkceChallenge(String(flow.verifier)));
    location.searchParams.set('code_challenge_method', 'S256');
    if (provider === 'microsoft') location.searchParams.set('response_mode', 'query');
  }
  await auditIdentity(env, 'authentication_started', provider);
  return redirect(location, [await writeFlowCookie(env, flow)]);
}

async function exchangeOidcCode(request: Request, env: Env, provider: 'microsoft' | 'google', code: string, flow: IdentityFlow): Promise<IdentitySession> {
  const metadata = await oidcMetadata(provider, env);
  const credentials = clientCredentials(provider, env);
  const token = await providerJson(metadata.token_endpoint, {
    method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: credentials.id, client_secret: credentials.secret, code, code_verifier: String(flow.verifier), grant_type: 'authorization_code', redirect_uri: callbackUrl(request, provider) }),
  });
  if (typeof token.id_token !== 'string' || token.id_token.length > 20_000) throw new IdentityError('missing_id_token');
  const jwks = createRemoteJWKSet(new URL(metadata.jwks_uri), { timeoutDuration: 8_000, cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 });
  const verified = await jwtVerify(token.id_token, jwks, { algorithms: ['RS256'], audience: credentials.id, issuer: metadata.issuer, requiredClaims: ['sub', 'iat', 'exp', 'nonce'], clockTolerance: 60, maxTokenAge: '2h' });
  if (typeof verified.payload.nonce !== 'string' || !flow.nonce || !await equalValue(verified.payload.nonce, flow.nonce)) throw new IdentityError('invalid_nonce');
  return oidcSession(provider, verified.payload);
}

async function exchangeGithubCode(request: Request, env: Env, code: string, flow: IdentityFlow): Promise<IdentitySession> {
  const credentials = clientCredentials('github', env);
  const token = await providerJson('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: credentials.id, client_secret: credentials.secret, code, redirect_uri: callbackUrl(request, 'github'), code_verifier: String(flow.verifier) }),
  });
  if (typeof token.access_token !== 'string' || token.access_token.length > 1000 || token.token_type !== 'bearer') throw new IdentityError('missing_access_token');
  const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${token.access_token}`, 'user-agent': 'wizardgang-architecture-demo', 'x-github-api-version': '2022-11-28' };
  const user = await providerJson('https://api.github.com/user', { headers });
  const id = typeof user.id === 'number' && Number.isSafeInteger(user.id) ? user.id : null;
  const login = typeof user.login === 'string' ? user.login.slice(0, 100) : '';
  if (!id || !login) throw new IdentityError('invalid_github_identity');
  let email = typeof user.email === 'string' && isEmail(user.email) ? user.email : undefined;
  let emailVerified: boolean | undefined;
  if (!email) {
    const response = await fetch('https://api.github.com/user/emails', { headers, signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    if (response.ok && encoder.encode(text).byteLength <= MAX_PROVIDER_RESPONSE_BYTES) {
      try {
        const emails = JSON.parse(text);
        if (Array.isArray(emails)) {
          const selected = emails.find((entry) => entry && typeof entry === 'object' && entry.primary === true && entry.verified === true && isEmail(entry.email));
          if (selected) { email = selected.email; emailVerified = true; }
        }
      } catch { /* Email is optional; the numeric GitHub ID remains the subject. */ }
    }
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString();
  const displayName = typeof user.name === 'string' && user.name.trim() ? user.name.trim().slice(0, 160) : login;
  const avatarUrl = typeof user.avatar_url === 'string' && user.avatar_url.startsWith('https://avatars.githubusercontent.com/') ? user.avatar_url : undefined;
  return {
    identity: { provider: 'github', protocol: 'oauth2', subject: `github:${id}`, ...(email ? { email } : {}), ...(emailVerified !== undefined ? { emailVerified } : {}), displayName, username: login, assurance: 'provider-authenticated', role: 'viewer', authenticatedAt: now.toISOString(), expiresAt },
    providerPayloadLabel: 'GitHub API identity', providerPayload: { id, login, name: displayName, ...(email ? { email } : {}), ...(avatarUrl ? { avatar_url: avatarUrl } : {}), type: user.type === 'User' ? 'User' : 'Account' },
    validation: [
      { key: 'state', label: 'State', status: 'valid', detail: 'Matched the encrypted browser flow.' },
      { key: 'pkce', label: 'PKCE', status: 'valid', detail: 'S256 verifier was sent only from the Worker.' },
      { key: 'provider_api', label: 'GitHub API', status: 'valid', detail: 'OAuth credential revalidated against GET /user.' },
      { key: 'signature', label: 'ID-token signature', status: 'not_applicable', detail: 'GitHub OAuth identifies the user through its authenticated API, not an ID token.' },
    ],
    protocol: { name: 'OAuth 2.0 Authorization Code + PKCE', steps: ['State and S256 challenge generated', 'Authorization code received', 'State and PKCE validated server-side', 'Minimal-scope access credential received', 'Identity revalidated with the GitHub API', 'Access credential discarded and WizardGang session issued'] },
    issuedAt: now.toISOString(), expiresAt,
  };
}

export async function providerCallbackResponse(request: Request, env: Env, provider: IdentityProvider): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  const unavailable = await requireIdentityReadiness(env);
  if (unavailable) return unavailable;
  const url = new URL(request.url);
  const flow = await readFlowCookie(request, env, provider);
  try {
    if (url.searchParams.has('error')) throw new IdentityError('provider_denied_authentication');
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (!flow || !state || !await equalValue(flow.state, state)) throw new IdentityError('invalid_state');
    if (!code || code.length > 4096 || !flow.verifier) throw new IdentityError('invalid_authorization_code');
    const session = provider === 'github' ? await exchangeGithubCode(request, env, code, flow) : await exchangeOidcCode(request, env, provider, code, flow);
    const sessionCookie = await createIdentitySession(env, session);
    const subjectAuditId = await identitySubjectAuditId(env, session.identity.provider, session.identity.subject);
    await auditIdentity(env, 'authentication_completed', provider, { subjectAuditId, assurance: session.identity.assurance });
    await auditIdentity(env, 'session_created', provider, { subjectAuditId });
    return identityRedirect(request, { authenticated: provider }, [sessionCookie, clearFlowCookie(provider)]);
  } catch (error) {
    const reason = error instanceof IdentityError ? error.code : 'provider_callback_failed';
    await auditFailure(env, provider, reason);
    return identityRedirect(request, { error: 'authentication_failed', provider }, [clearFlowCookie(provider)]);
  }
}

// SAML AuthnRequest correlation for the node-saml validator. Each request record expires after the flow window.
class D1SamlCache implements CacheProvider {
  constructor(private readonly env: Env) {}
  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    const createdAt = Date.now();
    await demoRecords(this.env).put(COLLECTIONS.samlRequests, await sha256(key), { value }, { ttlSeconds: FLOW_SECONDS });
    return { value, createdAt };
  }
  async getAsync(key: string): Promise<string | null> {
    return (await demoRecords(this.env).get<{ value: string }>(COLLECTIONS.samlRequests, await sha256(key)))?.body.value ?? null;
  }
  async removeAsync(key: string | null): Promise<string | null> {
    if (!key) return null;
    const value = await this.getAsync(key);
    await demoRecords(this.env).delete(COLLECTIONS.samlRequests, await sha256(key));
    return value;
  }
}

function samlCertificate(value: string): string {
  const normalized = value.replaceAll('\\n', '\n').trim();
  return normalized.includes('BEGIN CERTIFICATE') ? normalized : `-----BEGIN CERTIFICATE-----\n${normalized}\n-----END CERTIFICATE-----`;
}

function samlIssuer(env: Env): string {
  return env.SAML_IDP_ISSUER?.trim() || `https://sts.windows.net/${env.MICROSOFT_TENANT_ID?.trim() || ''}/`;
}

function samlEntryPoint(env: Env): string {
  return env.SAML_SSO_URL?.trim() || `https://login.microsoftonline.com/${encodeURIComponent(env.MICROSOFT_TENANT_ID?.trim() || '')}/saml2`;
}

function samlClient(request: Request, env: Env): SAML {
  if (!env.SAML_IDP_CERT) throw new IdentityError('provider_not_configured');
  return new SAML({
    callbackUrl: samlCallbackUrl(request), entryPoint: samlEntryPoint(env), issuer: samlEntityId(request), audience: samlEntityId(request),
    idpCert: samlCertificate(env.SAML_IDP_CERT), idpIssuer: samlIssuer(env), identifierFormat: null, disableRequestedAuthnContext: true, forceAuthn: true,
    acceptedClockSkewMs: 60_000, maxAssertionAgeMs: FLOW_SECONDS * 1000, validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: FLOW_SECONDS * 1000, cacheProvider: new D1SamlCache(env), wantAssertionsSigned: true, wantAuthnResponseSigned: false,
  });
}

function localElements(root: Document | Element, name: string): Element[] {
  const values: Element[] = [];
  const nodes = root.getElementsByTagNameNS('*', name);
  for (let index = 0; index < nodes.length; index += 1) values.push(nodes[index]);
  return values;
}

function parseAssertion(profile: Profile, expectedRecipient: string): { id: string; audience: string; destination: string; recipient: string; authnInstant?: string; sessionIndex?: string; notBefore?: string; notOnOrAfter: string } {
  const xml = profile.getAssertionXml?.();
  const responseXml = profile.getSamlResponseXml?.();
  if (!xml || !responseXml || encoder.encode(xml).byteLength > MAX_PROVIDER_RESPONSE_BYTES || encoder.encode(responseXml).byteLength > MAX_PROVIDER_RESPONSE_BYTES) throw new IdentityError('invalid_saml_assertion');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const responseDocument = new DOMParser().parseFromString(responseXml, 'application/xml');
  if (localElements(document, 'parsererror').length || localElements(responseDocument, 'parsererror').length || responseDocument.documentElement.localName !== 'Response') throw new IdentityError('invalid_saml_assertion');
  const assertion = document.documentElement;
  const id = assertion.getAttribute('ID') || '';
  const conditions = localElements(assertion, 'Conditions');
  const audiences = localElements(assertion, 'Audience');
  const confirmations = localElements(assertion, 'SubjectConfirmationData');
  const statements = localElements(assertion, 'AuthnStatement');
  if (!id || conditions.length !== 1 || audiences.length < 1 || confirmations.length < 1 || statements.length < 1) throw new IdentityError('incomplete_saml_assertion');
  const confirmation = confirmations.find((element) => element.getAttribute('Recipient') === expectedRecipient);
  const recipient = confirmation?.getAttribute('Recipient') || '';
  const destination = responseDocument.documentElement.getAttribute('Destination') || '';
  const notOnOrAfter = conditions[0].getAttribute('NotOnOrAfter') || confirmation?.getAttribute('NotOnOrAfter') || '';
  if (destination !== expectedRecipient || recipient !== expectedRecipient || !notOnOrAfter || !Number.isFinite(Date.parse(notOnOrAfter))) throw new IdentityError('invalid_saml_destination_recipient_or_expiry');
  return { id, audience: audiences[0].textContent?.trim() || '', destination, recipient, authnInstant: statements[0].getAttribute('AuthnInstant') || undefined, sessionIndex: statements[0].getAttribute('SessionIndex') || undefined, notBefore: conditions[0].getAttribute('NotBefore') || undefined, notOnOrAfter };
}

function profileStrings(profile: Profile, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = profile[key];
    if (typeof value === 'string' && value.trim()) return [value.trim()];
    if (Array.isArray(value)) {
      const strings = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim());
      if (strings.length) return strings;
    }
  }
  return [];
}

function xmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function samlSession(profile: Profile, assertion: ReturnType<typeof parseAssertion>, request: Request, env: Env): IdentitySession {
  const emailCandidate = profileStrings(profile, 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', 'email', 'mail')[0];
  const email = isEmail(emailCandidate) ? emailCandidate : undefined;
  const displayName = profileStrings(profile, 'http://schemas.microsoft.com/identity/claims/displayname', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name', 'name')[0] || email || 'Microsoft Entra user';
  const tenant = profileStrings(profile, 'http://schemas.microsoft.com/identity/claims/tenantid')[0];
  const objectId = profileStrings(profile, 'http://schemas.microsoft.com/identity/claims/objectidentifier')[0];
  const roles = profileStrings(profile, 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role', 'roles');
  const methods = profileStrings(profile, 'http://schemas.microsoft.com/claims/authnmethodsreferences');
  const assurance: IdentityAssurance = methods.some((value) => value.toLowerCase().includes('multipleauthn') || value.toLowerCase() === 'mfa') ? 'mfa' : 'provider-authenticated';
  const authenticatedAt = assertion.authnInstant && Number.isFinite(Date.parse(assertion.authnInstant)) ? new Date(assertion.authnInstant).toISOString() : new Date().toISOString();
  const expiresAt = new Date(assertion.notOnOrAfter).toISOString();
  const providerPayload: Record<string, unknown> = { issuer: profile.issuer, nameId: profile.nameID, audience: assertion.audience, destination: assertion.destination, recipient: assertion.recipient, ...(assertion.authnInstant ? { authenticationInstant: assertion.authnInstant } : {}), ...(assertion.sessionIndex ? { sessionIndex: assertion.sessionIndex } : {}), ...(email ? { email } : {}), displayName, ...(tenant ? { tenantId: tenant } : {}), ...(objectId ? { objectId } : {}), ...(roles.length ? { roles } : {}) };
  const outline = `<saml:Assertion ID="[redacted]">
  <saml:Issuer>${xmlEscape(profile.issuer)}</saml:Issuer>
  <saml:Subject><saml:NameID>${xmlEscape(profile.nameID)}</saml:NameID></saml:Subject>
  <saml:Conditions NotBefore="${xmlEscape(assertion.notBefore || '')}" NotOnOrAfter="${xmlEscape(assertion.notOnOrAfter)}">
    <saml:AudienceRestriction><saml:Audience>${xmlEscape(assertion.audience)}</saml:Audience></saml:AudienceRestriction>
  </saml:Conditions>
  <saml:AuthnStatement AuthnInstant="${xmlEscape(assertion.authnInstant || '')}" SessionIndex="[redacted]" />
  <ds:Signature>[validated and removed]</ds:Signature>
</saml:Assertion>`;
  return {
    identity: { provider: 'microsoft', protocol: 'saml2', subject: objectId || profile.nameID, ...(email ? { email } : {}), displayName, ...(tenant ? { organization: tenant } : {}), assurance, role: roleFrom(roles), authenticatedAt, expiresAt },
    providerPayloadLabel: 'Validated SAML assertion', providerPayload,
    validation: [
      { key: 'signature', label: 'Signature', status: 'valid', detail: 'Validated against the configured Entra signing certificate.' },
      { key: 'issuer', label: 'Issuer', status: 'valid', detail: `Matched ${samlIssuer(env)}.` },
      { key: 'audience', label: 'Audience', status: 'valid', detail: `Matched ${samlEntityId(request)}.` },
      { key: 'destination', label: 'Destination', status: 'valid', detail: 'Response and subject recipient matched the assertion consumer service.' },
      { key: 'time', label: 'Time bounds', status: 'valid', detail: 'Assertion is current and no older than ten minutes.' },
      { key: 'request', label: 'Request correlation', status: 'valid', detail: 'InResponseTo matched the stored authentication request.' },
      { key: 'replay', label: 'Replay protection', status: 'valid', detail: 'Assertion ID was accepted exactly once.' },
    ],
    protocol: { name: 'SAML 2.0 HTTP-Redirect / HTTP-POST', steps: ['AuthnRequest and RelayState generated', 'Signed SAML Response posted to the ACS', 'Request correlation and signature validated', 'Issuer, audience, recipient, and time bounds validated', 'Assertion replay rejected through D1', 'Claims normalized and WizardGang session issued'], sanitizedAssertion: outline },
    issuedAt: authenticatedAt, expiresAt,
  };
}

export async function samlStartResponse(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  const unavailable = await requireIdentityReadiness(env);
  if (unavailable) return unavailable;
  if (!identityProviderConfiguration(env).saml.configured) return identityRedirect(request, { error: 'provider_unconfigured', provider: 'saml' });
  const flow: IdentityFlow = { provider: 'saml', state: randomValue(), startedAt: Date.now() };
  const authorizeUrl = await samlClient(request, env).getAuthorizeUrlAsync(flow.state, undefined, {});
  await auditIdentity(env, 'authentication_started', 'saml');
  return redirect(new URL(authorizeUrl), [await writeFlowCookie(env, flow)]);
}

export async function samlCallbackResponse(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  const unavailable = await requireIdentityReadiness(env);
  if (unavailable) return unavailable;
  const clear = clearFlowCookie('saml');
  try {
    const declared = Number(request.headers.get('content-length') || '0');
    if (declared > 500_000) throw new IdentityError('saml_response_too_large');
    const form = await request.formData();
    const samlResponse = form.get('SAMLResponse');
    const relayState = form.get('RelayState');
    if (typeof samlResponse !== 'string' || samlResponse.length > 400_000 || typeof relayState !== 'string' || relayState.length > 500) throw new IdentityError('invalid_saml_response');
    const flow = await readFlowCookie(request, env, 'saml');
    if (!flow || !await equalValue(flow.state, relayState)) throw new IdentityError('invalid_relay_state');
    const result = await samlClient(request, env).validatePostResponseAsync({ SAMLResponse: samlResponse, RelayState: relayState });
    if (result.loggedOut || !result.profile) throw new IdentityError('missing_saml_profile');
    if (!await equalValue(result.profile.issuer, samlIssuer(env))) throw new IdentityError('invalid_saml_issuer');
    const assertion = parseAssertion(result.profile, samlCallbackUrl(request));
    if (!await equalValue(assertion.audience, samlEntityId(request))) throw new IdentityError('invalid_saml_audience');
    const session = samlSession(result.profile, assertion, request, env);
    // Replay protection: an assertion ID is accepted once while its session could still be live.
    const assertionKey = await sha256(assertion.id);
    if (await demoRecords(env).get(COLLECTIONS.samlAssertions, assertionKey)) throw new IdentityError('saml_assertion_replayed');
    await demoRecords(env).put(COLLECTIONS.samlAssertions, assertionKey, { validatedAt: new Date().toISOString() }, { ttlSeconds: secondsUntil(session.expiresAt) });
    const sessionCookie = await createIdentitySession(env, session);
    const subjectAuditId = await identitySubjectAuditId(env, 'microsoft', session.identity.subject);
    await auditIdentity(env, 'saml_assertion_validated', 'saml', { subjectAuditId });
    await auditIdentity(env, 'authentication_completed', 'saml', { subjectAuditId, assurance: session.identity.assurance });
    await auditIdentity(env, 'session_created', 'saml', { subjectAuditId });
    return identityRedirect(request, { authenticated: 'saml' }, [sessionCookie, clear]);
  } catch (error) {
    const reason = error instanceof IdentityError ? error.code : 'saml_validation_failed';
    await auditFailure(env, 'saml', reason);
    return identityRedirect(request, { error: 'authentication_failed', provider: 'saml' }, [clear]);
  }
}

export async function samlMetadataResponse(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  const unavailable = await requireIdentityReadiness(env);
  if (unavailable) return unavailable;
  const entityId = samlEntityId(request);
  const callback = samlCallbackUrl(request);
  const metadata = `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${xmlEscape(entityId)}">
  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:persistent</NameIDFormat>
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${xmlEscape(callback)}" index="0" isDefault="true" />
  </SPSSODescriptor>
</EntityDescriptor>`;
  return new Response(metadata, { headers: { 'content-type': 'application/samlmetadata+xml; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
}
