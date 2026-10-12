import { describe, expect, it } from 'vitest';
import { restDemoResponse } from '../src/api/rest-demo';
import { authorize } from '../src/lib/authorization';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

function env(): Env {
  return {
    WG_DB: new SqliteD1(),
    WG_SESSION_KEY: 'test-identity-secret-with-at-least-32-characters',
    GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
    GITHUB_BRANCH: 'main',
  };
}

describe('shared application authorization', () => {
  it('allows anonymous reads but protects writes', async () => {
    const environment = env();
    expect(await authorize(new Request('https://demo.example/graphql'), environment, 'demo:read')).toMatchObject({ authentication: 'anonymous' });
    const denied = await authorize(new Request('https://demo.example/graphql'), environment, 'demo:write');
    expect(denied).toBeInstanceOf(Response);
    expect((denied as Response).status).toBe(401);
  });
});

describe('anonymous REST demo records', () => {
  it('supports OpenAPI-style CRUD without an authorization header', async () => {
    const environment = env();
    const created = await restDemoResponse(new Request('https://demo.example/api/labs/rest-demo-records', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'hello', value: { message: 'worker' } }),
    }), environment);
    expect(created.status).toBe(201);
    const cookie = created.headers.get('set-cookie');
    expect(cookie).toContain('wg_demo_session=');
    const sessionHeaders = { cookie: cookie!.split(';')[0] };

    const listed = await restDemoResponse(new Request('https://demo.example/api/labs/rest-demo-records', { headers: sessionHeaders }), environment);
    expect(await listed.json()).toMatchObject({ results: [{ key: 'hello', value: { message: 'worker' } }], count: 1 });
    const patched = await restDemoResponse(new Request('https://demo.example/api/labs/rest-demo-records/hello', {
      method: 'PATCH', headers: { ...sessionHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ value: { message: 'patched' } }),
    }), environment, 'hello');
    expect(patched.status).toBe(200);
    const deleted = await restDemoResponse(new Request('https://demo.example/api/labs/rest-demo-records/hello', { method: 'DELETE', headers: sessionHeaders }), environment, 'hello');
    expect(deleted.status).toBe(204);
  });
});
