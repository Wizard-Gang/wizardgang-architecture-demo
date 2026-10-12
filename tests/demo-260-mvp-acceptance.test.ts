import { describe, expect, it } from 'vitest';
import auditConfig from '../config/site-audit-states.json';
import routeManifest from '../src/generated/route-manifest.json';
import { AVAILABILITY_RETENTION_DAYS } from '../src/api/operations';
import { demonstrations } from '../src/demos/demos-page';
import { runScheduledOperations } from '../src/index';
import { recordApplicationLog } from '../src/lib/logs';
import { routeRequest } from '../src/router';
import { browserAssetName } from '../src/ui/asset-map';
import {
  applicationRouteRegistry,
  routeUrl,
} from '../src/routing/application-routes';
import {
  architectureMapEntries,
  primaryNavigation,
  sitemapPaths,
} from '../src/routing/navigation';
import type { Env } from '../src/types';
import { demoDatabase, type SqliteD1 } from './helpers/wg-storage';
import {
  removedHtml404Pathnames,
  retiredOperationsHtmlPathname,
} from './fixtures/removed-html-pathnames';

const repositoryUrl = 'https://github.com/Wizard-Gang/wizardgang-architecture-demo';

function environment(offline = false): Env {
  return {
    WG_DB: demoDatabase({
      demo: offline ? 'offline' : 'online',
      message: offline ? 'Acceptance maintenance window' : 'Available.',
      crawler: 'enabled',
      availability: { verified: 101, operational: 99, intentional: 1 },
    }),
    ASSETS: {
      async fetch(request) {
        const contentType = new URL(request.url).pathname.endsWith('.png') ? 'image/png' : 'application/octet-stream';
        return new Response(request.method === 'HEAD' ? null : 'asset', { headers: { 'content-type': contentType } });
      },
    },
    WG_SESSION_KEY: 'test-demo-session-secret-with-at-least-32-characters',
    GITHUB_REPO_URL: repositoryUrl,
    GITHUB_BRANCH: 'main',
    DEPLOYED_VERSION: 'v0.21.0-test',
    DEPLOYED_SHA: 'abcdef0123456789',
    DEPLOYMENT_ENVIRONMENT: 'acceptance',
    BILLING_DEMO_MONTHLY_BUDGET_USD: '10',
  } as Env;
}

async function request(
  path: string,
  env: Env = environment(),
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('accept')) headers.set('accept', 'text/html');
  return routeRequest(new Request(new URL(path, 'https://demo.example'), {
    ...init,
    headers,
  }), env, { adminAuthorized: headers.get('authorization') === `Basic ${Buffer.from('operator:test-admin-password').toString('base64')}` });
}

async function page(routeId: string, env = environment()): Promise<{ response: Response; html: string }> {
  const response = await request(routeUrl(routeId), env);
  return { response, html: await response.text() };
}

function normalizeManifestPattern(pattern: string): string {
  return pattern.replace(/\{([^}]+)\}/g, ':$1');
}

