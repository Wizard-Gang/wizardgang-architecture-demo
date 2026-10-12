import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { recordsResponse } from '../src/api/records';
import { createDemoAccessToken, type IdentitySession } from '../src/lib/identity-session';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

function environment(): Env {
  return { WG_DB: new SqliteD1(), GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo', GITHUB_BRANCH: 'main', WG_SESSION_KEY: 's'.repeat(32) };
}

function session(): IdentitySession {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3_600_000).toISOString();
  return {
    identity: { provider: 'microsoft', protocol: 'oidc', subject: 'demo-298-subject', displayName: 'Demo 298', assurance: 'mfa', role: 'viewer', authenticatedAt: now.toISOString(), expiresAt },
    providerPayloadLabel: 'Validated ID token claims',
    providerPayload: { sub: 'demo-298-subject' },
    validation: [{ key: 'signature', label: 'Signature', status: 'valid', detail: 'Verified.' }],
    protocol: { name: 'OpenID Connect', steps: ['Validated'] },
    issuedAt: now.toISOString(),
    expiresAt,
  };
}

describe('DEMO-298 orphaned operator credential retirement', () => {
  it('removes the unreachable namespace fallback and stale operator bearer policy text', () => {
    const records = fs.readFileSync('src/api/records.ts', 'utf8');
    const identity = fs.readFileSync('src/api/identity.ts', 'utf8');
    const security = fs.readFileSync('SECURITY.md', 'utf8');
    expect(records).not.toContain("return identifier(requested, 'namespace'");
    expect(identity).not.toContain('managed operator credential');
    expect(security).not.toContain('managed operator bearer credential');
  });

  it('keeps anonymous reads public and visitor bearer writes inside the server-derived sandbox', async () => {
    const env = environment();
    const publicRead = await recordsResponse(new Request('https://demo.example/api/labs/rest-records?namespace=requested-namespace'), env);
    expect(publicRead.status).toBe(200);
    expect(await publicRead.json()).toMatchObject({ authorization: { scope: 'public' } });

    const { token, claims } = await createDemoAccessToken(env, session());
    const write = await recordsResponse(new Request('https://demo.example/api/labs/rest-records', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ namespace: 'requested-namespace', key: 'demo-298', value: { ok: true } }),
    }), env);
    expect(write.status).toBe(201);
    expect(await write.json()).toMatchObject({ namespace: claims.namespace, authorization: { scope: 'visitor-sandbox' } });
    expect(claims.namespace).not.toBe('requested-namespace');
  });
});
