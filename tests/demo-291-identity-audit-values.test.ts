import { describe, expect, it } from 'vitest';
import { authorizationDecisionResponse, demoAccessTokenResponse, identitySessionResponse } from '../src/api/identity';
import { recentDemoEvents } from '../src/lib/audit';
import {
  createIdentitySession,
  identitySandboxNamespace,
  identitySubjectAuditId,
  sha256,
  type IdentitySession,
} from '../src/lib/identity-session';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

function captureDb() {
  const db = new SqliteD1();
  return {
    db,
    get events() { return db.demoEventRows(); },
  };
}

// The identity-audit key derives from WG_SESSION_KEY, so a different root stands in for a different audit key.
function environment(db: SqliteD1, sessionKey = 'identity-audit-test-secret-that-is-at-least-thirty-two-characters'): Env {
  return {
    WG_DB: db,
    GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
    GITHUB_BRANCH: 'main',
    WG_SESSION_KEY: sessionKey,
  };
}

function session(): IdentitySession {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3_600_000).toISOString();
  return {
    identity: {
      provider: 'microsoft',
      protocol: 'oidc',
      subject: 'stable-subject',
      email: 'ada@example.test',
      emailVerified: true,
      displayName: 'Ada Lovelace',
      assurance: 'mfa',
      role: 'operator',
      authenticatedAt: now.toISOString(),
      expiresAt,
    },
    providerPayloadLabel: 'Validated ID token claims',
    providerPayload: { sub: 'stable-subject' },
    validation: [{ key: 'signature', label: 'Signature', status: 'valid', detail: 'Verified.' }],
    protocol: { name: 'OpenID Connect', steps: ['Validated'] },
    issuedAt: now.toISOString(),
    expiresAt,
  };
}

describe('DEMO-291 identity audit value hardening', () => {
  it('stores a keyed audit identifier and withholds identity detail from public projections', async () => {
    const capture = captureDb();
    const env = environment(capture.db);
    const cookie = (await createIdentitySession(env, session())).split(';')[0];

    const response = await authorizationDecisionResponse(new Request('https://demo.example/auth/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: 'https://demo.example' },
      body: JSON.stringify({ requestedAction: 'demo:write' }),
    }), env);
    expect(response.status).toBe(200);

    const auditId = await identitySubjectAuditId(env, 'microsoft', 'stable-subject');
    const legacyDigest = await sha256('microsoft:stable-subject');
    const event = capture.events.find((row) => row.event_type === 'identity.authorization_allowed');
    expect(event).toBeTruthy();
    const payload = JSON.parse(String(event?.payload_json)) as Record<string, unknown>;
    expect(payload.subjectAuditId).toBe(auditId);
    expect(payload.subjectAuditId).not.toBe(legacyDigest);
    expect(JSON.stringify(payload)).not.toContain('stable-subject');
    expect(payload).not.toHaveProperty('subjectSha256');

    const publicEvents = await recentDemoEvents(env, 20) as Array<Record<string, unknown>>;
    const identityEvents = publicEvents.filter((row) => row.demo_id === 'identity');
    expect(identityEvents).not.toHaveLength(0);
    expect(identityEvents.every((row) => row.payload_json === null)).toBe(true);
    expect(JSON.stringify(identityEvents)).not.toContain(auditId);
  });

  it('derives visitor sandboxes from the keyed namespace purpose', async () => {
    const capture = captureDb();
    const env = environment(capture.db);
    const currentSession = session();
    const cookie = (await createIdentitySession(env, currentSession)).split(';')[0];

    const response = await demoAccessTokenResponse(new Request('https://demo.example/auth/token', {
      method: 'POST',
      headers: { cookie, origin: 'https://demo.example' },
    }), env);
    expect(response.status).toBe(200);
    const body = await response.json() as { namespace: string };
    const expected = await identitySandboxNamespace(env, 'microsoft', 'stable-subject');
    const legacy = `sandbox-${(await sha256('microsoft:stable-subject')).slice(0, 24)}`;
    expect(body.namespace).toBe(expected);
    expect(body.namespace).not.toBe(legacy);

    const otherEnv = environment(capture.db, 'a-different-identity-audit-secret-at-least-thirty-two-characters');
    expect(await identitySandboxNamespace(otherEnv, 'microsoft', 'stable-subject')).not.toBe(body.namespace);

    const tokenEvent = capture.events.find((row) => row.event_type === 'identity.demo_access_token_issued');
    const tokenPayload = JSON.parse(String(tokenEvent?.payload_json)) as Record<string, unknown>;
    expect(tokenPayload.namespace).toBe(body.namespace);
    expect(tokenPayload.subjectAuditId).toBe(await identitySubjectAuditId(env, 'microsoft', 'stable-subject'));
  });

  it('keeps identity sessions valid under the same root and signs them out once WG_SESSION_KEY rotates', async () => {
    const capture = captureDb();
    const original = environment(capture.db, 'original-identity-audit-secret-at-least-thirty-two-characters');
    const cookie = (await createIdentitySession(original, session())).split(';')[0];
    const rotated = environment(capture.db, 'replacement-identity-audit-secret-at-least-thirty-two-chars');
    const read = (env: Env) => identitySessionResponse(new Request('https://demo.example/auth/session', { headers: { cookie } }), env);

    expect(await (await read(environment(capture.db, 'original-identity-audit-secret-at-least-thirty-two-characters'))).json()).toMatchObject({
      authenticated: true,
      session: { identity: { provider: 'microsoft', subject: 'stable-subject' } },
    });
    expect(await (await read(rotated)).json()).toMatchObject({ authenticated: false });
  });
});
