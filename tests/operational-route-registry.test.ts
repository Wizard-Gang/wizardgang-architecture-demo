import { describe, expect, it } from 'vitest';
import { matchRoute } from '../src/routing/registry';
import { operationalRouteRegistry } from '../src/routing/operational-routes';
import { removedHtmlPathnames, retiredOperationsHtmlPathname } from './fixtures/removed-html-pathnames';

const expectedPolicies = [
  {
    id: 'operations.admin', pattern: '/admin', methods: ['GET', 'POST'], kind: 'page', visibility: 'private',
    authentication: { mode: 'required', provider: 'wg-ops' }, authorization: { mode: 'policy', policy: 'admin' },
    sameOrigin: { mode: 'required', methods: ['POST'] }, offline: { mode: 'available' }, cache: { mode: 'no-store' },
    crawler: { crawling: 'allow', indexing: 'deny' },
  },
  {
    id: 'operations.admin-git-delivery', pattern: '/admin/api/labs/git-delivery', methods: ['GET', 'POST'], kind: 'api', visibility: 'private',
    authentication: { mode: 'required', provider: 'wg-ops' }, authorization: { mode: 'policy', policy: 'admin + release controls' },
    sameOrigin: { mode: 'required', methods: ['POST'] }, offline: { mode: 'gated' }, cache: { mode: 'no-store' },
    crawler: { crawling: 'deny', indexing: 'deny' },
  },
  {
    id: 'operations.admin-git-release', pattern: '/admin/api/labs/git-release', methods: ['POST'], kind: 'api', visibility: 'private',
    authentication: { mode: 'required', provider: 'wg-ops' }, authorization: { mode: 'policy', policy: 'admin + release-ready controls' },
    sameOrigin: { mode: 'required', methods: ['POST'] }, offline: { mode: 'gated' }, cache: { mode: 'no-store' },
    crawler: { crawling: 'deny', indexing: 'deny' },
  },
  {
    id: 'operations.offline', pattern: '/offline', methods: ['GET'], kind: 'page', visibility: 'public',
    authentication: { mode: 'anonymous' }, authorization: { mode: 'none' }, sameOrigin: { mode: 'not-required' },
    offline: { mode: 'available' }, cache: { mode: 'no-store' }, crawler: { crawling: 'controlled', indexing: 'deny' },
  },
  {
    id: 'operations.health', pattern: '/api/operations/health', methods: ['GET'], kind: 'api', visibility: 'public',
    authentication: { mode: 'anonymous' }, authorization: { mode: 'none' }, sameOrigin: { mode: 'not-required' },
    offline: { mode: 'available' }, cache: { mode: 'no-store' }, crawler: { crawling: 'controlled', indexing: 'deny' },
  },
  {
    id: 'operations.version', pattern: '/api/operations/version', methods: ['GET'], kind: 'api', visibility: 'public',
    authentication: { mode: 'anonymous' }, authorization: { mode: 'none' }, sameOrigin: { mode: 'not-required' },
    offline: { mode: 'available' }, cache: { mode: 'no-store' }, crawler: { crawling: 'controlled', indexing: 'deny' },
  },
  {
    id: 'operations.robots', pattern: '/robots.txt', methods: ['GET', 'HEAD'], kind: 'protocol', visibility: 'public',
    authentication: { mode: 'anonymous' }, authorization: { mode: 'none' }, sameOrigin: { mode: 'not-required' },
    offline: { mode: 'available' }, cache: { mode: 'no-store' }, crawler: { crawling: 'allow', indexing: 'deny' },
  },
  {
    id: 'operations.security-txt', pattern: '/.well-known/security.txt', methods: ['GET', 'HEAD'], kind: 'protocol', visibility: 'public',
    authentication: { mode: 'anonymous' }, authorization: { mode: 'none' }, sameOrigin: { mode: 'not-required' },
    offline: { mode: 'available' }, cache: { mode: 'public', maxAgeSeconds: 3600 }, crawler: { crawling: 'allow', indexing: 'deny' },
  },
  {
    id: 'operations.assets', pattern: '/assets/:asset', methods: ['GET', 'HEAD'], kind: 'asset', visibility: 'public',
    authentication: { mode: 'anonymous' }, authorization: { mode: 'none' }, sameOrigin: { mode: 'not-required' },
    offline: { mode: 'available' }, cache: { mode: 'public', maxAgeSeconds: 31_536_000, immutable: true }, crawler: { crawling: 'controlled', indexing: 'deny' },
  },
  {
    id: 'operations.sitemap', pattern: '/sitemap.xml', methods: ['GET'], kind: 'protocol', visibility: 'public',
    authentication: { mode: 'anonymous' }, authorization: { mode: 'none' }, sameOrigin: { mode: 'not-required' },
    offline: { mode: 'gated' }, cache: { mode: 'public', maxAgeSeconds: 3600 }, crawler: { crawling: 'controlled', indexing: 'deny' },
  },
  ...[
  ].map(([id, pattern, methods]) => ({
    id, pattern, methods, kind: 'api', visibility: 'public',
    authentication: { mode: 'anonymous' }, authorization: { mode: 'none' }, sameOrigin: { mode: 'not-required' },
    offline: { mode: 'available' }, cache: { mode: 'no-store' }, crawler: { crawling: 'controlled', indexing: 'deny' },
  })),
];

