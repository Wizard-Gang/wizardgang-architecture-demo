import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applicationRouteRegistry,
  routeUrl,
} from '../src/routing/application-routes';
import { routeRequest } from '../src/router';
import { sitemapPaths } from '../src/routing/navigation';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

const environment: Env = {
  WG_DB: new SqliteD1(),
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
};

const authorization = `Basic ${btoa('operator:test-admin-password')}`;
const hrefPattern = /<a\b[^>]*\shref="([^"]+)"/gi;
const idPattern = /\sid="([^"]+)"/gi;

function renderedHrefs(html: string): string[] {
  const renderedMarkup = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  return [...renderedMarkup.matchAll(hrefPattern)]
    .map((match) => match[1].replaceAll('&amp;', '&'));
}

function internalLinks(html: string, sourceRoute: string): URL[] {
  return renderedHrefs(html)
    .filter((href) => !href.startsWith('mailto:') && !href.startsWith('data:'))
    .map((href) => new URL(href, `https://demo.wizardgang.ai${sourceRoute}`))
    .filter((url) => url.origin === 'https://demo.wizardgang.ai');
}

function registeredPageUrls(): string[] {
  return applicationRouteRegistry.declarations
    .filter((route) => route.kind === 'page')
    .map((route) => routeUrl(route.id));
}

async function get(path: string): Promise<Response> {
  return routeRequest(new Request(`https://demo.wizardgang.ai${path}`, {
    headers: { accept: 'text/html,application/json', authorization },
  }), environment);
}

describe('public link and route contract', () => {
  it('keeps every registered HTML route implemented, sourced, and canonical', async () => {
    const manifest = JSON.parse(readFileSync('src/generated/route-manifest.json', 'utf8')) as Array<{
      route: string;
      source: { module: string };
    }>;
    for (const route of sitemapPaths()) {
      const entries = manifest.filter((entry) => entry.route === route);
      expect(entries, `${route} manifest entry`).toHaveLength(1);
      expect(readFileSync(entries[0].source.module, 'utf8').length, `${route} source is empty`).toBeGreaterThan(0);
      const response = await get(route);
      expect(response.status, `${route} implementation`).toBe(200);
    }
  });

  it('resolves every internal page link and linked fragment', async () => {
    const targets = new Map<string, Set<string>>();
    const renderedPages = await Promise.all(registeredPageUrls().map(async (page) => {
      const response = await get(page);
      const html = await response.text();
      return { page, html };
    }));
    for (const { page, html } of renderedPages) {
      for (const href of renderedHrefs(html)) {
        expect((href.match(/\?/g) ?? []).length, `multiple query delimiters in ${page} href ${href}`).toBeLessThanOrEqual(1);
      }
      for (const link of internalLinks(html, page)) {
        const target = `${link.pathname}${link.search}`;
        const fragments = targets.get(target) ?? new Set<string>();
        if (link.hash) fragments.add(decodeURIComponent(link.hash.slice(1)));
        targets.set(target, fragments);
      }
    }

    await Promise.all([...targets].map(async ([target, fragments]) => {
      const response = await get(target);
      expect(response.status, `dead internal link ${target}`).not.toBe(404);
      expect(response.status, `failed internal link ${target}`).toBeLessThan(500);
      if (!fragments.size) return;
      expect(response.headers.get('content-type'), `${target} fragment target is not HTML`).toContain('text/html');
      const html = await response.text();
      const ids = new Set([...html.matchAll(idPattern)].map((match) => match[1]));
      for (const fragment of fragments) expect(ids.has(fragment), `missing ${target}#${fragment}`).toBe(true);
    }));
  }, 60_000);

  it('builds the sitemap exclusively from registered canonical HTML routes', async () => {
    const response = await get('/sitemap.xml');
    const xml = await response.text();
    const locations = [...xml.matchAll(/<loc>https:\/\/demo\.wizardgang\.ai([^<]*)<\/loc>/g)].map((match) => match[1]);
    expect(locations).toEqual(sitemapPaths());
    expect(new Set(locations).size).toBe(locations.length);
  });
});
