import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { securityTxtResponse, SECURITY_TXT_EXPIRES } from '../src/api/security-policy';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

const env = {
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
  WG_DB: new SqliteD1(),
} as Env;

describe('security.txt', () => {
  it('publishes the required private contact and expiry at the canonical location', async () => {
    const response = securityTxtResponse(new Request('https://demo.wizardgang.ai/.well-known/security.txt'), env);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(body).toContain('Contact: https://github.com/Wizard-Gang/wizardgang-architecture-demo/security/advisories/new');
    expect(body).toContain('Policy: https://github.com/Wizard-Gang/wizardgang-architecture-demo/security/policy');
    expect(body).toContain('Canonical: https://demo.wizardgang.ai/.well-known/security.txt');
    expect(body).toContain(`Expires: ${SECURITY_TXT_EXPIRES}`);
    const expiry = Date.parse(SECURITY_TXT_EXPIRES);
    expect(expiry).toBeGreaterThan(Date.now());
    expect(expiry).toBeLessThan(Date.now() + 366 * 24 * 60 * 60 * 1000);
  });

  it('supports HEAD and rejects mutation methods', async () => {
    const head = securityTxtResponse(new Request('https://demo.wizardgang.ai/.well-known/security.txt', { method: 'HEAD' }), env);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const post = securityTxtResponse(new Request('https://demo.wizardgang.ai/.well-known/security.txt', { method: 'POST' }), env);
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });
});

describe('public issue intake', () => {
  it('offers no public security issue form', () => {
    const config = readFileSync('.github/ISSUE_TEMPLATE/config.yml', 'utf8');
    expect(config).toContain('blank_issues_enabled: false');
    expect(config).toContain('security/advisories/new');
    expect(config).not.toContain('security.yml');
  });
});
