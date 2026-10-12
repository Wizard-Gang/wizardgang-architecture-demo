import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { applicationRouteRegistry, routeUrl } from '../src/routing/application-routes';
import { architectureMapEntries, primaryNavigation } from '../src/routing/navigation';
import type { Env } from '../src/types';
import { reactPageContent, renderReactPage } from '../src/ui/page';
import { retiredOperationsHtmlPathname } from './fixtures/removed-html-pathnames';

const shellStyles = readFileSync('src/styles/shell.css', 'utf8');
const demoStyles = readFileSync('src/styles/demos.css', 'utf8');

const env = {
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
  DEPLOYED_VERSION: 'test',
} as Env;

const publicPages = applicationRouteRegistry.declarations.filter((route) => (
  route.kind === 'page'
  && route.page
  && route.visibility === 'public'
  && route.methods.includes('GET')
  && !route.pattern.includes(':')
));

const retiredShellNavigationMarkers = [
  'shell-navigation',
  'breadcrumb',
  'secondary-navigation',
  'related-navigation',
  'data-section-current',
];

function navMarkup(html: string): string {
  return [...html.matchAll(/<nav\b[\s\S]*?<\/nav>/g)].map((match) => match[0]).join('\n');
}

async function publicHome(): Promise<string> {
  const route = applicationRouteRegistry.declarations.find((candidate) => candidate.id === 'interfaces.frontend.index');
  if (!route) throw new Error('Missing interfaces.frontend.index route');
  return (await route.handler(new Request('https://demo.wizardgang.ai/'), { env }, {})).text();
}

describe('navigation projection', () => {
  it('uses registered route URLs for primary navigation links', async () => {
    const registeredPageUrls = new Set(publicPages.map((route) => routeUrl(route.id)));
    for (const route of publicPages) {
      const response = renderReactPage(env, reactPageContent(env, route.page!.label, createElement('section', { className: 'page-header' },
        createElement('h1', null, 'Projection')), {
        routeId: route.id,
        canonicalPath: routeUrl(route.id),
      }));
      const navigation = navMarkup(await response.text());
      expect(navigation, route.id).not.toContain('?view=');
      const currentPageCounts = [...navigation.matchAll(/<nav\b[\s\S]*?<\/nav>/g)]
        .map((match) => (match[0].match(/aria-current="page"/g) ?? []).length);
      const primaryIds = new Set(primaryNavigation().map((item) => item.id));
      expect(currentPageCounts.some((count) => count === 1), route.id).toBe(primaryIds.has(route.id));
      expect(currentPageCounts.every((count) => count <= 1), route.id).toBe(true);
      for (const match of navigation.matchAll(/href="([^"]+)"/g)) {
        const href = match[1];
        if (!href.startsWith('/')) continue;
        expect(registeredPageUrls.has(href), `${route.id}: ${href}`).toBe(true);
      }
    }
    expect(primaryNavigation().map((route) => route.id)).toEqual(['demos.index']);
    expect(primaryNavigation().every((route) => !routeUrl(route.id).includes('?'))).toBe(true);
  });

  it('ships no breadcrumb, secondary, or related-destination navigation in the shell', async () => {
    for (const route of publicPages) {
      const html = await (await route.handler(new Request(`https://demo.wizardgang.ai${route.pattern}`), { env }, {})).text();
      for (const marker of retiredShellNavigationMarkers) {
        expect(html, `${route.id}: ${marker}`).not.toContain(marker);
      }
      expect(navMarkup(html), route.id).not.toContain('<ol>');
    }
  });

  it('keeps the homepage focused on architecture product destinations while support surfaces stay contextual', async () => {
    const entries = architectureMapEntries();
    const html = await publicHome();
    const hrefs = new Set([...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]));
    expect(entries.map((route) => route.id)).toEqual(['demos.index']);
    for (const route of entries) {
      expect(route.page?.parent, route.id).toBeTruthy();
      expect(hrefs.has(routeUrl(route.id)), route.id).toBe(true);
      expect(route.page?.summary.trim(), route.id).not.toBe('');
    }
    expect(hrefs.has(retiredOperationsHtmlPathname)).toBe(false);
    expect(html).not.toContain('data-parent-route=');
    expect(html).not.toContain(`${entries.length} live destinations`);
  });

  it('keeps 44px primary navigation targets in the mobile shell', () => {
    expect(shellStyles).toContain('@media (max-width: 700px)');
    expect(shellStyles).toMatch(/\.nav a, \.nav button \{[^}]*min-height: 44px/);
    expect(demoStyles).toContain('.lab-grid > * { min-width: 0; }');
  });
});
