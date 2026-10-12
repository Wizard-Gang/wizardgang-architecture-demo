import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { routeRequest } from '../src/router';
import { applicationRouteRegistry, routeUrl } from '../src/routing/application-routes';
import { primaryNavigation } from '../src/routing/navigation';
import { renderReactPage, type ReactPageContent } from '../src/ui/page';
import type { Env } from '../src/types';
import { demoDatabase } from './helpers/wg-storage';

const env: Env = {
  WG_DB: demoDatabase(),
  WG_SESSION_KEY: 'test-composition-cursor-secret-that-is-long-enough',
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
};

function headings(html: string): number[] {
  return [...html.matchAll(/<h([1-6])(?:\s|>)/g)].map((match) => Number(match[1]));
}

function topLevelHtmlElements(html: string): RegExpMatchArray | null {
  return html.match(/<html\b/g);
}

function navigationLandmarks(html: string): string[] {
  return [...html.matchAll(/<nav\b[\s\S]*?<\/nav>/g)].map((match) => match[0]);
}

const publicPages = applicationRouteRegistry.declarations
  .filter((route) => route.kind === 'page' && route.visibility === 'public' && !route.pattern.includes(':'))
  .map((route) => route.pattern);
const primaryPagePaths = new Set(primaryNavigation().map((route) => route.pattern));

describe('document composition', () => {
  it('builds one document and preserves page metadata through the content boundary', async () => {
    const boundaryPath = `${routeUrl('demos.index')}#edge`;
    const content: ReactPageContent = {
      title: 'Boundary proof',
      description: 'Child description',
      body: createElement('section', null,
        createElement('h1', null, 'Boundary proof'),
        createElement('h2', null, 'Detail'),
        createElement('h3', null, 'Evidence')),
      canonicalPath: boundaryPath,
      lang: 'ar', dir: 'rtl', status: 404, cacheControl: 'no-store', noindex: true,
      headExtra: [{ name: 'boundary-proof', content: 'yes' }],
    };
    const response = renderReactPage(env, content);
    const html = await response.text();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(topLevelHtmlElements(html)).toHaveLength(1);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1(?:\s|>)/g)).toHaveLength(1);
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('<meta name="description" content="Child description"/>');
    expect(html).toContain(`<link rel="canonical" href="https://demo.wizardgang.ai${boundaryPath}"/>`);
    expect(html).toContain(`<meta property="og:url" content="https://demo.wizardgang.ai${boundaryPath}"/>`);
    expect(html).toContain('<meta name="boundary-proof" content="yes"/>');
    expect(headings(html)).toEqual([1, 2, 3]);
  });

  it('renders every registered public HTML surface through one shell with a valid heading outline', async () => {
    expect(publicPages).toContain(routeUrl('demos.index'));
    for (const path of publicPages) {
      const response = await routeRequest(new Request(`https://demo.wizardgang.ai${path}`, {
        headers: { accept: 'text/html' },
      }), env);
      const html = await response.text();
      const levels = headings(html);
      const canonical = `https://demo.wizardgang.ai${path}`;

      expect(response.status, path).toBe(200);
      expect(topLevelHtmlElements(html), path).toHaveLength(1);
      expect(html.match(/<main\b/g), path).toHaveLength(1);
      expect(html.match(/<h1(?:\s|>)/g), path).toHaveLength(1);
      const currentPageCounts = navigationLandmarks(html).map((landmark) => (landmark.match(/\baria-current="page"/g) ?? []).length);
      expect(currentPageCounts.some((count) => count === 1), path).toBe(primaryPagePaths.has(path));
      expect(currentPageCounts.every((count) => count <= 1), path).toBe(true);
      const pageHeader = html.match(/<section class="page-header[^"]*"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? '';
      expect(pageHeader, path).not.toContain('class="eyebrow"');
      expect(levels[0], path).toBe(1);
      expect(html.indexOf('<h1'), path).toBeGreaterThan(html.indexOf('<main'));
      for (let index = 1; index < levels.length; index += 1) {
        expect(levels[index], `${path} heading ${index}`).toBeLessThanOrEqual(levels[index - 1] + 1);
      }
      expect(html, path).toContain(`<link rel="canonical" href="${canonical}"/>`);
      expect(html, path).toContain(`<meta property="og:url" content="${canonical}"/>`);
    }
  });
});
