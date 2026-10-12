import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import auditConfig from '../config/site-audit-states.json';
import routeManifest from '../src/generated/route-manifest.json';
import {
  defaultLocale,
  localeResources,
  observeExactFallbacks,
  resolveLocalization,
  supportedLocales,
  type SupportedLocale,
} from '../src/i18n/runtime';
import { routeRequest } from '../src/router';
import { demonstrations } from '../src/demos/demos-page';
import { routeUrl } from '../src/routing/application-routes';
import {
  applicationRouteRegistry,
  type ApplicationRouteDeclaration,
} from '../src/routing/application-routes';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

const shellStyles = readFileSync('src/styles/shell.css', 'utf8');

function environment(): Env {
  return {
    WG_DB: new SqliteD1(),
    GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
    GITHUB_BRANCH: 'main',
  };
}

const publicPages = (applicationRouteRegistry.declarations as readonly ApplicationRouteDeclaration[])
  .filter((route) => route.kind === 'page' && route.visibility === 'public' && route.methods.includes('GET'));

function patternMatches(pattern: string, pathname: string): boolean {
  const expected = pattern.split('/').filter(Boolean);
  const actual = pathname.split('/').filter(Boolean);
  if (expected.length !== actual.length) return false;
  return expected.every((segment, index) => segment.startsWith(':') || segment === actual[index]);
}

function configuredStatesFor(route: ApplicationRouteDeclaration): string[] {
  return auditConfig.states
    .map((state) => state.path)
    .filter((path) => patternMatches(route.pattern, new URL(path, 'https://demo.wizardgang.ai').pathname));
}

function inheritedPath(route: ApplicationRouteDeclaration): string {
  if (!route.pattern.includes(':')) return route.pattern;
  const fixture = configuredStatesFor(route)[0];
  if (!fixture) throw new Error(`new public surface requires accessibility/i18n coverage: ${route.id}`);
  return fixture;
}

function localizedPath(path: string, locale: SupportedLocale): string {
  const url = new URL(path, 'https://demo.wizardgang.ai');
  if (locale === defaultLocale) url.searchParams.delete('lang');
  else url.searchParams.set('lang', locale);
  return `${url.pathname}${url.search}`;
}

function count(html: string, pattern: RegExp): number {
  return [...html.matchAll(pattern)].length;
}

function duplicateIds(html: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const match of html.matchAll(/\sid="([^"]+)"/g)) {
    if (seen.has(match[1])) duplicates.add(match[1]);
    seen.add(match[1]);
  }
  return [...duplicates];
}

