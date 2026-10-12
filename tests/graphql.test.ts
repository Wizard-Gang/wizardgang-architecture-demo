import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import assetManifest from '../src/generated/asset-manifest.json';
import { graphqlResponse } from '../src/api/graphql';
import { uiAssetResponse } from '../src/ui/assets';
import { createDemoAccessToken, type IdentitySession } from '../src/lib/identity-session';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

function env(): Env {
  return {
    WG_DB: new SqliteD1(),
    WG_SESSION_KEY: 'test-session-secret-with-at-least-32-characters',
    GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
    GITHUB_BRANCH: 'main',
  };
}

async function visitorAuthorization(environment: Env): Promise<string> {
  const now = new Date();
  const session: IdentitySession = {
    identity: { provider: 'github', protocol: 'oauth2', subject: 'test-user', displayName: 'Test User', assurance: 'provider-authenticated', role: 'viewer', authenticatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString() },
    providerPayloadLabel: 'Test identity', providerPayload: {}, validation: [], protocol: { name: 'OAuth 2.0', steps: [] }, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
  };
  return `Bearer ${(await createDemoAccessToken(environment, session)).token}`;
}

describe('GraphQL Yoga D1 interface', () => {
  it('serves an embeddable GraphiQL interface', async () => {
    const environment = env();
    environment.ASSETS = {
      async fetch(request) {
        const body = readFileSync('node_modules/@graphql-yoga/graphiql/dist/yoga-graphiql.umd.js');
        return new Response(request.method === 'HEAD' ? null : body, { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
      },
    };
    const response = await graphqlResponse(new Request('https://demo.example/graphql', { headers: { accept: 'text/html' } }), environment);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    const html = await response.text();
    expect(html).toContain('WizardGang GraphiQL');
    expect(html).toContain(assetManifest.assets['vendor.graphiql.script']);
    expect(html).toContain(assetManifest.assets['vendor.monaco.graphql']);
    expect(html).toContain(assetManifest.assets['scripts.graphiql']);
    expect(html).toContain('data-config=');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toContain('unpkg.com');
    const policy = response.headers.get('content-security-policy') ?? '';
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain('worker-src blob:');
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    const vendorName = assetManifest.assets['vendor.graphiql.script'].split('/').at(-1)!;
    const asset = await uiAssetResponse(new Request(`https://demo.example/assets/${vendorName}`), environment, vendorName);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    expect((await asset.text()).length).toBeGreaterThan(1_000_000);
  });

  it('queries and mutates the same session-scoped users', async () => {
    const environment = env();
    const query = JSON.stringify({ query: 'query { users { id name email role } }' });
    const first = await graphqlResponse(new Request('https://demo.example/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: query }), environment);
    const cookie = first.headers.get('set-cookie')!.split(';')[0];
    const authorization = await visitorAuthorization(environment);
    const initialBody = await first.clone().json() as { data: { users: Array<{ name: string }> } };
    expect(initialBody.data.users.some((user) => user.name === 'Ada Lovelace')).toBe(true);

    const mutation = await graphqlResponse(new Request('https://demo.example/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://demo.example', cookie, authorization },
      body: JSON.stringify({ query: 'mutation { createUser(input: { name: "Mary Jackson", email: "mary@example.test", role: MEMBER }) { name role } }' }),
    }), environment);
    expect(await mutation.json()).toMatchObject({ data: { createUser: { name: 'Mary Jackson', role: 'MEMBER' } } });

    const listed = await graphqlResponse(new Request('https://demo.example/graphql', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: query }), environment);
    expect((await listed.json() as { data: { users: unknown[] } }).data.users).toHaveLength(4);
  });

  it('rejects batching and unauthenticated mutation', async () => {
    const environment = env();
    const batched = await graphqlResponse(new Request('https://demo.example/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]' }), environment);
    expect(batched.status).toBe(400);

    const denied = await graphqlResponse(new Request('https://demo.example/graphql', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: JSON.stringify({ query: 'mutation { createUser(input: { name: "X", email: "x@example.test", role: MEMBER }) { id } }' }),
    }), environment);
    expect(await denied.json()).toMatchObject({ errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] });
  });

  it('permits bounded schema introspection for the local GraphiQL IDE', async () => {
    const response = await graphqlResponse(new Request('https://demo.example/graphql', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationName: 'IntrospectionQuery', query: 'query IntrospectionQuery { __schema { queryType { name } mutationType { name } } }' }),
    }), env());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { __schema: { queryType: { name: 'Query' }, mutationType: { name: 'Mutation' } } } });
  });
});
