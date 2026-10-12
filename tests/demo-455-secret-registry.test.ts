import { acceptanceStages } from '../scripts/lib/acceptance-plan.ts';
import { hkdfSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJsonc } from '../platform/conformance/jsonc.mjs';
import { derivedSecret, hasSessionKey } from '../src/lib/derived-keys';

const ROOT = 'demo-455-test-session-key-with-at-least-32-characters';
const LABELS = ['demo-session', 'identity-session', 'identity-audit'] as const;
const RETIRED = [
  'CLOUDFLARE_API_TOKEN', 'DEMO_ADMIN_USER', 'DEMO_ADMIN_PASSWORD', 'WEBHOOK_DEMO_SECRET', 'DEMO_SESSION_SECRET', 'IDENTITY_SESSION_SECRET', 'IDENTITY_AUDIT_HMAC_SECRET',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET',
];

function reference(root: string, label: string): string {
  return Buffer.from(hkdfSync('sha256', root, 'wizardgang wg-edge derived key v1', `wg-edge:${label}`, 32)).toString('hex');
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(ts|tsx|mjs)$/.test(entry.name) ? [file] : [];
  });
}

describe('DEMO-455 secret registry normalization', () => {
  it('derives each label from WG_SESSION_KEY exactly as baseline wg-edge specifies', async () => {
    for (const label of LABELS) {
      expect(await derivedSecret({ WG_SESSION_KEY: ROOT }, label)).toBe(reference(ROOT, label));
    }
  });

  it('keeps derived keys stable per label, distinct across labels and roots, and identical through a Secrets Store binding', async () => {
    const keys = await Promise.all(LABELS.map((label) => derivedSecret({ WG_SESSION_KEY: ROOT }, label)));
    expect(new Set(keys).size).toBe(LABELS.length);
    for (const [index, label] of LABELS.entries()) {
      expect(await derivedSecret({ WG_SESSION_KEY: ROOT }, label)).toBe(keys[index]);
      expect(await derivedSecret({ WG_SESSION_KEY: { get: async () => ROOT } }, label)).toBe(keys[index]);
      expect(await derivedSecret({ WG_SESSION_KEY: `${ROOT}-rotated` }, label)).not.toBe(keys[index]);
    }
  });

  it('fails closed without a usable root', async () => {
    expect(hasSessionKey({})).toBe(false);
    expect(hasSessionKey({ WG_SESSION_KEY: '' })).toBe(false);
    expect(hasSessionKey({ WG_SESSION_KEY: { get: async () => '' } })).toBe(true);
    for (const env of [{}, { WG_SESSION_KEY: '' }, { WG_SESSION_KEY: { get: async () => '' } }, { WG_SESSION_KEY: { get: async () => { throw new Error('unavailable'); } } }]) {
      expect(await derivedSecret(env, 'demo-session')).toBeNull();
    }
  });

  it('reads no retired secret name anywhere in Worker source', () => {
    for (const file of sourceFiles('src')) {
      const source = fs.readFileSync(file, 'utf8');
      for (const name of RETIRED) expect(source, `${file} reads ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it('binds WG_SESSION_KEY from the Secrets Store, commits the public provider values and drops the deleted preview bucket', () => {
    const wrangler = parseJsonc(fs.readFileSync('wrangler.jsonc', 'utf8')) as {
      vars: Record<string, string>;
      secrets_store_secrets: Array<{ binding: string; store_id: string; secret_name: string }>;
      r2_buckets: Array<Record<string, string>>;
    };
    expect(wrangler.secrets_store_secrets).toEqual([
      { binding: 'WG_OPS_TOKEN', store_id: expect.stringMatching(/^[0-9a-f]{32}$/), secret_name: 'WG_OPS_TOKEN' },
      { binding: 'WG_SESSION_KEY', store_id: expect.stringMatching(/^[0-9a-f]{32}$/), secret_name: 'WG_SESSION_KEY' },
    ]);
    for (const name of ['GITHUB_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID', 'MICROSOFT_OAUTH_CLIENT_ID', 'MICROSOFT_TENANT_ID']) {
      expect(wrangler.vars[name], name).toMatch(/\S/);
    }
    expect(wrangler.vars.CLOUDFLARE_DO_NAMESPACE).toBe('2a8431fd59b342799b74518e1bcc7b6d'); // DemoCoordinator survived the in-place Worker rename.
    expect(wrangler.r2_buckets.every((bucket) => !('preview_bucket_name' in bucket))).toBe(true);
  });


  it('vendors baseline platform/ from BASE-030 or later and checks the pin in npm run check', () => {
    const lock = JSON.parse(fs.readFileSync('platform/vendor.lock.json', 'utf8')) as { source: string; commit: string };
    expect(lock.source).toBe('Wizard-Gang/baseline');
    expect(lock.commit).toMatch(/^[0-9a-f]{40}$/);
    const scripts = (JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts['check:platform']).toBe('node platform/conformance/cli.mjs pin && node platform/conformance/cli.mjs wrangler --worker demo');
    expect(acceptanceStages.map(({ script }) => script)).toContain('check:platform');
  });
});
