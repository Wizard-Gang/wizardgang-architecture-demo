import { describe, expect, it } from 'vitest';
import { routeRequest } from '../src/router';
import { routeUrl } from '../src/routing/application-routes';
import type { Env } from '../src/types';
import { removedIdentityAndProtocolPathnames } from './fixtures/removed-api-pathnames';
import { SqliteD1 } from './helpers/wg-storage';

const environment: Env = {
  WG_DB: new SqliteD1(),
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
  WG_SESSION_KEY: 's'.repeat(32),
};

const pages = [
  { view: 'rest', marker: 'data-rest-operation-browser' },
  { view: 'graphql', marker: 'data-graphql-form' },
  { view: 'webhooks', marker: 'id="webhooks-webhooks"' },
  { view: 'oauth', marker: 'data-provider-action="github"' },
  { view: 'mcp', marker: 'id="mcp-mcp-endpoint"' },
  { view: 'i18n', marker: 'data-i18n-form' },
  { view: 'accessibility', marker: 'id="accessibility-accessibility-demo"' },
] as const;

async function demosHtml(path = routeUrl('demos.index')): Promise<string> {
  const response = await routeRequest(new Request(`https://demo.wizardgang.ai${path}`, { headers: { accept: 'text/html' } }), environment);
  expect(response.status).toBe(200);
  return response.text();
}

async function presentationHtml(id: string, query = ''): Promise<string> {
  return demosHtml(`${routeUrl('demos.presentation', { demo: id })}${query}`);
}