function manifestProjection() {
  return (routeManifest as Array<{
    id: string;
    route: string;
    methods: string[];
    kind: string;
    visibility: 'public' | 'private';
  }>).map((route) => ({
    id: route.id,
    pattern: normalizeManifestPattern(route.route),
    methods: [...route.methods],
    kind: route.kind,
    visibility: route.visibility,
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function declarationProjection() {
  return applicationRouteRegistry.declarations.map((route) => ({
    id: route.id,
    pattern: route.pattern,
    methods: [...route.methods],
    kind: route.kind,
    visibility: route.visibility,
  })).sort((left, right) => left.id.localeCompare(right.id));
}

describe('DEMO-260 MVP acceptance contract', () => {
  it('locks authoritative browser inventory and keeps retired routes retired', async () => {
    expect(manifestProjection()).toEqual(declarationProjection());

    const pages = applicationRouteRegistry.declarations
      .filter((route) => route.kind === 'page' && route.methods.includes('GET'));
    expect(pages.map((route) => route.id).sort()).toEqual([
      'demos.index',
      'interfaces.frontend.index',
      'operations.admin',
      'operations.offline',
    ]);
    expect(pages.filter((route) => route.visibility === 'public').map((route) => route.id).sort()).toEqual([
      'demos.index',
      'interfaces.frontend.index',
      'operations.offline',
    ]);
    expect(pages.find((route) => route.id === 'operations.admin')?.visibility).toBe('private');
    expect(applicationRouteRegistry.declarations.some((route) => route.id === 'operations.index')).toBe(false);
    expect(applicationRouteRegistry.declarations.some((route) => route.pattern === retiredOperationsHtmlPathname)).toBe(false);

    for (const pathname of removedHtml404Pathnames) {
      const response = await request(pathname);
      expect(response.status, pathname).toBe(404);
      expect(response.headers.get('location'), pathname).toBeNull();
    }
    for (const suffix of ['', '?anything=still-retired', '?view=overview']) {
      const response = await request(`${retiredOperationsHtmlPathname}${suffix}`);
      expect(response.status, suffix).toBe(404);
      expect(response.headers.get('location'), suffix).toBeNull();
    }

    expect(primaryNavigation().map((route) => route.id)).toEqual(['demos.index']);
    expect(architectureMapEntries().map((route) => route.id)).toEqual(['demos.index']);
    expect([...sitemapPaths()].sort()).toEqual([
      routeUrl('interfaces.frontend.index'),
      routeUrl('demos.index'),
    ].sort());
    expect(sitemapPaths()).not.toContain(retiredOperationsHtmlPathname);
  });

  it('keeps the homepage minimal with direct Source and compact live proof', async () => {
    const { response, html } = await page('interfaces.frontend.index');
    expect(response.status).toBe(200);
    const header = html.match(/<header class="site-header">([\s\S]*?)<\/header>/)?.[0] ?? '';
    const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[0] ?? '';

    expect(header).toContain(`href="${routeUrl('demos.index')}"`);
    expect(header).toContain(`href="${repositoryUrl}" aria-label="Source"><span class="utility-label">Source`);
    expect(header).not.toContain(`href="${retiredOperationsHtmlPathname}"`);

    for (const required of [
      'Explore demos',
      'aria-label="Live proof"',
      'Current service state',
      '99.000%',
      '100 measured intervals · planned offline excluded',
      'v0.21.0-test',
      'Commit abcdef0',
    ]) expect(main).toContain(required);
    expect(main).not.toContain(`href="${retiredOperationsHtmlPathname}"`);
    expect(main).not.toContain('<table');
    for (const forbidden of [
      'Operations dashboard',
      'Application logs',
      'Raw logs',
      'Resource pressure',
      'Synthetic billing',
      'Cost dashboard',
      'Usage & Cost',
    ]) expect(main).not.toContain(forbidden);
  });

  it('keeps curated demos organized and representative endpoints reachable', async () => {
    expect(demonstrations.filter((demo) => demo.tier === 'primary').map((demo) => demo.id)).toEqual([
      'd1', 'r2', 'rest', 'graphql', 'webhooks', 'oauth', 'sso', 'saml', 'mcp',
    ]);
    expect(demonstrations.filter((demo) => demo.tier === 'secondary').map((demo) => demo.id)).toEqual([
      'edge', 'workers', 'durable-objects', 'accessibility', 'i18n',
    ]);

    const { response, html } = await page('demos.index');
    expect(response.status).toBe(200);
    for (const group of ['Data', 'APIs', 'Integrations', 'Identity', 'AI / MCP']) {
      expect(html).toContain(`>${group}</strong>`);
    }
    for (const demo of demonstrations) {
      expect(html).toContain(`id="${demo.id}"`);
      const presentation = await request(routeUrl('demos.presentation', { demo: demo.id }));
      expect(presentation.status, demo.id).toBe(200);
      expect((await presentation.text()).length, demo.id).toBeGreaterThan(100);
    }

    const routeIds = new Set(applicationRouteRegistry.declarations.map((route) => route.id));
    for (const id of [
      'platform.d1.users',
      'platform.r2.files',
      'interfaces.rest.openapi.json',
      'interfaces.graphql.endpoint',
      'interfaces.identity.session',
      'interfaces.mcp.server',
    ]) expect(routeIds.has(id), id).toBe(true);

    const openapi = await request(routeUrl('interfaces.rest.openapi.json'), environment(), {
      headers: { accept: 'application/json' },
    });
    expect(openapi.status).toBe(200);
    expect(await openapi.json()).toMatchObject({ openapi: '3.0.3' });

    const graphql = await request(routeUrl('interfaces.graphql.endpoint'), environment(), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        origin: 'https://demo.example',
      },
      body: JSON.stringify({
        operationName: 'IntrospectionQuery',
        query: 'query IntrospectionQuery { __schema { queryType { name } mutationType { name } } }',
      }),
    });
    expect(graphql.status).toBe(200);
    expect(await graphql.json()).toMatchObject({
      data: { __schema: { queryType: { name: 'Query' }, mutationType: { name: 'Mutation' } } },
    });

    const identity = await request(routeUrl('interfaces.identity.session'), environment(), {
      headers: { accept: 'application/json' },
    });
    expect(identity.status).toBe(200);
    expect(await identity.json()).toMatchObject({
      authenticated: false,
      providers: {
        microsoft: { configured: false },
        google: { configured: false },
        github: { configured: false },
        saml: { configured: false },
      },
    });

    const mcp = await request(routeUrl('demos.presentation', { demo: 'mcp' }));
    const mcpHtml = await mcp.text();
    for (const required of ['Available tools', '<code>ping</code>', 'Run ping', 'Connect a client', 'Copy endpoint']) {
      expect(mcpHtml).toContain(required);
    }
  });

  it('keeps Source and private vulnerability reporting reachable', async () => {
    const home = await page('interfaces.frontend.index');
    expect(home.html).toContain(`href="${repositoryUrl}" aria-label="Source"><span class="utility-label">Source`);
    expect(home.html).toContain(`href="${repositoryUrl}/security/policy"`);

    const securityTxt = await request(routeUrl('operations.security-txt'));
    expect(securityTxt.status).toBe(200);
    const policy = await securityTxt.text();
    expect(policy).toContain(`Contact: ${repositoryUrl}/security/advisories/new`);
    expect(policy).toContain(`Policy: ${repositoryUrl}/security/policy`);
  });

  it('preserves operational machine contracts, collection, retention, and redaction', async () => {
    const routeIds = new Set(applicationRouteRegistry.declarations.map((route) => route.id));
    for (const id of [
      'operations.health',
      'operations.version',
      'operations.api-logs',
      'operations.api-budget',
      'operations.robots',
      'operations.sitemap',
      'operations.security-txt',
      'operations.assets',
    ]) expect(routeIds.has(id), id).toBe(true);

    const health = await request(routeUrl('operations.health'), environment(), {
      headers: { accept: 'application/json' },
    });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      status: 'operational',
      services: { worker: 'operational', d1: 'operational' },
    });

    const version = await request(routeUrl('operations.version'), environment(), {
      headers: { accept: 'application/json' },
    });
    expect(version.status).toBe(200);
    expect(await version.json()).toMatchObject({
      version: 'v0.21.0-test',
      commit: 'abcdef0123456789',
      branch: 'main',
    });

    const logs = await request(routeUrl('operations.api-logs'), environment(), {
      headers: { accept: 'application/json' },
    });
    expect(logs.status).toBe(200);
    expect(await logs.json()).toEqual({ results: [] });

    const robots = await request(routeUrl('operations.robots'));
    expect(robots.status).toBe(200);
    expect(await robots.text()).toContain('User-agent:');

    const sitemap = await request(routeUrl('operations.sitemap'));
    expect(sitemap.status).toBe(200);
    expect(await sitemap.text()).not.toContain(retiredOperationsHtmlPathname);

    const asset = await request(routeUrl('operations.assets', { asset: browserAssetName('social.card') }));
    expect(asset.status).toBe(200);

    const scheduledEnv = environment();
    const database = scheduledEnv.WG_DB as SqliteD1;
    const scheduledTime = Date.parse('2026-09-15T00:00:00.000Z');
    await runScheduledOperations(scheduledEnv, scheduledTime);
    expect(AVAILABILITY_RETENTION_DAYS).toBe(365);
    expect([...database.records('health').keys()]).toEqual(['2026-09-15T00:00:00.000Z']);
    expect(database.records('availability').get('2026-09-15')?.body).toEqual({ verified: 1, operational: 1, intentional: 0 });

    const logEnv = environment();
    const logDb = logEnv.WG_DB as SqliteD1;
    await recordApplicationLog(logEnv, {
      source: 'acceptance',
      eventKey: 'redaction',
      message: 'MVP acceptance log',
      detail: { token: 'secret-token-value', safe: 'visible' },
    });
    const [logInsert] = logDb.applicationLogRows();
    expect(logInsert).toBeDefined();
    expect(String(logInsert?.detail_json)).toContain('"token":"[redacted]"');
    expect(String(logInsert?.detail_json)).toContain('"safe":"visible"');
    expect(String(logInsert?.detail_json)).not.toContain('secret-token-value');
  });

  it('preserves hidden offline/admin boundaries and declared offline behavior', async () => {
    const offlineEnv = environment(true);

    const retired = await request(retiredOperationsHtmlPathname, offlineEnv);
    expect(retired.status).toBe(404);
    expect(retired.headers.get('location')).toBeNull();

    const offline = await request(routeUrl('operations.offline'), offlineEnv);
    expect(offline.status).toBe(503);
    expect(await offline.text()).toContain('Acceptance maintenance window');

    const unauthenticatedAdmin = await request(routeUrl('operations.admin'), offlineEnv);
    expect(unauthenticatedAdmin.status).toBe(401);

    const authenticatedAdmin = await request(routeUrl('operations.admin'), offlineEnv, {
      headers: {
        accept: 'text/html',
        authorization: `Basic ${Buffer.from('operator:test-admin-password').toString('base64')}`,
      },
    });
    expect(authenticatedAdmin.status).toBe(200);
    expect(authenticatedAdmin.headers.get('content-type')).toContain('text/html');

    const health = await request(routeUrl('operations.health'), offlineEnv, {
      headers: { accept: 'application/json' },
    });
    expect(health.status).toBe(503);
    expect(health.headers.get('location')).toBeNull();
    expect(await health.json()).toMatchObject({ status: 'offline', demo: { state: 'offline' } });

    const gatedSitemap = await request(routeUrl('operations.sitemap'), offlineEnv, {
      headers: { accept: 'application/json' },
    });
    expect(gatedSitemap.status).toBe(503);
    expect(await gatedSitemap.json()).toMatchObject({ status: 'offline' });

    const availableSecurityTxt = await request(routeUrl('operations.security-txt'), offlineEnv);
    expect(availableSecurityTxt.status).toBe(200);
  });

  it('keeps accessibility/localization audit inventory synced to remaining public HTML', () => {
    const publicPageIds = applicationRouteRegistry.declarations
      .filter((route) => route.kind === 'page' && route.visibility === 'public' && route.methods.includes('GET'))
      .map((route) => route.id)
      .sort();
    const manifestPublicPageIds = (routeManifest as Array<{
      id: string;
      kind: string;
      visibility: string;
      methods: string[];
    }>).filter((route) => route.kind === 'page' && route.visibility === 'public' && route.methods.includes('GET'))
      .map((route) => route.id)
      .sort();

    expect(publicPageIds).toEqual([
      'demos.index',
      'interfaces.frontend.index',
      'operations.offline',
    ]);
    expect(manifestPublicPageIds).toEqual(publicPageIds);

    const publicPatterns = applicationRouteRegistry.declarations
      .filter((route) => publicPageIds.includes(route.id))
      .map((route) => route.pattern);
    for (const state of auditConfig.states) {
      const pathname = new URL(state.path, 'https://demo.example').pathname;
      expect(publicPatterns).toContain(pathname);
      expect(pathname).not.toBe(retiredOperationsHtmlPathname);
    }
  });

  it('guards ordinary product HTML against console and inventory regressions', async () => {
    const pages = await Promise.all([
      page('interfaces.frontend.index'),
      page('demos.index'),
    ]);
    const html = pages.map((entry) => entry.html).join('\n');
    for (const forbidden of [
      'Operations dashboard',
      'Registry browser',
      'Browse risk records',
      'Browse incident and exercise records',
      'Browse governance records',
      'resource-pressure-table',
      'billing-dashboard',
    ]) expect(html).not.toContain(forbidden);
  });
});
