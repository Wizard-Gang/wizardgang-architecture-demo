import { describe, expect, it } from 'vitest';
import {
  applicationRouteRegistry,
  routeUrl,
  type ApplicationRouteDeclaration,
} from '../src/routing/application-routes';
import { primaryNavigation, sitemapPaths } from '../src/routing/navigation';
import type { Env } from '../src/types';
import { retiredOperationsHtmlPathname } from './fixtures/removed-html-pathnames';
import { SqliteD1 } from './helpers/wg-storage';

const repositoryUrl = 'https://github.com/Wizard-Gang/wizardgang-architecture-demo';
const env = {
  WG_DB: new SqliteD1(),
  GITHUB_REPO_URL: repositoryUrl,
  GITHUB_BRANCH: 'main',
  DEPLOYED_VERSION: 'v0.test',
  DEPLOYED_SHA: '1234567890abcdef',
} as Env;

function textContent(fragment: string): string {
  return fragment.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function anchorDestinations(fragment: string): Array<{ href: string; text: string }> {
  return [...fragment.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((match) => ({ href: match[1], text: textContent(match[2]) }));
}

async function publicHome(): Promise<string> {
  const route = applicationRouteRegistry.declarations.find((candidate) => candidate.id === 'interfaces.frontend.index');
  if (!route) throw new Error('Missing interfaces.frontend.index route');
  return (await route.handler(new Request('https://demo.wizardgang.ai/'), { env }, {})).text();
}

describe('public frontend shell', () => {
  it('projects only Demos in primary navigation while Source remains direct', async () => {
    expect(primaryNavigation().map((route) => [route.page?.label, route.pattern])).toEqual([
      ['Demos', routeUrl('demos.index')],
    ]);

    const html = await publicHome();
    const header = html.match(/<header class="site-header">([\s\S]*?)<\/header>/)?.[0] ?? '';
    const nav = header.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/)?.[0] ?? '';
    expect(header).toContain(`<a class="brand" href="${routeUrl('interfaces.frontend.index')}"`);
    expect(anchorDestinations(nav)).toEqual([
      { href: routeUrl('demos.index'), text: 'Demos' },
    ]);
    expect(header).toContain('<div class="header-utilities"');
    expect(header).toContain(`href="${repositoryUrl}" aria-label="Source"><span class="utility-label">Source`);
    expect(nav).not.toMatch(/>Architecture<|>Architecture\s*|>Operations<|>Security</);
  });

  it('makes the homepage a demo launcher with compact operational proof', async () => {
    const html = await publicHome();
    const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[0] ?? '';
    expect(main).not.toBe('');
    expect(main).toContain('A live Cloudflare architecture laboratory');
    expect(main).toContain(`href="${routeUrl('demos.index')}">Explore demos</a>`);
    expect(main).not.toContain(`href="${retiredOperationsHtmlPathname}"`);
    expect(main).toContain('aria-label="Live proof"');
    expect(main).toContain('Current service state');
    expect(main).toContain('Scheduled observations');
    expect(main).toContain('v0.test');
    expect(main).toContain('Commit 1234567');
    expect(main).not.toContain('live destinations');
    expect(main).not.toContain('id="architecture-map"');
    expect(main).not.toContain('data-parent-route=');
  });

  it('links the security policy from the footer without promoting it to primary navigation', async () => {
    const html = await publicHome();
    const footer = html.match(/<footer class="site-footer">([\s\S]*?)<\/footer>/)?.[0] ?? '';
    const nav = html.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/)?.[0] ?? '';
    expect(footer).toContain(`href="${repositoryUrl}/security/policy"`);
    expect(nav).not.toContain('/security/policy');
  });

  it('keeps the minimal public browser inventory after Operations retirement', () => {
    const declarations = applicationRouteRegistry.declarations as readonly ApplicationRouteDeclaration[];
    const publicIndexableBrowserPaths = declarations
      .filter((route) => (
        route.kind === 'page'
        && route.visibility === 'public'
        && route.methods.includes('GET')
        && route.crawler.indexing === 'allow'
        && !route.pattern.includes(':')
      ))
      .map((route) => route.pattern)
      .sort();
    const expected = [
      routeUrl('interfaces.frontend.index'),
      routeUrl('demos.index'),
    ].sort();
    expect(publicIndexableBrowserPaths).toEqual(expected);
    expect([...sitemapPaths()].sort()).toEqual(expected);
    expect(publicIndexableBrowserPaths).not.toContain(retiredOperationsHtmlPathname);

    expect(declarations.find((route) => route.pattern === '/admin')).toMatchObject({
      kind: 'page', visibility: 'private', crawler: { indexing: 'deny' },
    });
    expect(declarations.find((route) => route.pattern === '/offline')).toMatchObject({
      kind: 'page', visibility: 'public', crawler: { indexing: 'deny' },
    });
  });

  it('preserves representative machine, API, protocol, identity, and crawler declarations', () => {
    const declarations = new Map(applicationRouteRegistry.declarations.map((route) => [route.id, route]));
    const expected = [
      ['interfaces.openapi.json', '/api/openapi.json', ['GET'], 'api'],
      ['interfaces.graphql.endpoint', '/graphql', ['GET', 'POST'], 'protocol'],
      ['interfaces.mcp.server', '/mcp', ['GET', 'POST', 'DELETE'], 'protocol'],
      ['interfaces.identity.saml.metadata', '/auth/saml/metadata', ['GET'], 'protocol'],
      ['interfaces.webhooks.github', '/webhooks/github', ['POST'], 'protocol'],
      ['operations.health', '/api/operations/health', ['GET'], 'api'],
      ['operations.version', '/api/operations/version', ['GET'], 'api'],
      ['operations.security-txt', '/.well-known/security.txt', ['GET', 'HEAD'], 'protocol'],
      ['operations.robots', '/robots.txt', ['GET', 'HEAD'], 'protocol'],
      ['operations.sitemap', '/sitemap.xml', ['GET'], 'protocol'],
    ] as const;

    for (const [id, pattern, methods, kind] of expected) {
      expect(declarations.get(id), id).toMatchObject({ pattern, methods: [...methods], kind });
    }
  });
});
