import { describe, expect, it } from 'vitest';
import { sitemapResponse } from '../src/api/sitemap';
import { routeRequest } from '../src/router';
import type { Env } from '../src/types';
import {
  applicationRouteRegistry,
  createApplicationRouteRegistry,
  routeUrl,
  routeUrlFromRegistry,
  type ApplicationRouteContext,
  type PageMetadata,
} from '../src/routing/application-routes';
import {
  architectureMapEntries,
  primaryNavigation,
  sitemapPaths,
} from '../src/routing/navigation';
import { defineRouteModule, matchRoute, type RouteDeclaration } from '../src/routing/registry';
import { retiredApiReferencePrefixes } from './fixtures/removed-api-pathnames';
import { retiredOperationsHtmlPathname } from './fixtures/removed-html-pathnames';

function syntheticRoute(
  id: string,
  pattern: string,
  methods: RouteDeclaration<ApplicationRouteContext>['methods'] = ['GET'],
  kind: RouteDeclaration<ApplicationRouteContext>['kind'] = 'api',
  page?: PageMetadata,
): RouteDeclaration<ApplicationRouteContext> & { page?: PageMetadata } {
  return {
    id,
    pattern,
    methods,
    kind,
    handler: () => new Response('ok'),
    authentication: { mode: 'anonymous' },
    authorization: { mode: 'none' },
    visibility: 'public',
    sameOrigin: { mode: 'not-required' },
    cache: { mode: 'no-store' },
    crawler: { crawling: 'allow', indexing: 'deny' },
    documentation: {
      title: id,
      description: `Synthetic route ${id}`,
    },
    source: {
      module: 'tests/application-route-registry.test.ts',
      tests: ['tests/application-route-registry.test.ts'],
    },
    ...(page ? { page } : {}),
  };
}

function noDatabaseEnv(): Env {
  return {
    WG_DB: {
      prepare() {
        throw new Error('unknown paths must not consult route policy storage');
      },
    },
    GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
    GITHUB_BRANCH: 'main',
  };
}