const retiredOperationsPaths = removedHtmlPathnames
  .filter((entry) => entry.outcome === '404' && (entry.pathname === retiredOperationsHtmlPathname || entry.pathname.startsWith(`${retiredOperationsHtmlPathname}/`) || entry.pathname.startsWith('/dashboard')))
  .map((entry) => entry.pathname);

describe('global operational route policies', () => {
  it('declares the complete policy contract for every operational route', () => {
    expect(operationalRouteRegistry.declarations.map((route) => ({
      id: route.id,
      pattern: route.pattern,
      methods: route.methods,
      kind: route.kind,
      visibility: route.visibility,
      authentication: route.authentication,
      authorization: route.authorization,
      sameOrigin: route.sameOrigin,
      offline: route.offline,
      cache: route.cache,
      crawler: route.crawler,
    }))).toEqual(expectedPolicies);
  });

  it('matches every declared method and rejects undeclared methods from route metadata', () => {
    for (const route of operationalRouteRegistry.declarations) {
      for (const method of route.methods) {
        expect(matchRoute(operationalRouteRegistry, method, route.pattern), `${method} ${route.pattern}`).toMatchObject({
          status: 'matched', route: { id: route.id },
        });
      }
      const unsupported = route.methods.includes('DELETE') ? 'PUT' : 'DELETE';
      expect(matchRoute(operationalRouteRegistry, unsupported, route.pattern), `${unsupported} ${route.pattern}`).toMatchObject({
        status: 'method-not-allowed', route: { id: route.id }, allowedMethods: route.methods,
      });
    }
  });

  it('does not register the retired public operations page, dashboard paths, child paths, aliases, or unknown paths', () => {
    for (const path of [...retiredOperationsPaths, '/dashboard/not-a-route', `${retiredOperationsHtmlPathname}/not-a-route`]) {
      expect(matchRoute(operationalRouteRegistry, 'GET', path), path).toEqual({ status: 'not-found', statusCode: 404 });
    }
    expect(matchRoute(operationalRouteRegistry, 'GET', '/api/operations/not-a-route')).toEqual({ status: 'not-found', statusCode: 404 });
  });

  it('keeps hidden admin/offline pages but no indexable public operations page', () => {
    expect(operationalRouteRegistry.declarations.find((route) => route.id === 'operations.index')).toBeUndefined();
    expect(operationalRouteRegistry.declarations.find((route) => route.id === 'operations.admin')?.offline).toEqual({ mode: 'available' });
    expect(operationalRouteRegistry.declarations.find((route) => route.id === 'operations.offline')?.offline).toEqual({ mode: 'available' });
    expect(operationalRouteRegistry.declarations.filter((route) => route.kind === 'page' && route.visibility === 'public' && route.crawler.indexing === 'allow')).toEqual([]);
  });

  it('attaches documentation and source metadata to every operational route', () => {
    for (const route of operationalRouteRegistry.declarations) {
      expect(route.documentation.title).not.toBe('');
      expect(route.documentation.description).not.toBe('');
      expect(route.source.module).toMatch(/^src\//);
      expect(route.source.exportName).toBeTruthy();
      expect(route.source.tests).toContain('tests/operational-route-registry.test.ts');
    }
  });
});
