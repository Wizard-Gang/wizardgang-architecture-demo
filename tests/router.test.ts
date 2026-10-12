import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { architectureMapEntries } from '../src/routing/navigation';
import { DEMO_ROBOTS } from '../src/index';
import { routeRequest } from '../src/router';
import { browserAssetPath } from '../src/ui/asset-map';
import { applicationRouteRegistry, routeUrl } from '../src/routing/application-routes';
import type { Env } from '../src/types';
import { removedRouterFallbackPathnames } from './fixtures/removed-api-pathnames';
import { retiredOperationsHtmlPathname } from './fixtures/removed-html-pathnames';
import { SqliteD1 } from './helpers/wg-storage';

function env(): Env & { WG_DB: SqliteD1 } {
  return {
    WG_DB: new SqliteD1(),
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

  it('resolves root, health, version, asset, and accessibility surfaces', async () => {
    const environment = env();
    expect((await routeRequest(new Request('https://demo.wizardgang.ai/'), environment)).status).toBe(200);
    expect((await routeRequest(new Request('https://demo.wizardgang.ai/api/operations/health'), environment)).status).toBe(200);
    expect((await routeRequest(new Request('https://demo.wizardgang.ai/api/operations/version'), environment)).status).toBe(200);
    const socialCard = await routeRequest(new Request(`https://demo.wizardgang.ai${browserAssetPath('social.card')}`), environment);
    expect(socialCard.status).toBe(200);
    expect(socialCard.headers.get('content-type')).toBe('image/png');
    expect(socialCard.headers.get('cache-control')).toContain('immutable');
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

describe('OpenAI crawler policy', () => {
  it('publishes a static robots policy that opts out of model training', () => {
    expect(DEMO_ROBOTS).toContain('User-agent: OAI-SearchBot\nAllow: /');
    expect(DEMO_ROBOTS).toContain('User-agent: ChatGPT-User\nAllow: /');
    expect(DEMO_ROBOTS).toContain('User-agent: GPTBot\nDisallow: /');
    expect(DEMO_ROBOTS).toContain('Sitemap: https://demo.wizardgang.ai/sitemap.xml');
  });

  it('admits search and user-requested fetches, refuses model training everywhere and every OpenAI agent on denied routes', async () => {
    const searchAgent = 'Mozilla/5.0; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot';
    const userAgent = 'Mozilla/5.0; compatible; ChatGPT-User/1.0; +https://openai.com/bot';
    const trainingAgent = 'Mozilla/5.0; compatible; GPTBot/1.4; +https://openai.com/gptbot';

    expect((await routeRequest(new Request('https://demo.wizardgang.ai/', { headers: { 'user-agent': searchAgent } }), env())).status).toBe(200);
    expect((await routeRequest(new Request('https://demo.wizardgang.ai/api/operations/version', { headers: { 'user-agent': userAgent } }), env())).status).toBe(200);

    const trainingBlocked = await routeRequest(new Request('https://demo.wizardgang.ai/', { headers: { 'user-agent': trainingAgent } }), env());
    expect(trainingBlocked.status).toBe(403);
    expect(await trainingBlocked.json()).toMatchObject({ agent: 'GPTBot', reason: 'model_training_disabled' });

    const deniedRoute = await routeRequest(new Request('https://demo.wizardgang.ai/admin/api/labs/git-delivery', { headers: { 'user-agent': userAgent } }), env());
    expect(deniedRoute.status).toBe(403);
    expect(deniedRoute.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(await deniedRoute.json()).toMatchObject({ agent: 'ChatGPT-User', reason: 'route_crawling_denied' });

    expect((await routeRequest(new Request('https://demo.wizardgang.ai/'), env())).status).toBe(200);
  });
});
