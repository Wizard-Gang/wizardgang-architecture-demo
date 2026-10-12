import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { demoCategories, demonstrations } from '../src/demos/demos-page';
import { applicationRouteRegistry, routeUrl } from '../src/routing/application-routes';
import { routeRequest } from '../src/router';
import type { Env } from '../src/types';
import { removedHtmlPathnames } from './fixtures/removed-html-pathnames';
import { SqliteD1 } from './helpers/wg-storage';

const env = {
  WG_DB: new SqliteD1(),
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
} as Env;

const released = [
  ['d1', 'Data', 'D1'], ['r2', 'Data', 'R2'], ['rest', 'APIs', 'REST / OpenAPI'],
  ['graphql', 'APIs', 'GraphQL'], ['webhooks', 'Integrations', 'Webhooks'],
  ['oauth', 'Identity', 'OAuth 2.0'], ['sso', 'Identity', 'SSO'], ['saml', 'Identity', 'SAML'], ['mcp', 'AI', 'MCP'], ['edge', 'Platform', 'Edge'],
  ['workers', 'Platform', 'Workers'], ['durable-objects', 'Platform', 'Durable Objects'],
  ['accessibility', 'Quality', 'Accessibility'], ['i18n', 'Quality', 'Internationalization'],
] as const;

const taxonomy = {
  Data: ['d1', 'r2'], APIs: ['rest', 'graphql'], Integrations: ['webhooks'],
  Identity: ['oauth', 'sso', 'saml'], AI: ['mcp'], Platform: ['edge', 'workers', 'durable-objects'],
  Quality: ['accessibility', 'i18n'],
} as const;

describe('DEMO-271 Demo Workbench MVP acceptance', () => {
  it('locks all fourteen stable fragments and the exact seven-category taxonomy', () => {
    expect(demonstrations.map(({ id, category, label }) => [id, category, label])).toEqual(released);
    expect(demoCategories).toEqual(Object.keys(taxonomy));
    expect(demoCategories).not.toContain('All demos');
    for (const category of demoCategories) {
      expect(demonstrations.filter((demo) => demo.category === category).map((demo) => demo.id)).toEqual(taxonomy[category]);
    }
  });

  it('ships one server-rendered D1 workbench with only category-local secondary navigation', async () => {
    const response = await routeRequest(new Request('https://demo.wizardgang.ai/demos', { headers: { accept: 'text/html' } }), env);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect((html.match(/<section id="demo-workbench"[^>]+data-demo-workbench\b/g) ?? [])).toHaveLength(1);
    expect((html.match(/<div class="demo-panel"[^>]+data-demo-panel\b/g) ?? [])).toHaveLength(1);
    expect((html.match(/<div[^>]+data-demo-section\b/g) ?? [])).toHaveLength(1);
    expect(html).toContain('data-demo-id="d1"');
    expect(html).toContain('data-demo-section="d1"');
    for (const [id] of released) expect(html).toContain(`demo=${id}#${id}"`);
    for (const category of ['Data', 'APIs', 'Identity', 'Platform', 'Quality']) expect(html).toContain(`aria-label="${category} demos"`);
    for (const category of ['Integrations', 'AI']) expect(html).not.toContain(`aria-label="${category} demos"`);
    expect(html).not.toContain('All demos');
    expect(html).not.toContain('Primary demonstrations');
    expect(html).not.toContain('Supporting proof');
  });

  it('keeps /demos as the only ordinary public demo page and retired demo URLs as plain 404s', async () => {
    const demoPages = applicationRouteRegistry.declarations.filter((route) => route.kind === 'page' && (
      route.id.startsWith('demos.') || route.pattern.includes('demo') || route.pattern.includes('graphql')
      || route.pattern.includes('webhook') || route.pattern.includes('identity') || route.pattern.includes('accessibility')
    ));
    expect(demoPages.map((route) => [route.id, route.pattern])).toEqual([['demos.index', routeUrl('demos.index')]]);
    const retiredDemoPaths = removedHtmlPathnames
      .filter((entry) => entry.outcome === '404' && 'supersededBy' in entry && entry.supersededBy === 'demos.index')
      .map((entry) => entry.pathname);
    for (const path of retiredDemoPaths) {
      const response = await routeRequest(new Request(`https://demo.wizardgang.ai${path}`, { headers: { accept: 'text/html' } }), env);
      expect(response.status, path).toBe(404);
      expect(response.headers.get('location'), path).toBeNull();
    }
  });

  it('preserves registered presentation and machine/protocol capabilities for every demo family', () => {
    const routes = applicationRouteRegistry.declarations;
    expect(routes.find((route) => route.id === 'demos.presentation')).toMatchObject({ pattern: '/api/demos/:demo', kind: 'api', methods: ['GET'] });
    for (const [id] of released) expect(demonstrations.find((demo) => demo.id === id)?.render).toBeTypeOf('function');
    const requiredRouteIds = [
      'platform.d1.users', 'platform.r2.files', 'platform.d1.rest-demo-records', 'interfaces.graphql.endpoint',
      'platform.webhooks.synthetic', 'interfaces.identity.session', 'interfaces.mcp.server', 'platform.edge.inspect',
      'platform.workers.compute', 'platform.durable-objects.counter', 'platform.accessibility.lab',
    ];
    for (const id of requiredRouteIds) expect(routes.some((route) => route.id === id), id).toBe(true);
  });

  it('locks lifecycle, history, loading, error, keyboard, responsive, inspector, and REST invariants', () => {
    const registrySource = readFileSync('src/demos/demos-page.ts', 'utf8');
    const source = readFileSync('src/browser/demos.ts', 'utf8');
    const rest = readFileSync('src/demos/rest-presentation.tsx', 'utf8');
    const styles = readFileSync('src/styles/demos.css', 'utf8');
    for (const contract of [
      'return byId.has(id) ? id : config.defaultDemoId',
      'pending.get(activeId)?.abort()', "panel.querySelector('[data-demo-section]')?.dispatchEvent(new CustomEvent('demo:deactivate'))",
      'if (activeId !== id || controller.signal.aborted) return', 'if (htmlCache.size >= config.demos.length',
      "history.pushState(null, '', nextHash)", "window.addEventListener('hashchange', applySelection)",
      "window.addEventListener('popstate', applySelection)", "renderState(messages.loading.replace('{label}', demo.label))",
      "renderState(error instanceof Error ? error.message : messages.failed, 'alert', true, id)",
      'retry.textContent = messages.retry', "['ArrowLeft', 'ArrowRight', 'Home', 'End']",
      "type InspectorMode = 'Guide' | 'Request' | 'Evidence'",
    ]) expect(source).toContain(contract);
    expect(registrySource).toContain("export const DEFAULT_DEMO_ID = 'd1'");
    for (const contract of [
      'grid-template-columns:minmax(0,7fr) minmax(16rem,3fr)',
      '@media(max-width:900px){.demo-workbench-layout{grid-template-columns:minmax(0,1fr)}',
      '.demo-evidence-list code{direction:ltr;unicode-bidi:isolate',
    ]) expect(styles).toContain(contract);
    expect(demonstrations.filter((demo) => demo.request).map((demo) => demo.id)).toEqual(['d1']);
    expect(rest).toContain('data-rest-operation-browser');
    expect(rest).toContain('data-rest-full-openapi');
    expect(rest).not.toContain('rest-full-contract');
  });
});
