import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { architectureMapEntries } from '../src/routing/navigation';
import { routeRequest } from '../src/router';
import { browserAssetName, browserAssetPath } from '../src/ui/asset-map';
import { applicationRouteRegistry, routeUrl } from '../src/routing/application-routes';
import type { Env } from '../src/types';
import { removedRouterFallbackPathnames } from './fixtures/removed-api-pathnames';
import { retiredOperationsHtmlPathname } from './fixtures/removed-html-pathnames';
import { SqliteD1 } from './helpers/wg-storage';

function env(state: 'online' | 'offline' = 'online', crawlerState: 'enabled' | 'disabled' = 'disabled'): Env & { WG_DB: SqliteD1 } {
  const db = new SqliteD1();
  db.putRecord('control', 'demo', { state, publicMessage: state === 'online' ? 'Available.' : 'Planned maintenance.', updatedAt: '2026-08-31T00:00:00.000Z', updatedBy: 'test' });
  db.putRecord('control', 'crawler', { state: crawlerState, updatedAt: '2026-09-01T12:00:00.000Z', updatedBy: 'test' });
  return {
    WG_DB: db,
    ASSETS: {
      async fetch(request) {
        const contentType = new URL(request.url).pathname.endsWith('.png') ? 'image/png' : 'application/octet-stream';
        return new Response(request.method === 'HEAD' ? null : 'asset', { headers: { 'content-type': contentType } });
      },
    },
    GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
    GITHUB_BRANCH: 'main',
    WG_SESSION_KEY: 's'.repeat(32),
  };
}