function assertStructuralBaseline(html: string, locale: SupportedLocale, label: string): void {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  expect(html, label).toContain(`<html lang="${locale}" dir="${dir}">`);
  expect(count(html, /<main\b/g), `${label} main landmarks`).toBe(1);
  expect(html, `${label} skip link`).toContain('<a class="skip-link" href="#main">');
  expect(html, `${label} main target`).toContain('<main class="site-main" id="main">');
  expect(html, `${label} locale selector`).toContain('id="global-language"');
  expect(html, `${label} locale selector name`).toContain('aria-label=');
  expect(duplicateIds(html), `${label} duplicate ids`).toEqual([]);

  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  expect(headings.length, `${label} headings`).toBeGreaterThan(0);
  expect(headings[0]?.[1], `${label} starts with h1`).toBe('1');
  for (const heading of headings) {
    const text = heading[2].replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').trim();
    expect(text.length, `${label} empty heading`).toBeGreaterThan(0);
  }

  for (const image of html.matchAll(/<img\b[^>]*>/gi)) {
    expect(image[0], `${label} image alternative`).toMatch(/\salt=("[^"]*"|'[^']*')/i);
  }
}

describe('DEMO-238 site-wide accessibility checks', () => {
  it('inherits every canonical public page and requires explicit fixtures for parameterized surfaces', () => {
    const inventory = publicPages.map((route) => ({
      id: route.id,
      pathname: inheritedPath(route),
      parent: route.page?.parent ?? null,
      expectedPublicStatus: 200,
      stateFixtures: configuredStatesFor(route),
    }));
    expect(inventory.map((entry) => entry.id)).toContain('demos.index');
    expect(new Set(inventory.map((entry) => entry.id)).size).toBe(inventory.length);

    const manifestIds = (routeManifest as Array<{ id: string; kind: string; visibility: string; methods: string[] }>)
      .filter((route) => route.kind === 'page' && route.visibility === 'public' && route.methods.includes('GET'))
      .map((route) => route.id)
      .sort();
    expect(inventory.map((entry) => entry.id).sort()).toEqual(manifestIds);
  });

  it('enforces the structural shell on every public page in English and Arabic RTL', async () => {
    for (const route of publicPages) {
      for (const locale of [defaultLocale, 'ar'] as const) {
        const path = localizedPath(inheritedPath(route), locale);
        const response = await routeRequest(new Request(new URL(path, 'https://demo.wizardgang.ai'), { headers: { accept: 'text/html' } }), environment());
        expect(response.status, `${route.id} ${locale}`).toBe(200);
        const html = await response.text();
        assertStructuralBaseline(html, locale, `${route.id} ${locale}`);
      }
    }
  });

  it('protects the shared target, motion, forced-colors, reflow, focus, and bidi contracts', () => {
    expect(shellStyles).toContain('min-block-size: 44px !important');
    expect(shellStyles).toContain('outline: 3px solid var(--focus, #ffd84d)');
    expect(shellStyles).toContain('max-inline-size: 80ch');
    expect(shellStyles).toContain('unicode-bidi: isolate');
    expect(shellStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(shellStyles).toContain('@media (forced-colors: active)');
  });
});

describe('DEMO-238 site-wide localization checks', () => {
  it('rejects uncatalogued exact() English in demos and released fragments', async () => {
    const failures = new Set<string>();
    const stop = observeExactFallbacks((english, locale) => failures.add(`${locale}: ${english}`));
    try {
      for (const locale of supportedLocales.filter((value) => value !== defaultLocale)) {
        const paths = [
          routeUrl('demos.index'),
          ...demonstrations.map((demo) => routeUrl('demos.presentation', { demo: demo.id })),
        ];
        for (const path of paths) {
          const url = new URL(path, 'https://demo.wizardgang.ai');
          url.searchParams.set('lang', locale);
          const response = await routeRequest(new Request(url, { headers: { accept: 'text/html' } }), environment());
          expect(response.status, `${locale} ${path}`).toBe(200);
          await response.text();
        }
      }
    } finally {
      stop();
    }
    if (failures.size) {
      const values = [...failures].sort();
      throw new Error(`${values.length} uncatalogued exact() fallbacks across non-default locales:\n${values.slice(0, 40).join('\n')}${values.length > 40 ? '\n…' : ''}`);
    }
  });

  it('detects an injected uncatalogued exact() string', () => {
    const failures: string[] = [];
    const stop = observeExactFallbacks((english) => failures.push(english));
    try {
      resolveLocalization(new Request('https://demo.wizardgang.ai/demos?lang=ar'))
        .exact('Injected uncatalogued English string');
      resolveLocalization(new Request('https://demo.wizardgang.ai/demos?lang=ar'))
        .exact('GitHub');
    } finally {
      stop();
    }
    expect(failures).toEqual(['Injected uncatalogued English string']);
  });
  it('keeps the configured locale matrix synchronized with runtime resources', () => {
    expect(supportedLocales).toEqual(['en', 'es', 'fr', 'de', 'ja', 'ar']);
    const expectedKeys = Object.keys(localeResources[defaultLocale]).sort();
    for (const locale of supportedLocales) {
      expect(Object.keys(localeResources[locale]).sort(), locale).toEqual(expectedKeys);
      const context = resolveLocalization(new Request(`https://demo.wizardgang.ai/?lang=${locale}`));
      expect(context.lang).toBe(locale);
      expect(context.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(context.pluralCategory(2)).toBe(new Intl.PluralRules(locale).select(2));
      expect(context.number(12345.67)).toBe(new Intl.NumberFormat(locale).format(12345.67));
    }
  });

  it('renders every declared critical state in every supported locale without dropping route state', async () => {
    for (const state of auditConfig.states) {
      const pathname = new URL(state.path, 'https://demo.wizardgang.ai').pathname;
      const owner = publicPages.find((route) => patternMatches(route.pattern, pathname));
      expect(owner, `${state.name} owns a canonical public route`).toBeDefined();
      for (const locale of supportedLocales) {
        const path = localizedPath(state.path, locale);
        const response = await routeRequest(new Request(new URL(path, 'https://demo.wizardgang.ai'), { headers: { accept: 'text/html' } }), environment());
        expect(response.status, `${state.name} ${locale}`).toBe(200);
        expect(response.headers.get('content-language'), `${state.name} ${locale}`).toBe(locale);
        const html = await response.text();
        assertStructuralBaseline(html, locale, `${state.name} ${locale}`);
        if (locale !== defaultLocale) expect(html, `${state.name} ${locale} persistence`).toContain(`lang=${locale}`);
      }
    }
  });

  it('keeps mixed-direction technical material isolated on the Arabic API surface', async () => {
    const response = await routeRequest(new Request('https://demo.wizardgang.ai/demos?lang=ar#rest', { headers: { accept: 'text/html' } }), environment());
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<html lang="ar" dir="rtl">');
    const presentation = await routeRequest(new Request('https://demo.wizardgang.ai/api/demos/rest?lang=ar', { headers: { accept: 'text/html' } }), environment());
    expect(presentation.status).toBe(200);
    expect(await presentation.text()).toMatch(/<(?:bdi|code)\b[^>]*(?:dir="ltr"|data-canonical-source)|<code\b/);
  });
});
