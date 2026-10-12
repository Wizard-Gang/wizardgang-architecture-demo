import { describe, expect, it } from 'vitest';
import {
  defaultLocale,
  localeResources,
  resolveLocalization,
  supportedLocales,
  type SupportedLocale,
} from '../src/i18n/runtime';
import presentation from '../src/i18n/presentation.json';
import { routeRequest } from '../src/router';
import { applicationRouteRegistry, routeUrl } from '../src/routing/application-routes';
import type { Env } from '../src/types';
import { demoDatabase } from './helpers/wg-storage';

function environment(): Env {
  return {
    WG_DB: demoDatabase({ crawler: 'enabled' }),
    GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
    GITHUB_BRANCH: 'main',
    BILLING_DEMO_MONTHLY_BUDGET_USD: '10',
  };
}

function localization(locale: SupportedLocale, pathname = `${routeUrl('demos.index')}#i18n`) {
  const url = new URL(pathname, 'https://demo.wizardgang.ai');
  if (locale !== defaultLocale) url.searchParams.set('lang', locale);
  return resolveLocalization(new Request(url));
}

const UNTRANSLATED_PRESENTATION_ALLOWLIST = new Set([
  'nav.platform.workers',
  'nav.platform.durable-objects',
  'nav.platform.d1',
  'nav.platform.r2',
  'nav.interfaces.rest',
  'nav.interfaces.graphql.console',
  'nav.interfaces.webhooks.console',
  'nav.interfaces.mcp.console',
  'platform.workers_title',
  'platform.do_title',
  'interfaces.mcp_title',
  'interfaces.webhooks.live.ci', // CI is the canonical check-system acronym in every locale.
]);

const direction = (locale: SupportedLocale) => locale === 'ar' ? 'rtl' : 'ltr';
const presentationCatalog = presentation as Readonly<Record<string, Readonly<Record<SupportedLocale, string>>>>;

describe('DEMO-236 sitewide localization acceptance', () => {
  it('renders every registry-derived public page in every supported locale', async () => {
    const publicPages = applicationRouteRegistry.declarations.filter((route) =>
      route.kind === 'page'
      && route.visibility === 'public'
      && route.methods.includes('GET'),
    );

    expect(publicPages.map((route) => route.id)).toContain('demos.index');
    expect(publicPages.filter((route) => route.pattern.includes(':'))).toEqual([]);

    for (const route of publicPages) {
      for (const locale of supportedLocales) {
        const url = new URL(route.pattern, 'https://demo.wizardgang.ai');
        if (locale !== defaultLocale) url.searchParams.set('lang', locale);
        const response = await routeRequest(new Request(url, { headers: { accept: 'text/html' } }), environment());
        expect(response.status, `${route.id} ${locale}`).toBe(200);
        expect(response.headers.get('content-language'), `${route.id} ${locale}`).toBe(locale);
        const html = await response.text();
        expect(html, `${route.id} ${locale}`).toContain(`<html lang="${locale}" dir="${direction(locale)}">`);
        expect(html, `${route.id} ${locale}`).not.toContain('&amp%3B');
      }
    }
  });

  it('keeps runtime resources synchronized and requires an explicit allowlist for intentionally untranslated catalog entries', () => {
    const expectedKeys = Object.keys(localeResources[defaultLocale]).sort();
    for (const locale of supportedLocales) {
      const resource = localeResources[locale] as Readonly<Record<string, string>>;
      expect(Object.keys(resource).sort(), locale).toEqual(expectedKeys);
      for (const key of expectedKeys) expect(resource[key]?.trim(), `${locale}.${key}`).toBeTruthy();
    }

    for (const [key, entry] of Object.entries(presentationCatalog)) {
      const intentionallyUntranslated = supportedLocales.every((locale) => entry[locale] === entry[defaultLocale]);
      if (intentionallyUntranslated) {
        expect(UNTRANSLATED_PRESENTATION_ALLOWLIST.has(key), `unallowlisted untranslated token: ${key}`).toBe(true);
      }
    }
  });

  it('matches Intl formatting and plural selection across every locale', () => {
    const date = new Date('2026-09-01T12:00:00.000Z');
    const counts = [0, 1, 2, 3, 11, 101];

    for (const locale of supportedLocales) {
      const context = localization(locale);
      expect(context.number(1234567.89)).toBe(new Intl.NumberFormat(locale).format(1234567.89));
      expect(context.currency(1234.56, 'USD')).toBe(new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(1234.56));
      expect(context.dateTime(date, { dateStyle: 'full', timeZone: 'UTC' })).toBe(new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(date));
      expect(context.list(['edge', 'data', 'identity'])).toBe(new Intl.ListFormat(locale).format(['edge', 'data', 'identity']));
      expect(context.exact('Request failed')).toBe(presentationCatalog['client.request_failed'][locale]);
      expect(context.browserMessages()['client.request_failed']).toBe(presentationCatalog['client.request_failed'][locale]);

      const demosRoute = routeUrl('demos.index');
      const getForm = context.getForm(`${demosRoute}?sample=one#records`);
      expect(getForm.action).toBe(`${demosRoute}#records`);
      expect(getForm.fields).toContainEqual({ name: 'sample', value: 'one' });
      if (locale === defaultLocale) expect(getForm.fields).not.toContainEqual({ name: 'lang', value: locale });
      else expect(getForm.fields).toContainEqual({ name: 'lang', value: locale });

      for (const count of counts) {
        const category = new Intl.PluralRules(locale).select(count);
        expect(context.pluralCategory(count), `${locale} ${count}`).toBe(category);
        const key = `items_${category}`;
        const template = (localeResources[locale] as Readonly<Record<string, string>>)[key];
        expect(context.plural('items', count), `${locale} ${count}`).toBe(template.replace('{count}', String(count)));
      }
    }
  });

  it('preserves query state while keeping one global language control', async () => {
    const i18nUrl = new URL(`${routeUrl('demos.index')}#i18n`, 'https://demo.wizardgang.ai');
    i18nUrl.searchParams.set('lang', 'ja');
    i18nUrl.searchParams.set('count', '7');
    const response = await routeRequest(new Request(i18nUrl, { headers: { accept: 'text/html' } }), environment());
    expect(response.status).toBe(200);
    const html = await response.text();
    const presentationResponse = await routeRequest(new Request('https://demo.wizardgang.ai/api/demos/i18n?lang=ja&count=7', { headers: { accept: 'text/html' } }), environment());
    expect(presentationResponse.status).toBe(200);
    const presentation = await presentationResponse.text();

    expect(presentation).toContain('<input type="hidden" name="lang" value="ja"/>');
    expect(presentation).toContain('グローバルヘッダーの言語コントロール');
    expect(presentation).not.toContain('id="locale-demo"');
    expect(html).toContain('<input type="hidden" name="count" value="7"/>');
    expect(html + presentation).not.toContain('&amp%3B');
    expect(html + presentation).not.toContain('lang=fr&amp;lang=ja');
  });

  it('localizes render-time strings and inert browser messages from the same catalog', () => {
    for (const locale of supportedLocales.filter((candidate) => candidate !== defaultLocale)) {
      const context = localization(locale);
      expect(context.exact('Request failed')).toBe(presentationCatalog['client.request_failed'][locale]);
      expect(context.exact('Waiting for response…')).toBe(presentationCatalog['client.waiting_response'][locale]);
      expect(context.browserMessages()).toMatchObject({
        'client.request_failed': presentationCatalog['client.request_failed'][locale],
        'client.waiting_response': presentationCatalog['client.waiting_response'][locale],
      });
    }
  });
});