describe('canonical interface demonstrations', () => {
  it('server-renders lightweight workbench navigation and loads each interface presentation independently', async () => {
    const response = await routeRequest(new Request('https://demo.wizardgang.ai/demos#rest', { headers: { accept: 'text/html' } }), environment);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<link rel="canonical" href="https://demo.wizardgang.ai/demos"/>');
    expect(html).toContain('class="skip-link" href="#main"');
    expect(html).toContain('<main class="site-main" id="main">');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html.match(/data-demo-workbench(?:="")?(?:\s|>)/g)).toHaveLength(1);
    for (const page of pages) {
      expect(html, page.view).toContain(`demo=${page.view}#${page.view}"`);
      expect(html, page.view).not.toContain(page.marker);
      expect(await presentationHtml(page.view), page.view).toContain(page.marker);
    }
    expect(html).not.toContain('/auth/session');
    expect(html).not.toContain('/graphql/console');
  });

  it('keeps the interface demos focused and executable', async () => {
    const rest = await presentationHtml('rest');
    expect(rest).toContain('3.0.3');
    expect(rest).toContain('PATCH');
    expect(rest).toContain('/api/labs/rest-demo-records');
    expect(rest).not.toContain('Focused browser tutorial.');
    expect(rest).toContain('href="/api/openapi.json"');
    expect(rest).toContain('data-rest-operation-select="listRecords"');
    expect(rest).toContain('data-rest-full-openapi');
    expect(rest).not.toContain('Two deliberate REST boundaries.');
    expect(rest).not.toContain('Your API sandbox');
    expect(rest).not.toContain('Same policy, different transports');
    expect(rest).not.toContain('Authorization');

    const graphql = await presentationHtml('graphql');
    expect(graphql).toContain('Working examples');
    expect(graphql).toContain('data-graphql-example');
    expect(graphql).not.toContain('GraphQL Yoga');
    expect(graphql).not.toContain('Application interfaces');

    const webhooks = await presentationHtml('webhooks');
    expect(webhooks).toContain('Simulate a signed release webhook');
    expect(webhooks).toContain('release.published');
    expect(webhooks).not.toContain('HMAC-SHA256');
    expect(webhooks).not.toContain('Event contract');

    const identity = await presentationHtml('oauth');
    expect(identity).not.toContain('Many providers. One application identity.');
    expect(identity).not.toContain('No protocol secrets in the inspector');

    const mcp = await presentationHtml('mcp');
    expect(mcp).not.toContain('One shared trust boundary');
    expect(mcp).not.toContain('What this route proves');
    expect(mcp).not.toContain('Internationalization →');
  });

  it('renders /demos as a real index and publishes every child link', async () => {
    const response = await routeRequest(new Request('https://demo.wizardgang.ai/demos', { headers: { accept: 'text/html' } }), environment);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('<h1>Architecture Demos</h1>');
    expect(html).toContain('<link rel="canonical" href="https://demo.wizardgang.ai/demos"/>');
    for (const page of pages) expect(html, page.view).toContain(`demo=${page.view}#${page.view}"`);
  });

  it('returns ordinary 404s for every retired interfaces ?view= URL', async () => {
    for (const view of [...pages.map((page) => page.view), 'unknown']) {
      const response = await routeRequest(new Request(`https://demo.wizardgang.ai/demos?view=${view}`, { headers: { accept: 'text/html' } }), environment);
      expect(response.status, view).toBe(404);
      expect(response.headers.get('location'), view).toBeNull();
      expect(await response.text(), view).toContain('404 / unknown route');
    }
  });

  it('keeps language and accessibility mode as query state on canonical resources', async () => {
    const i18nPath = `${routeUrl('demos.index', {}, { lang: 'ar', count: '3' })}#i18n`;
    const i18n = await (await routeRequest(new Request(`https://demo.wizardgang.ai${i18nPath}`), environment)).text();
    expect(i18n).toContain('<html lang="ar" dir="rtl">');
    expect(i18n).not.toContain('name="view"');
    expect(i18n).toContain('<link rel="canonical" href="https://demo.wizardgang.ai/demos"/>');

    const accessibility = await presentationHtml('accessibility', '?mode=broken');
    expect(accessibility).toContain('Failure analysis');
    expect(accessibility).not.toContain('data-a11y-mode');
    expect(accessibility).toContain('data-a11y-frame');
  });

  it('retires standalone pages while preserving GraphQL and MCP machine endpoints', async () => {
    for (const path of ['/api', '/webhooks', '/identity', '/i18n', '/accessibility', '/graphql/console']) {
      const response = await routeRequest(new Request(`https://demo.wizardgang.ai${path}`, { headers: { accept: 'text/html' } }), environment);
      expect(response.status, path).toBe(404);
      expect(response.headers.get('location'), path).toBeNull();
    }

    const graphql = await routeRequest(new Request('https://demo.wizardgang.ai/graphql?query=%7B%20__typename%20%7D', { headers: { accept: 'text/html' } }), environment);
    expect(graphql.headers.get('content-type')).toContain('application/graphql-response+json');
    expect(graphql.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(await graphql.text()).not.toContain('GraphiQL');

    const mcp = await routeRequest(new Request('https://demo.wizardgang.ai/mcp'), environment);
    expect(mcp.status).toBe(405);
  });

  it('returns normal 404s for retired identity and protocol contracts', async () => {
    for (const path of removedIdentityAndProtocolPathnames) {
      const response = await routeRequest(new Request('https://demo.wizardgang.ai' + path, { headers: { accept: 'application/json' } }), environment);
      expect(response.status, path).toBe(404);
      expect(response.headers.get('location'), path).toBeNull();
    }
  });

  it('lands all unconfigured identity starts and a failed callback on the matching Identity demo', async () => {
    for (const [path, provider] of [['/auth/microsoft', 'microsoft'], ['/auth/google', 'google'], ['/auth/github', 'github'], ['/auth/saml', 'saml']] as const) {
      const response = await routeRequest(new Request(`https://demo.wizardgang.ai${path}`), environment);
      expect(response.status, path).toBe(303);
      const demo = provider === 'saml' ? 'saml' : provider === 'github' ? 'oauth' : 'sso';
      expect(response.headers.get('location'), path).toBe(`https://demo.wizardgang.ai/demos?demo=${demo}&error=provider_unconfigured&provider=${provider}#${demo}`);
    }
    const callback = await routeRequest(new Request('https://demo.wizardgang.ai/auth/google/callback?error=access_denied'), environment);
    expect(callback.status).toBe(303);
    expect(callback.headers.get('location')).toBe('https://demo.wizardgang.ai/demos?demo=sso&error=authentication_failed&provider=google#sso');
  });
});
