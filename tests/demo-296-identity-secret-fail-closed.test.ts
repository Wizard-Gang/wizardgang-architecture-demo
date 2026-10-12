import { describe, expect, it } from 'vitest';
import { healthResponse } from '../src/api/operations';
import { createIdentitySession, type IdentitySession } from '../src/lib/identity-session';
import { identityRouteCapability } from '../src/interfaces/route-capabilities/identity';
import { routeRequest } from '../src/router';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

function captureDb() {
  const db = new SqliteD1();
  return {
    db,
    state: {
      get revokedSessions() { return [...db.identitySessions().values()].filter((row) => row.revokedAt).length; },
      get identityAuditWrites() { return db.auditTrail().length; },
    },
  };
}

function environment(db: SqliteD1, overrides: Partial<Env> = {}): Env {
  return {
    WG_DB: db,
    GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
    GITHUB_BRANCH: 'main',
    WG_SESSION_KEY: 's'.repeat(32),
    ...overrides,
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

// Both identity keys derive from the Secrets Store WG_SESSION_KEY binding, so every failure is a root failure.
const secretFailures: Array<{ label: string; overrides: Partial<Env> }> = [
  { label: 'session key binding missing', overrides: { WG_SESSION_KEY: undefined } },
  { label: 'session key empty', overrides: { WG_SESSION_KEY: '' } },
  { label: 'session key binding empty', overrides: { WG_SESSION_KEY: { get: async () => '' } } },
  { label: 'session key binding unreadable', overrides: { WG_SESSION_KEY: { get: async () => { throw new Error('store unavailable'); } } } },
];

function endpointRequest(pattern: string, method: string): Request {
  const headers = new Headers({ accept: 'application/json' });
  if (method !== 'GET') headers.set('origin', 'https://demo.example');
  return new Request('https://demo.example' + pattern, { method, headers });
}

describe('DEMO-296 identity secret fail-closed behavior', () => {
  for (const scenario of secretFailures) {
    it('returns a controlled 503 from every identity endpoint when the ' + scenario.label, async () => {
      const capture = captureDb();
      const env = environment(capture.db, scenario.overrides);

      for (const route of identityRouteCapability.routes) {
        const method = route.methods[0];
        const response = await routeRequest(endpointRequest(route.pattern, method), env);
        expect(response.status, route.id).toBe(503);
        expect(response.headers.get('content-type'), route.id).toContain('application/json');
        expect(response.headers.get('cache-control'), route.id).toBe('no-store');
        expect(await response.json(), route.id).toEqual({ error: 'identity_not_configured' });

        if (route.id === 'interfaces.identity.logout') {
          expect(response.headers.get('set-cookie'), route.id).toContain('Max-Age=0');
        }
      }
    });
  }

  it('preserves configured SAML metadata public caching through the response-owned route policy', async () => {
    const capture = captureDb();
    const response = await routeRequest(
      new Request('https://demo.example/auth/saml/metadata', { headers: { accept: 'application/samlmetadata+xml' } }),
      environment(capture.db),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('samlmetadata+xml');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('keeps configured session and logout responses no-store under response-owned cache policy', async () => {
    const capture = captureDb();
    const env = environment(capture.db);

    const sessionResponse = await routeRequest(
      new Request('https://demo.example/auth/session', { headers: { accept: 'application/json' } }),
      env,
    );
    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.headers.get('cache-control')).toBe('no-store');

    const logoutResponse = await routeRequest(new Request('https://demo.example/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://demo.example', accept: 'application/json' },
    }), env);
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers.get('cache-control')).toBe('no-store');
    expect(logoutResponse.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('clears sign-out cookies without revoking or auditing when the session key is unavailable', async () => {
    const capture = captureDb();
    const configured = environment(capture.db);
    const cookie = (await createIdentitySession(configured, session())).split(';')[0];
    const response = await routeRequest(new Request('https://demo.example/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://demo.example', cookie, accept: 'application/json' },
    }), environment(capture.db, { WG_SESSION_KEY: undefined }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'identity_not_configured' });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(capture.state.revokedSessions).toBe(0);
    expect(capture.state.identityAuditWrites).toBe(0);
  });

  it('reports public-safe identity readiness without changing health status semantics', async () => {
    const readyCapture = captureDb();
    const ready = await healthResponse(environment(readyCapture.db));
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ status: 'operational', identity: 'ready' });

    for (const scenario of secretFailures) {
      const capture = captureDb();
      const response = await healthResponse(environment(capture.db, scenario.overrides));
      expect(response.status, scenario.label).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect(body, scenario.label).toMatchObject({ status: 'operational', identity: 'not-configured' });
      expect(JSON.stringify(body).toLowerCase(), scenario.label).not.toContain('secret');
    }
  });
});
