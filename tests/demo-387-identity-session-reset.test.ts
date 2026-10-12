import { inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { identityLogoutResponse, identitySessionResponse, providerStartResponse, samlStartResponse } from '../src/api/identity';
import { createIdentitySession, writeFlowCookie, type IdentitySession } from '../src/lib/identity-session';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

function fixture() {
  const db = new SqliteD1();
  const sessions = () => [...db.identitySessions().values()].map((row) => ({ ...row, revoked: Boolean(row.revokedAt) }));
  const audit = () => db.auditTrail();
  const env: Env = {
    WG_DB: db,
    GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
    GITHUB_BRANCH: 'main',
    WG_SESSION_KEY: 's'.repeat(32),
    MICROSOFT_OAUTH_CLIENT_ID: 'microsoft-client', MICROSOFT_OAUTH_CLIENT_SECRET: 'microsoft-secret', MICROSOFT_TENANT_ID: 'tenant',
    GOOGLE_OAUTH_CLIENT_ID: 'google-client', GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret',
    GITHUB_OAUTH_CLIENT_ID: 'github-client', GITHUB_OAUTH_CLIENT_SECRET: 'github-secret',
    SAML_IDP_CERT: 'test-certificate',
  };
  return { env, sessions, audit };
}

function session(): IdentitySession {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60_000).toISOString();
  return {
    identity: { provider: 'google', protocol: 'oidc', subject: 'private-subject', displayName: 'Ada', assurance: 'provider-authenticated', role: 'viewer', authenticatedAt: now.toISOString(), expiresAt },
    providerPayloadLabel: 'Validated claims', providerPayload: {}, validation: [],
    protocol: { name: 'OIDC', steps: [] }, issuedAt: now.toISOString(), expiresAt,
  };
}

function resetRequest(cookie = '', origin = 'https://demo.example') {
  return new Request('https://demo.example/auth/logout', { method: 'POST', headers: { origin, cookie } });
}

function expiredCookies(response: Response) {
  const cookies = response.headers.getSetCookie();
  expect(cookies).toHaveLength(3);
  for (const [index, name] of ['__Host-wg_identity', '__Host-wg_identity_flow', '__Host-wg_saml_flow'].entries()) {
    expect(cookies[index]).toContain(`${name}=;`);
    for (const attribute of ['Path=/', 'Max-Age=0', 'HttpOnly', 'Secure']) expect(cookies[index]).toContain(attribute);
    expect(cookies[index]).toContain(`SameSite=${name === '__Host-wg_saml_flow' ? 'None' : 'Lax'}`);
  }
}

describe('DEMO-387 identity session reset', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('revokes an authenticated session, clears all cookies, and records no identifiers', async () => {
    const { env, sessions, audit } = fixture();
    const cookie = (await createIdentitySession(env, session())).split(';')[0];
    const response = await identityLogoutResponse(resetRequest(cookie), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false });
    expiredCookies(response);
    expect(sessions().every((row) => row.revoked)).toBe(true);
    const after = await identitySessionResponse(new Request('https://demo.example/auth/session', { headers: { cookie } }), env);
    expect(await after.json()).toMatchObject({ authenticated: false });
    expect(audit().map((item) => item.type)).toEqual(['identity.session_reset']);
    expect(JSON.stringify(audit())).not.toMatch(/private-subject|__Host-|token|subject|session_id|google-client/);
  });

  it('succeeds without a session and with a stale flow cookie', async () => {
    const { env, audit } = fixture();
    const stale = (await writeFlowCookie(env, { provider: 'google', state: 'stale-state', startedAt: Date.now() - 20 * 60_000 })).split(';')[0];
    for (const cookie of ['', stale]) {
      const response = await identityLogoutResponse(resetRequest(cookie), env);
      expect(response.status).toBe(200);
      expiredCookies(response);
    }
    expect(audit().filter((item) => item.type === 'identity.session_reset')).toHaveLength(2);
    expect(JSON.stringify(audit())).not.toContain('stale-state');
  });

  it('refuses a cross-origin POST before revocation, cookie clearing, or audit', async () => {
    const { env, sessions, audit } = fixture();
    const cookie = (await createIdentitySession(env, session())).split(';')[0];
    const response = await identityLogoutResponse(resetRequest(cookie, 'https://other.example'), env);
    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toHaveLength(0);
    expect(sessions().every((row) => !row.revoked)).toBe(true);
    expect(audit()).toHaveLength(0);
  });

  it.each(['microsoft', 'google', 'github'] as const)('requests account selection for %s while retaining flow bindings', async (provider) => {
    const { env } = fixture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      issuer: provider === 'microsoft' ? 'https://login.microsoftonline.com/tenant/v2.0' : 'https://accounts.google.com',
      authorization_endpoint: provider === 'microsoft' ? 'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize' : 'https://accounts.google.com/o/oauth2/v2/auth',
      token_endpoint: provider === 'microsoft' ? 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token' : 'https://oauth2.googleapis.com/token',
      jwks_uri: provider === 'microsoft' ? 'https://login.microsoftonline.com/tenant/discovery/v2.0/keys' : 'https://www.googleapis.com/oauth2/v3/certs',
    }))));
    const response = await providerStartResponse(new Request(`https://demo.example/auth/${provider}`), env, provider);
    expect(response.status).toBe(303);
    const url = new URL(response.headers.get('location')!);
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe(provider === 'github' ? 'read:user user:email' : 'openid profile email');
    expect(url.searchParams.get('redirect_uri')).toBe(`https://demo.example/auth/${provider}/callback`);
    if (provider === 'github') expect(url.searchParams.get('nonce')).toBeNull();
    else expect(url.searchParams.get('nonce')).toBeTruthy();
  });

  it('sets ForceAuthn on the SAML AuthnRequest', async () => {
    const { env } = fixture();
    const response = await samlStartResponse(new Request('https://demo.example/auth/saml'), env);
    expect(response.status).toBe(303);
    const url = new URL(response.headers.get('location')!);
    const xml = inflateRawSync(Buffer.from(url.searchParams.get('SAMLRequest')!, 'base64')).toString('utf8');
    expect(xml).toContain('ForceAuthn="true"');
    expect(xml).toContain('AssertionConsumerServiceURL="https://demo.example/auth/saml/acs"');
  });
});