describe('public route contract', () => {
  it('resolves every registered human demo route and links to its exact primary source', async () => {
    const environment = env();
    for (const surface of architectureMapEntries()) {
      const declaration = applicationRouteRegistry.declarations.find((route) => route.id === surface.id);
      expect(declaration, `${surface.pattern} declaration`).toBeDefined();
      const response = await routeRequest(new Request(`https://demo.wizardgang.ai${surface.pattern}`, { headers: { accept: 'text/html' } }), environment);
      expect(response.status, surface.pattern).toBe(200);
      const html = await response.text();
      expect(html, surface.pattern).toContain(`https://github.com/Wizard-Gang/wizardgang-architecture-demo/blob/main/${declaration?.source.module}`);
    }
  });

  it('resolves root, protected admin, offline, health, version, and logs surfaces', async () => {
    const environment = env();
    expect((await routeRequest(new Request('https://demo.wizardgang.ai/'), environment)).status).toBe(200);
    const admin = await routeRequest(new Request('https://demo.wizardgang.ai/admin'), environment, { adminAuthorized: true });
    expect(admin.status).toBe(200);
    const adminHtml = await admin.text();
    expect(adminHtml).toContain('ChatGPT web access');
    expect(adminHtml).toContain('https://developers.openai.com/api/docs/bots');
    // The maintenance page reports the real state: it only claims the demo is down while it is.
    expect((await routeRequest(new Request('https://demo.wizardgang.ai/offline'), environment)).status).toBe(200);
    expect((await routeRequest(new Request('https://demo.wizardgang.ai/api/operations/health'), environment)).status).toBe(200);
    expect((await routeRequest(new Request('https://demo.wizardgang.ai/api/operations/version'), environment)).status).toBe(200);
    const socialCard = await routeRequest(new Request(`https://demo.wizardgang.ai${browserAssetPath('social.card')}`), environment);
    expect(socialCard.status).toBe(200);
    expect(socialCard.headers.get('content-type')).toBe('image/png');
    expect(socialCard.headers.get('cache-control')).toContain('immutable');
    expect((await routeRequest(new Request('https://demo.wizardgang.ai/robots.txt'), environment)).status).toBe(200);
    const accessibilityFrame = await routeRequest(new Request('https://demo.wizardgang.ai/api/labs/accessibility?mode=accessible'), environment);
    expect(accessibilityFrame.status).toBe(200);
    expect(accessibilityFrame.headers.get('content-type')).toContain('text/html');
  });

  it('renders a focused REST client generated from the OpenAPI contract', async () => {
    const response = await routeRequest(new Request('https://demo.wizardgang.ai/api/demos/rest', { headers: { accept: 'text/html' } }), env());
    const html = await response.text();
    expect(html).toContain('id="rest-rest-demo-listRecords-panel"');
    expect(html).toContain('/api/labs/rest-demo-records');
    expect(html.match(/<form data-rest-form/g)).toHaveLength(6);
    expect(html.match(/data-rest-operation-select=/g)).toHaveLength(6);
    expect(html.match(/data-rest-operation-panel=/g)).toHaveLength(6);
    expect(html.match(/<details class="rest-operation"/g)).toHaveLength(6);
    expect(html).toContain('3.0.3');
    expect(html).toContain('WizardGang REST demo');
    expect(html).toContain('RecordReplacement');
    expect(html).toContain('RecordPatch');
    expect(html).toContain('class="rest-declared-responses"');
    expect(html).toContain('href="/api/openapi.json"');
    expect(html).not.toContain('200–204');
    expect(html).not.toContain('OpenAPI document</p>');
    expect(html).not.toContain('REST resources');
    expect(html).not.toContain('Contract shape');
    expect(html).not.toContain('Your API sandbox');
    expect(html).not.toContain('Sign in to enable writes');
    expect(html).not.toContain('Code samples for this operation');
    expect(html).toContain('data-demo-browser-module=');

  });

  it('publishes the REST demo records operations through the single OpenAPI document', async () => {
    const response = await routeRequest(new Request('https://demo.wizardgang.ai/api/openapi.json'), env());
    const document = await response.json() as { openapi: string; paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } };
    expect(response.status).toBe(200);
    expect(document.openapi).toBe('3.1.0');
    expect(document.paths).toHaveProperty(['/api/labs/rest-demo-records']);
    expect(document.paths).toHaveProperty(['/api/labs/rest-demo-records/{id}']);
    expect(Object.keys(document.components.schemas)).toEqual(['Record', 'RecordInput', 'RecordReplacement', 'RecordPatch', 'Error']);
  });

  it('renders focused GraphQL and webhook interface routes', async () => {
    const environment = env();
    const graphqlPage = await routeRequest(new Request('https://demo.wizardgang.ai/api/demos/graphql', { headers: { accept: 'text/html' } }), environment);
    const graphqlHtml = await graphqlPage.text();
    const graphqlDemo = graphqlHtml;
    expect(graphqlDemo).not.toContain('<iframe');
    expect(graphqlDemo).toContain('data-graphql-form');
    expect(graphqlDemo).toContain('Accessible query runner');
    expect(graphqlDemo).not.toContain('/graphql/console');
    for (const control of ['Depth limit', 'Field limit', 'Batching', 'Request limit']) expect(graphqlDemo).toContain(control);
    expect(graphqlDemo).toContain('GraphQL ↔ D1 Users');

    const graphqlMachineOnly = await routeRequest(new Request('https://demo.wizardgang.ai/graphql?query=%7B%20__typename%20%7D', { headers: { accept: 'text/html' } }), environment);
    expect(graphqlMachineOnly.headers.get('content-type')).toContain('application/graphql-response+json');
    expect(await graphqlMachineOnly.text()).not.toContain('GraphiQL');

    const graphqlApi = await routeRequest(new Request('https://demo.wizardgang.ai/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://demo.wizardgang.ai' },
      body: JSON.stringify({ query: '{ users { id } }' }),
    }), environment);
    expect(graphqlApi.headers.get('content-type')).toContain('application/json');

    const crossOriginGraphqlApi = await routeRequest(new Request('https://demo.wizardgang.ai/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ users { id } }' }),
    }), environment);
    expect(crossOriginGraphqlApi.status).toBe(403);

    const webhooksPage = await routeRequest(new Request('https://demo.wizardgang.ai/api/demos/webhooks', { headers: { accept: 'text/html' } }), environment);
    const webhooksHtml = await webhooksPage.text();
    expect(webhooksHtml).toContain('/webhooks/github');
    expect(webhooksHtml).toContain('Simulate signed release webhook');
    expect(webhooksHtml).toContain('Signature valid');
    expect(webhooksHtml).toContain('Verified deliveries');
  });

  it('renders three focused identity demos with unchanged protocol routes', async () => {
    for (const [demo, actions] of [
      ['oauth', ['/auth/github']],
      ['sso', ['/auth/microsoft', '/auth/google']],
      ['saml', ['/auth/saml', '/auth/saml/metadata']],
    ] as const) {
      const response = await routeRequest(new Request(`https://demo.wizardgang.ai/api/demos/${demo}`, { headers: { accept: 'text/html' } }), env());
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain(`data-demo-section="${demo}"`);
      for (const endpoint of actions) expect(html).toContain(endpoint);
      for (const other of ['/auth/microsoft', '/auth/google', '/auth/github', '/auth/saml']) {
        if (!actions.includes(other)) expect(html).not.toContain(`data-provider-href="${other}"`);
      }
      for (const view of ['Provider payload', 'Normalized identity', 'Authorization', 'Protocol']) expect(html).toContain(view);
      expect(html).not.toContain('visitor@example.test');
    }
    const identityBrowser = readFileSync('src/browser/identity.ts', 'utf8');
    for (const endpoint of ['/auth/session', '/auth/authorize', '/auth/logout']) expect(identityBrowser).toContain(endpoint);
    const metadata = await routeRequest(new Request('https://demo.wizardgang.ai/auth/saml/metadata'), env());
    expect(metadata.status).toBe(200);
    expect(metadata.headers.get('content-type')).toContain('application/samlmetadata+xml');
  });

  it('separates the MCP guide from the interoperable Streamable HTTP endpoint', async () => {
    const environment = env();
    const page = await routeRequest(new Request('https://demo.wizardgang.ai/api/demos/mcp', { headers: { accept: 'text/html' } }), environment);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('https://demo.wizardgang.ai/mcp');
    expect(html).toContain('claude mcp add --transport http wizardgang');
    expect(html).toContain('codex mcp add wizardgang --url');
    expect(html).toContain('MCP-Protocol-Version: 2026-07-28');
    expect(html).toContain('Latest public demo MCP activity');
    expect(html).not.toContain('MCP is another interface—not another trust boundary.');

    const oldTransport = await routeRequest(new Request('https://demo.wizardgang.ai/mcp/server', { method: 'POST' }), environment);
    expect(oldTransport.status).toBe(404);

    const transportGet = await routeRequest(new Request('https://demo.wizardgang.ai/mcp'), environment);
    expect(transportGet.status).toBe(405);
    expect(await transportGet.text()).toContain('Method not allowed');
  });

  it('returns the ordinary 404 for removed standalone interface pages', async () => {
    const environment = env();
    for (const path of ['/api', '/webhooks', '/identity', '/i18n', '/accessibility']) {
      const response = await routeRequest(new Request(`https://demo.wizardgang.ai${path}`, { headers: { accept: 'text/html' } }), environment);
      expect(response.status, path).toBe(404);
      expect(response.headers.get('location'), path).toBeNull();
    }
  });

  it('keeps source context without repeating global route chrome or interface lists', async () => {
    const response = await routeRequest(new Request('https://demo.wizardgang.ai/api/demos/edge', { headers: { accept: 'text/html' } }), env());
    const html = await response.text();
    expect(html).toContain('Route source');
    expect(html).toContain('/src/demos/edge-presentation.tsx');
    expect(html).not.toContain('D1 schema');
    expect(html).not.toContain('Route map');
    expect(html).not.toContain('Live interfaces');
    expect(html).not.toContain('This button calls the live Worker interface below');
  });

  it('keeps the demo-first launcher and retires the public operations dashboard', async () => {
    const environment = env();
    const index = await (await routeRequest(new Request('https://demo.wizardgang.ai/'), environment)).text();
    expect(index).not.toContain('<h2 class="eyebrow">Routes</h2>');
    expect(index).not.toContain('<h2 class="eyebrow">Groups</h2>');
    expect(index).toContain('<div class="link-row home-actions"');
    expect(index).toContain('>Explore demos</a>');
    expect(index).toContain('aria-label="Live proof"');
    expect(index).toContain('Current service state');
    expect(index).toContain('Scheduled observations');
    expect(index).not.toContain('data-health');
    expect(index).toContain(`<meta property="og:image" content="https://demo.wizardgang.ai${browserAssetPath('social.card')}"/>`);
    expect(index).toContain('href="/demos"');
    expect(index).not.toContain(`href="${retiredOperationsHtmlPathname}"`);
    expect(index).toContain('href="https://github.com/Wizard-Gang/wizardgang-architecture-demo/security/policy"');
    expect(index).not.toContain('href="/dashboard');
    expect(index).not.toContain('>Map</a>');
    expect(index).not.toContain('>Docs</a>');
    expect(index).not.toContain('>GitHub <span');
    expect(index).not.toContain('WG-ARCH-001');
    expect(index).toContain('<a href="https://github.com/Wizard-Gang/wizardgang-architecture-demo/issues/new?template=bug.yml">Report an issue</a>');

    const retiredOperations = await routeRequest(new Request(`https://demo.wizardgang.ai${retiredOperationsHtmlPathname}`, { headers: { accept: 'text/html' } }), environment);
    expect(retiredOperations.status).toBe(404);
    expect(retiredOperations.headers.get('location')).toBeNull();
  });

  it('removes the generic fallback runner and event listing routes', async () => {
    const environment = env();
    expect((await routeRequest(new Request(`https://demo.wizardgang.ai${removedRouterFallbackPathnames[0]}`, { method: 'POST' }), environment)).status).toBe(404);
    expect((await routeRequest(new Request(`https://demo.wizardgang.ai${removedRouterFallbackPathnames[1]}`), environment)).status).toBe(404);
  });
});

