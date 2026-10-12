import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { interfaceIdentityCapabilities } from '../src/interfaces/route-capabilities';
import {
  defineInterfaceIdentityCapability,
  interfaceIdentityRoute,
} from '../src/interfaces/route-capability';
import {
  createInterfaceIdentityRouteRegistry,
  interfaceIdentityRouteRegistry,
} from '../src/routing/interface-identity-routes';
import { routeUrl } from '../src/routing/application-routes';
import { matchRoute } from '../src/routing/registry';
import { routeRequest } from '../src/router';
import type { Env } from '../src/types';
import { demoDatabase } from './helpers/wg-storage';

const onlineEnv = {
  WG_DB: demoDatabase({ crawler: 'enabled' }),
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
} as unknown as Env;

const routes = interfaceIdentityCapabilities.flatMap((capability) => capability.routes);
const routeById = (id: string) => {
  const route = routes.find((candidate) => candidate.id === id);
  if (!route) throw new Error(`Missing route ${id}`);
  return route;
};

describe('interface and identity declarative routing', () => {
  it('owns the consolidated demo page and canonical interface protocols', () => {
    expect(routes.map((route) => route.pattern).sort()).toEqual([
      '/',
      routeUrl('demos.index'),
      '/api/demos/:demo',
      '/api/openapi.json',
      '/graphql',
      '/webhooks/github',
      '/auth/authorize',
      '/auth/token',
      '/auth/microsoft',
      '/auth/microsoft/callback',
      '/auth/google',
      '/auth/google/callback',
      '/auth/github',
      '/auth/github/callback',
      '/auth/saml',
      '/auth/saml/acs',
      '/auth/saml/metadata',
      '/auth/session',
      '/auth/logout',
      '/mcp',
    ].sort());

    for (const route of routes) {
      expect(route.methods.length, route.id).toBeGreaterThan(0);
      expect(route.authentication, route.id).toBeDefined();
      expect(route.authorization, route.id).toBeDefined();
      expect(route.offline, route.id).toEqual({ mode: 'gated' });
      expect(route.cache, route.id).toBeDefined();
      expect(route.source.module, route.id).toMatch(/^src\//);
      expect(route.source.tests, route.id).toContain('tests/interface-identity-routing.test.ts');
      expect(route.handler, route.id).toBeTypeOf('function');
    }
  });

  it('uses the shared matcher for consistent method routing', async () => {
    const openApiPost = matchRoute(interfaceIdentityRouteRegistry, 'POST', '/api/openapi.json');
    expect(openApiPost.status).toBe('method-not-allowed');
    if (openApiPost.status === 'method-not-allowed') expect(openApiPost.allowedMethods).toEqual(['GET']);

    const samlGet = matchRoute(interfaceIdentityRouteRegistry, 'GET', '/auth/saml/acs');
    expect(samlGet.status).toBe('method-not-allowed');
    if (samlGet.status === 'method-not-allowed') expect(samlGet.allowedMethods).toEqual(['POST']);

  });

  it('declares the authentication, authorization, and origin boundaries', () => {
    expect(routeById('interfaces.identity.authorize')).toMatchObject({
      authentication: { mode: 'required', provider: 'identity-session' },
      authorization: { mode: 'policy', policy: 'demo:read or demo:write' },
      sameOrigin: { mode: 'required', methods: ['POST'] },
      visibility: 'private',
    });
    expect(routeById('interfaces.identity.saml.acs').sameOrigin).toEqual({ mode: 'not-required' });
    expect(routeById('interfaces.graphql.endpoint')).toMatchObject({
      authorization: { mode: 'policy', policy: 'demo:read; mutations require demo:write' },
      sameOrigin: { mode: 'required', methods: ['POST'] },
    });
    expect(routeById('interfaces.webhooks.github').authorization).toMatchObject({ mode: 'policy' });
    expect(routeById('interfaces.mcp.server').authorization).toMatchObject({ mode: 'policy' });
  });

  it('registers the canonical protocol endpoints and callbacks', () => {
    expect(routeById('interfaces.graphql.endpoint')).toMatchObject({ kind: 'protocol', methods: ['GET', 'POST'] });
    expect(routeById('interfaces.webhooks.github')).toMatchObject({ kind: 'protocol', methods: ['POST'] });
    expect(routeById('interfaces.identity.microsoft.callback')).toMatchObject({ pattern: '/auth/microsoft/callback', kind: 'protocol', methods: ['GET'] });
    expect(routeById('interfaces.identity.google.callback')).toMatchObject({ pattern: '/auth/google/callback', kind: 'protocol', methods: ['GET'] });
    expect(routeById('interfaces.identity.github.callback')).toMatchObject({ pattern: '/auth/github/callback', kind: 'protocol', methods: ['GET'] });
    expect(routeById('interfaces.identity.saml.acs')).toMatchObject({ pattern: '/auth/saml/acs', kind: 'protocol', methods: ['POST'] });
    expect(routeById('interfaces.mcp.server')).toMatchObject({ pattern: '/mcp', kind: 'protocol', methods: ['GET', 'POST', 'DELETE'] });
  });

  it('keeps browser response behavior in declarative route metadata', () => {
    expect(routeById('interfaces.graphql.endpoint').browserHtml).toBe('never');
    expect(routeById('interfaces.mcp.server').browserHtml).toBe('never');
    expect(routeById('demos.index').browserHtml).toBe('page');
    expect(routeById('demos.presentation')).toMatchObject({ kind: 'api', browserHtml: 'never' });
  });

  it('can register a compatible new interface without modifying the central router', async () => {
    const syntheticPath = '/synthetic-interface/ping';
    const synthetic = defineInterfaceIdentityCapability('interfaces.synthetic', [
      interfaceIdentityRoute({
        id: 'interfaces.synthetic.ping',
        pattern: syntheticPath,
        methods: ['GET'],
        kind: 'api',
        handler: () => new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }),
        title: 'Synthetic interface',
        description: 'Test-only interface capability.',
        sourceModule: 'tests/interface-identity-routing.test.ts',
        sourceExport: 'synthetic',
      }),
    ]);
    const routeRegistry = createInterfaceIdentityRouteRegistry([...interfaceIdentityCapabilities, synthetic]);
    const match = matchRoute(routeRegistry, 'GET', syntheticPath);
    expect(match.status).toBe('matched');
    if (match.status !== 'matched') throw new Error('Synthetic interface route did not match.');
    const response = await match.route.handler(new Request(`https://demo.wizardgang.ai${syntheticPath}`), { env: onlineEnv }, match.params);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fs.readFileSync('src/router.ts', 'utf8')).not.toContain(syntheticPath);
  });

  it('keeps unknown interface paths unregistered and 404s from the main router', async () => {
    expect(matchRoute(interfaceIdentityRouteRegistry, 'GET', '/identity/not-a-route')).toEqual({ status: 'not-found', statusCode: 404 });

    const response = await routeRequest(
      new Request('https://demo.wizardgang.ai/identity/not-a-route'),
      onlineEnv,
    );
    expect(response.status).toBe(404);
  });

  it('removes migrated interface path checks and the demo fallback from the central router', () => {
    const centralRouterSource = fs.readFileSync('src/router.ts', 'utf8');
    expect(centralRouterSource).toContain('applicationRouteRegistry');
    expect(centralRouterSource).not.toContain('routeInterfaceIdentityRequest');
    expect(centralRouterSource).not.toContain('demosByRoute');

    for (const route of routes) {
      if (route.pattern === '/') continue;
      expect(centralRouterSource, route.pattern).not.toContain(`'${route.pattern}'`);
      expect(centralRouterSource, route.pattern).not.toContain(`\"${route.pattern}\"`);
    }
  });
});
