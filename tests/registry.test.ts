import { describe, expect, it } from 'vitest';
import { sitemapResponse } from '../src/api/sitemap';
import {
  applicationRouteRegistry,
  routeUrl,
  type ApplicationRouteDeclaration,
} from '../src/routing/application-routes';
import {
  architectureMapEntries,
  primaryNavigation,
  sitemapPaths,
} from '../src/routing/navigation';
import { operationalRouteRegistry } from '../src/routing/operational-routes';
import { matchRoute } from '../src/routing/registry';
import { readFileSync } from 'node:fs';
import { retiredApiReferencePrefixes } from './fixtures/removed-api-pathnames';
import { retiredOperationsHtmlPathname } from './fixtures/removed-html-pathnames';

const applicationRoutes = applicationRouteRegistry.declarations as readonly ApplicationRouteDeclaration[];

describe('architecture demo registry', () => {
  it('derives visitor navigation and architecture cards from page declarations', () => {
    const primary = primaryNavigation();
    expect(primary.map((route) => route.page?.label)).toEqual(['Demos']);
    expect(primary.every((route) => route.page?.navigation === 'primary')).toBe(true);
    expect(primary.every((route) => route.page?.parent === 'interfaces.frontend.index')).toBe(true);
    expect(primary.some((route) => route.id === 'interfaces.frontend.index')).toBe(false);
    expect(architectureMapEntries().map((route) => route.id)).toEqual(['demos.index']);
  });

  it('keeps the retired operations page out of the registered routes', () => {
    expect(applicationRoutes.some((route) => route.id === 'operations.index')).toBe(false);
  });

  it('uses unique public architecture routes', () => {
    const entries = architectureMapEntries();
    expect(new Set(entries.map((route) => route.pattern)).size).toBe(entries.length);
  });

  it('keeps an implementation source on every architecture demo route', () => {
    const entries = architectureMapEntries();
    expect(entries.every((route) => Boolean(route.source.module.trim()))).toBe(true);
  });

  it('keeps every architecture route absolute', () => {
    expect(architectureMapEntries().every((route) => route.pattern.startsWith('/'))).toBe(true);
  });

  it('retires the canonical operations page and dashboard route family without an alias', () => {
    expect(applicationRoutes.some((route) => route.id === 'operations.index')).toBe(false);
    expect(applicationRoutes.some((route) => route.pattern === retiredOperationsHtmlPathname)).toBe(false);
    expect(applicationRoutes.some((route) => route.id === 'operations.page')).toBe(false);
    expect(applicationRoutes.some((route) => route.pattern.startsWith('/dashboard'))).toBe(false);
    expect(sitemapPaths()).not.toContain(retiredOperationsHtmlPathname);
  });

  it('keeps derived page metadata synchronized with the machine route manifest', () => {
    const manifest = JSON.parse(readFileSync('src/generated/route-manifest.json', 'utf8')) as Array<{
      id: string;
      route: string;
      source: { module: string };
      status: string;
      navigation?: {
        parent?: string;
        label: string;
        order: number;
        navigation: 'primary' | 'secondary';
        architectureMap: boolean;
        sitemap: boolean;
      };
    }>;
    for (const route of applicationRoutes.filter((candidate) => candidate.page && candidate.page.navigation !== 'none')) {
      const entry = manifest.find((candidate) => candidate.id === route.id);
      expect(entry, `missing manifest entry for ${route.id}`).toBeDefined();
      expect(entry?.source.module).toBe(route.source.module);
      expect(entry?.status).toBe('working');
      expect(entry?.navigation).toMatchObject({
        label: route.page?.label,
        order: route.page?.order,
        navigation: route.page?.navigation,
        architectureMap: route.page?.architectureMap,
        sitemap: sitemapPaths().includes(route.pattern),
      });
      expect(entry?.navigation?.parent).toBe(route.page?.parent);
    }
    const architectureIds = new Set(architectureMapEntries().map((route) => route.id));
    expect(manifest.filter((entry) => architectureIds.has(entry.id))).toHaveLength(architectureIds.size);
  });
});

describe('intentional offline route policies', () => {
  it('keeps registered operational machine and recovery surfaces reachable', () => {
    for (const route of [
      '/api/operations/health', '/api/operations/version', '/api/operations/logs',
      '/api/operations/budget', '/offline', '/admin', '/robots.txt', '/.well-known/security.txt', '/assets/:asset',
    ]) {
      const declaration = operationalRouteRegistry.declarations.find((candidate) => candidate.pattern === route);
      expect(declaration, route).toBeDefined();
      expect(declaration?.offline.mode, route).toBe('available');
    }
    expect(operationalRouteRegistry.declarations.some((route) => route.pattern === retiredOperationsHtmlPathname)).toBe(false);
  });

  it('keeps sitemap gated and ordinary demo routes outside the operational registry', () => {
    const sitemap = operationalRouteRegistry.declarations.find((candidate) => candidate.pattern === '/sitemap.xml');
    expect(sitemap?.offline.mode).toBe('gated');

    for (const route of ['/edge', '/d1', '/api', '/graphql', '/webhooks', '/identity', '/mcp', '/evidence', '/governance/risks', '/governance/incidents']) {
      expect(matchRoute(operationalRouteRegistry, 'GET', route), route).toEqual({ status: 'not-found', statusCode: 404 });
    }
  });

  it('declares browser response behavior without API-prefix or HTML-path inference', () => {
    const browserPolicy = (pattern: string) => applicationRoutes.find((route) => route.pattern === pattern)?.browserHtml;
    for (const pattern of [
      '/api/labs/edge',
      '/api/operations/logs',
      '/mcp',
    ]) expect(browserPolicy(pattern), pattern).toBe('never');
    expect(browserPolicy('/graphql')).toBe('never');
    expect(browserPolicy('/mcp/server')).toBeUndefined();
    expect(browserPolicy(routeUrl('demos.index'))).toBe('page');
    expect(browserPolicy(retiredOperationsHtmlPathname)).toBeUndefined();
    expect(browserPolicy('/edge')).toBeUndefined();
    expect(applicationRoutes.some((route) => route.pattern === `${retiredApiReferencePrefixes[0]}/things`)).toBe(false);
  });
});

describe('public sitemap', () => {
  it('publishes every derived sitemap path over https', async () => {
    const xml = await sitemapResponse(new Request('https://demo.wizardgang.ai/sitemap.xml')).text();
    for (const path of sitemapPaths()) {
      expect(xml, path).toContain(`<loc>https://demo.wizardgang.ai${path}</loc>`);
    }
    expect((xml.match(/<loc>/g) ?? []).length).toBe(sitemapPaths().length);
  });
});