describe('ChatGPT crawler control', () => {
  it('publishes the selected robots policy while always opting out of model training', async () => {
    const disabled = await routeRequest(new Request('https://demo.wizardgang.ai/robots.txt'), env('online', 'disabled'));
    expect(disabled.status).toBe(200);
    expect(disabled.headers.get('cache-control')).toBe('no-store');
    expect(disabled.headers.get('x-chatgpt-crawl-access')).toBe('disabled');
    const disabledPolicy = await disabled.text();
    expect(disabledPolicy).toContain('User-agent: OAI-SearchBot\nDisallow: /');
    expect(disabledPolicy).toContain('User-agent: ChatGPT-User\nDisallow: /');
    expect(disabledPolicy).toContain('User-agent: GPTBot\nDisallow: /');

    const enabled = await routeRequest(new Request('https://demo.wizardgang.ai/robots.txt'), env('online', 'enabled'));
    const enabledPolicy = await enabled.text();
    expect(enabled.headers.get('x-chatgpt-crawl-access')).toBe('enabled');
    expect(enabledPolicy).toContain('User-agent: OAI-SearchBot\nAllow: /');
    expect(enabledPolicy).toContain('User-agent: ChatGPT-User\nAllow: /');
    expect(enabledPolicy).toContain('User-agent: GPTBot\nDisallow: /');
    expect(enabledPolicy).toContain('Sitemap: https://demo.wizardgang.ai/sitemap.xml');
  });

  it('enforces the switch for search and user-requested fetches, with training always blocked', async () => {
    const searchAgent = 'Mozilla/5.0; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot';
    const userAgent = 'Mozilla/5.0; compatible; ChatGPT-User/1.0; +https://openai.com/bot';
    const trainingAgent = 'Mozilla/5.0; compatible; GPTBot/1.4; +https://openai.com/gptbot';

    const searchBlocked = await routeRequest(new Request('https://demo.wizardgang.ai/', { headers: { 'user-agent': searchAgent } }), env('online', 'disabled'));
    expect(searchBlocked.status).toBe(403);
    expect(await searchBlocked.json()).toMatchObject({ agent: 'OAI-SearchBot', reason: 'chatgpt_crawl_access_disabled' });

    const userBlocked = await routeRequest(new Request('https://demo.wizardgang.ai/api/operations/health', { headers: { 'user-agent': userAgent } }), env('online', 'disabled'));
    expect(userBlocked.status).toBe(403);
    expect(userBlocked.headers.get('x-robots-tag')).toBe('noindex, nofollow');

    expect((await routeRequest(new Request('https://demo.wizardgang.ai/', { headers: { 'user-agent': searchAgent } }), env('online', 'enabled'))).status).toBe(200);
    expect((await routeRequest(new Request('https://demo.wizardgang.ai/api/operations/version', { headers: { 'user-agent': userAgent } }), env('online', 'enabled'))).status).toBe(200);

    const trainingBlocked = await routeRequest(new Request('https://demo.wizardgang.ai/', { headers: { 'user-agent': trainingAgent } }), env('online', 'enabled'));
    expect(trainingBlocked.status).toBe(403);
    expect(await trainingBlocked.json()).toMatchObject({ agent: 'GPTBot', reason: 'model_training_disabled' });

    expect((await routeRequest(new Request('https://demo.wizardgang.ai/'), env('online', 'disabled'))).status).toBe(200);
  });
});