describe('complete declarative application routing', () => {
  it('derives visitor navigation and architecture projection from page declarations', () => {
    expect(primaryNavigation().map((route) => route.id)).toEqual(['demos.index']);
    expect(primaryNavigation().map((route) => route.page?.label)).toEqual(['Demos']);
    expect(primaryNavigation().some((route) => route.id === 'interfaces.frontend.index')).toBe(false);
    expect(architectureMapEntries().map((route) => route.id)).toEqual(['demos.index']);
    expect(primaryNavigation().every((route) => route.visibility === 'public')).toBe(true);
  });

  it('generates sitemap entries from public indexable registered pages', async () => {
    const sitemapRouteIds = ['interfaces.frontend.index', 'demos.index'];
    expect([...sitemapPaths()].sort()).toEqual(sitemapRouteIds.map((routeId) => routeUrl(routeId)).sort());
    const response = sitemapResponse(new Request('https://demo.wizardgang.ai/sitemap.xml'));
    const xml = await response.text();
    for (const routePath of sitemapPaths()) {
      expect(xml).toContain(`<loc>https://demo.wizardgang.ai${routePath}</loc>`);
    }
    expect(xml).not.toContain(`<loc>https://demo.wizardgang.ai${retiredOperationsHtmlPathname}</loc>`);
    expect(xml).not.toContain('/admin</loc>');
    expect(xml).not.toContain(`${retiredApiReferencePrefixes[0]}/`);
  });

  it('resolves internal URLs by stable route ID, including encoded parameters', () => {
    expect(routeUrl('interfaces.openapi.json')).toBe('/api/openapi.json');
    const parameterized = applicationRouteRegistry.declarations.find((route) => route.pattern.includes(':'));
    expect(parameterized).toBeTruthy();
    const names = [...parameterized!.pattern.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]);
    const params = Object.fromEntries(names.map((name) => [name, 'A B']));
    const resolved = routeUrlFromRegistry(applicationRouteRegistry, parameterized!.id, params);
    expect(resolved).not.toContain(':');
    expect(resolved).toContain('A%20B');
    expect(() => routeUrlFromRegistry(applicationRouteRegistry, parameterized!.id)).toThrow('Missing route parameter');
  });

  it('allows an additional page without encoding a fixed page inventory', () => {
    const extraPage = syntheticRoute(
      'synthetic.page',
      '/synthetic-page',
      ['GET'],
      'page',
      {
        parent: 'interfaces.frontend.index',
        label: 'Synthetic page',
        summary: 'A compatible additional page registered by a test capability.',
        order: 99,
        navigation: 'secondary',
        architectureMap: true,
      },
    );
    extraPage.crawler = { crawling: 'allow', indexing: 'allow' };
    const registry = createApplicationRouteRegistry([
      defineRouteModule('synthetic.page', [extraPage]),
    ]);
    expect(registry.declarations.find((route) => route.id === 'synthetic.page')).toMatchObject({
      pattern: '/synthetic-page',
      kind: 'page',
    });
  });

  it('uses one consistent method result from the application registry', () => {
    expect(matchRoute(applicationRouteRegistry, 'POST', routeUrl('demos.index'))).toMatchObject({
      status: 'method-not-allowed',
      allowedMethods: ['GET'],
      route: { id: 'demos.index' },
    });
    expect(matchRoute(applicationRouteRegistry, 'PUT', '/mcp')).toMatchObject({
      status: 'method-not-allowed',
      allowedMethods: ['GET', 'POST', 'DELETE'],
      route: { id: 'interfaces.mcp.server' },
    });
    expect(matchRoute(applicationRouteRegistry, 'GET', '/mcp')).toMatchObject({
      status: 'matched',
      route: { id: 'interfaces.mcp.server' },
    });
  });

  it('requires complete reachable policy, documentation, and page hierarchy metadata', () => {
    for (const route of applicationRouteRegistry.declarations) {
      expect(route.documentation.title.trim(), route.id).not.toBe('');
      expect(route.documentation.description.trim(), route.id).not.toBe('');
      expect(route.source.module.trim(), route.id).not.toBe('');
      if (route.kind === 'page') {
        expect(route.methods, route.id).toContain('GET');
        expect(route.page, route.id).toBeDefined();
        if (route.page?.parent) {
          expect(applicationRouteRegistry.declarations.some((candidate) => (
            candidate.kind === 'page' && candidate.id === route.page?.parent
          )), route.id).toBe(true);
        }
      }
      if (route.visibility === 'private') {
        expect(route.crawler.indexing, route.id).toBe('deny');
        expect(route.cache.mode, route.id).not.toBe('public');
      }
    }

    const undocumented = syntheticRoute('synthetic.undocumented', '/synthetic-undocumented');
    undocumented.documentation = { title: '', description: '' };
    expect(() => createApplicationRouteRegistry([
      defineRouteModule('synthetic.undocumented', [undocumented]),
    ])).toThrow('undocumented');

    const unreachable = syntheticRoute('synthetic.unreachable', '/synthetic-unreachable', ['POST'], 'page', {
      parent: 'interfaces.frontend.index',
      label: 'Unreachable',
      summary: 'Synthetic unreachable page.',
      order: 100,
      navigation: 'none',
      architectureMap: false,
    });
    expect(() => createApplicationRouteRegistry([
      defineRouteModule('synthetic.unreachable', [unreachable]),
    ])).toThrow('unreachable as a page');
  });

  it('rejects collisions across capability boundaries', () => {
    expect(() => createApplicationRouteRegistry([
      defineRouteModule('synthetic.duplicate', [syntheticRoute('synthetic.duplicate', '/api/operations/health')]),
    ])).toThrow("Duplicate route pattern '/api/operations/health'");

    expect(() => createApplicationRouteRegistry([
      defineRouteModule('synthetic.ambiguous', [
        syntheticRoute('synthetic.ambiguous-a', '/synthetic/:section/edit'),
        syntheticRoute('synthetic.ambiguous-b', '/synthetic/new/:action'),
      ]),
    ])).toThrow('Ambiguous route patterns');
  });

  it('keeps removed aliases and unknown paths on the normal 404 without consulting storage', async () => {
    for (const path of [
      '/api', '/webhooks', '/identity', '/mcp/server', '/i18n', '/accessibility', retiredOperationsHtmlPathname,
      '/not-registered', '/legacy/compliance',
    ]) {
      const response = await routeRequest(new Request(`https://demo.wizardgang.ai${path}`), noDatabaseEnv());
      expect(response.status, path).toBe(404);
    }
  });
});
