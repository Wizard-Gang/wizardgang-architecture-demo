import { describe, expect, it, vi } from 'vitest';
import { createDemoWorker, type DemoWorkerEnv } from '../src/index';
import { SqliteD1 } from './helpers/wg-storage';
import { createLocalDemoWorker } from '../src/local-worker';

const release = { version: '0.31.0', commit: 'a'.repeat(40) };

function env(): DemoWorkerEnv {
  const db = new SqliteD1();
  db.putRecord('control', 'demo', { state: 'online', publicMessage: 'Available.', updatedAt: '2026-10-05T00:00:00.000Z', updatedBy: 'test' });
  db.putRecord('control', 'crawler', { state: 'disabled', updatedAt: '2026-10-05T00:00:00.000Z', updatedBy: 'test' });
  return {
    WG_APP: 'demo',
    WG_OPS_TOKEN: 'test-ops-token',
    WG_SESSION_KEY: 's'.repeat(32),
    WG_DB: db,
    GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
    GITHUB_BRANCH: 'main',
    ASSETS: { fetch: async () => new Response('asset') },
  };
}

describe('DEMO-459 shared shell boundary', () => {
  it('preserves release host and TLS guards while adapting only development entries', async () => {
    const strict = createDemoWorker(release);
    expect((await strict.fetch(new Request('https://localhost/version.json'), env(), {} as never)).status).toBe(421);
    expect((await strict.fetch(new Request('http://demo.wizardgang.ai/version.json'), env(), {} as never)).status).toBe(308);
    expect(() => createLocalDemoWorker(release)).toThrow('development identity');
    const local = createLocalDemoWorker({ ...release, version: '0.0.0-dev' });
    const response = await local.fetch(new Request('http://127.0.0.1:8787/version.json'), env(), {} as never);
    expect(await response.json()).toMatchObject({ app: 'demo', version: '0.0.0-dev' });
    const denied = await local.fetch(new Request('http://127.0.0.1:8787/admin/api/labs/git-delivery'), env(), {} as never);
    expect(denied.status).toBe(401);
    const foreign = await local.fetch(new Request('http://foreign.example/version.json'), env(), {} as never);
    expect(foreign.status).toBe(421);
    const authorization = `Basic ${btoa('ops:test-ops-token')}`;
    const post = (origin: string) => new Request('http://127.0.0.1:8787/admin/api/labs/git-delivery', {
      method: 'POST', headers: { authorization, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ bump: 'invalid' }),
    });
    const accepted = await local.fetch(post('http://127.0.0.1:8787'), env(), {} as never);
    expect(accepted.status).toBe(400);
    expect(await accepted.json()).toMatchObject({ error: 'invalid_version_bump' });
    expect((await local.fetch(post('http://127.0.0.1:9999'), env(), {} as never)).status).toBe(403);
    expect((await local.fetch(post('https://foreign.example'), env(), {} as never)).status).toBe(403);
    const created = await local.fetch(new Request('http://127.0.0.1:8787/api/labs/d1-users', {
      method: 'POST', headers: { origin: 'http://127.0.0.1:8787', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Local body proof', email: 'local@example.test', role: 'member' }),
    }), env(), {} as never);
    expect(created.status).toBe(201);
    expect(await created.text()).toContain('Local body proof');
  });
  it('publishes shell version identity from the release build', async () => {
    const worker = createDemoWorker(release);
    const response = await worker.fetch(new Request('https://demo.wizardgang.ai/version.json'), env(), {} as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ app: 'demo', version: '0.31.0', commit: release.commit });
  });

  it('uses WG_OPS_TOKEN at the shell and passes only the authenticated decision to /admin routes', async () => {
    const worker = createDemoWorker(release);
    const environment = env();
    const url = 'https://demo.wizardgang.ai/admin/api/labs/git-delivery?preflight=invalid';
    const denied = await worker.fetch(new Request(url), environment, {} as never);
    expect(denied.status).toBe(401);

    const authorization = `Basic ${btoa('ops:test-ops-token')}`;
    const accepted = await worker.fetch(new Request(url, { headers: { authorization } }), environment, {} as never);
    expect(accepted.status).toBe(400);
    expect(await accepted.json()).toMatchObject({ error: 'invalid_version_bump' });
    expect(environment.WG_DB.dump()).not.toContain('test-ops-token');
  });

  it('gates privileged Git release controls under /admin with the shared operator token', async () => {
    const worker = createDemoWorker(release);
    const environment = env();
    const url = 'https://demo.wizardgang.ai/admin/api/labs/git-delivery?preflight=patch';
    const denied = await worker.fetch(new Request(url), environment, {} as never);
    expect(denied.status).toBe(401);

    const authorization = `Basic ${btoa('ops:test-ops-token')}`;
    const upstream = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('test upstream unavailable'));
    try {
      const admitted = await worker.fetch(new Request(url, { headers: { authorization } }), environment, {} as never);
      expect(admitted.status).toBe(503);
      expect(await admitted.json()).toMatchObject({ error: 'github_preflight_unavailable' });
      expect(upstream).toHaveBeenCalled();
    } finally {
      upstream.mockRestore();
    }
    expect(environment.WG_DB.dump()).not.toContain('test-ops-token');
  });

  it('keeps GPTBot blocked in the shell robots policy', async () => {
    const worker = createDemoWorker(release);
    const response = await worker.fetch(new Request('https://demo.wizardgang.ai/robots.txt'), env(), {} as never);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('User-agent: GPTBot\nDisallow: /');
  });
});