describe('offline routing matrix', () => {
  it('blocks ordinary behavior before execution while keeping operational machine and recovery routes reachable', async () => {
    const environment = env('offline');
    const html = await routeRequest(new Request('https://demo.wizardgang.ai/demos', { headers: { accept: 'text/html' } }), environment);
    expect(html.status).toBe(302);
    expect(html.headers.get('location')).toContain('/offline?from=%2Fdemos');
    // Only the demo control record is read before the offline gate answers.
    expect(environment.WG_DB.queries.every((query) => query.startsWith('SELECT') && query.includes('FROM records'))).toBe(true);
    expect(environment.WG_DB.binds.every((values) => values[1] === 'control' && values[2] === 'demo')).toBe(true);
    expect((await routeRequest(new Request('https://demo.wizardgang.ai/demos#mcp', { headers: { accept: 'text/html' } }), environment)).status).toBe(302);
    const mcp = await routeRequest(new Request('https://demo.wizardgang.ai/mcp', { headers: { accept: 'application/json' } }), environment);
    expect(mcp.status).toBe(503);
    expect(await mcp.json()).toMatchObject({ status: 'offline' });

    const api = await routeRequest(new Request('https://demo.wizardgang.ai/api/labs/rest-demo-records', { headers: { accept: 'application/json' } }), environment);
    expect(api.status).toBe(503);
    expect(await api.json()).toMatchObject({ status: 'offline' });

    const offlinePage = await routeRequest(new Request('https://demo.wizardgang.ai/offline', { headers: { accept: 'text/html' } }), environment);
    expect(offlinePage.status).toBe(503);
    expect(await offlinePage.text()).toContain('Demo temporarily offline');

    const retiredOperations = await routeRequest(new Request(`https://demo.wizardgang.ai${retiredOperationsHtmlPathname}`, { headers: { accept: 'text/html' } }), environment);
    expect(retiredOperations.status).toBe(404);
    expect(retiredOperations.headers.get('location')).toBeNull();
    expect((await routeRequest(new Request('https://demo.wizardgang.ai/api/operations/version'), environment)).status).toBe(200);
    expect((await routeRequest(new Request('https://demo.wizardgang.ai/api/operations/health'), environment)).status).toBe(503);
    expect((await routeRequest(new Request(`https://demo.wizardgang.ai/assets/${browserAssetName('social.card')}`), environment)).status).toBe(200);
    expect((await routeRequest(new Request('https://demo.wizardgang.ai/admin'), environment, { adminAuthorized: true })).status).toBe(200);
  });

  it('persists and audits an authenticated same-origin admin transition without binding credentials', async () => {
    const environment = env();
    const response = await routeRequest(new Request('https://demo.wizardgang.ai/admin', {
      method: 'POST',
      headers: { origin: 'https://demo.wizardgang.ai', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ state: 'offline', message: 'Planned public demonstration window.' }),
    }), environment, { adminAuthorized: true });
    expect(response.status).toBe(303);
    expect(environment.WG_DB.records<{ state: string }>('control').get('demo')?.body.state).toBe('offline');
    expect(environment.WG_DB.events<{ eventType: string }>('audit').map((event) => event.body.eventType)).toContain('demo_state_changed');
  });

  it('persists and audits the authenticated ChatGPT access switch', async () => {
    const unauthenticatedEnvironment = env();
    const denied = await routeRequest(new Request('https://demo.wizardgang.ai/admin', {
      method: 'POST',
      headers: { origin: 'https://demo.wizardgang.ai', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ control: 'chatgpt-crawl', state: 'enabled' }),
    }), unauthenticatedEnvironment);
    expect(denied.status).toBe(401);
    expect(unauthenticatedEnvironment.WG_DB.records<{ state: string }>('control').get('crawler')?.body.state).toBe('disabled');

    const environment = env();
    const response = await routeRequest(new Request('https://demo.wizardgang.ai/admin', {
      method: 'POST',
      headers: { origin: 'https://demo.wizardgang.ai', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ control: 'chatgpt-crawl', state: 'enabled' }),
    }), environment, { adminAuthorized: true });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('changed=chatgpt-crawl-enabled');
    expect(response.headers.get('location')).toContain('#chatgpt-crawl');
    expect(environment.WG_DB.records<{ state: string }>('control').get('crawler')?.body.state).toBe('enabled');
    expect(environment.WG_DB.events<{ eventType: string }>('audit').map((event) => event.body.eventType)).toContain('chatgpt_crawl_access_changed');
  });
});
