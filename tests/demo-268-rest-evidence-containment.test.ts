import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { restDemoOpenApiDocument } from '../src/api/rest-demo-openapi';
import { restSection } from '../src/demos/rest-presentation';
import { demonstrations } from '../src/demos/demos-page';
import { applicationRouteRegistry } from '../src/routing/application-routes';
import type { Env } from '../src/types';

const env = {
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
} as Env;

function restPresentation(): string {
  return restSection(env).body;
}

const releasedFragments = [
  'd1',
  'r2',
  'rest',
  'graphql',
  'webhooks',
  'oauth',
  'sso',
  'saml',
  'mcp',
  'edge',
  'workers',
  'durable-objects',
  'accessibility',
  'i18n',
] as const;

describe('DEMO-268 REST evidence containment', () => {
  it('keeps REST at the stable fragment and all fourteen released demonstrations registered', () => {
    expect(demonstrations.map((demo) => demo.id)).toEqual(releasedFragments);
    expect(demonstrations.find((demo) => demo.id === 'rest')?.id).toBe('rest');

    const registrySource = readFileSync('src/demos/demos-page.ts', 'utf8');
    const browserSource = readFileSync('src/browser/demos.ts', 'utf8');
    expect(registrySource).toContain("export const DEFAULT_DEMO_ID = 'd1'");
    expect(browserSource).toContain("history.pushState(null, '', nextHash)");
    expect(browserSource).toContain("window.addEventListener('hashchange', applySelection)");
    expect(browserSource).toContain("window.addEventListener('popstate', applySelection)");
    expect(registrySource).not.toContain('All demos');
  });

  it('renders six native expandable operations with execution evidence in document order', () => {
    const html = restPresentation();
    const operationCount = 6;

    expect(Object.keys(restDemoOpenApiDocument.paths)).toHaveLength(2);
    expect(html).toContain('data-rest-operation-browser');
    expect(html.match(/data-rest-operation-select=/g)).toHaveLength(operationCount);
    expect(html.match(/data-rest-operation-panel=/g)).toHaveLength(operationCount);
    expect(html.match(/<details class="rest-operation"/g)).toHaveLength(operationCount);
    expect(html).toContain('id="rest-rest-demo-listRecords-responses-heading">Responses</h4>');
    expect(html).toContain('id="rest-rest-demo-listRecords-try-heading">Try it out</h4>');
    expect(html).toContain('data-rest-curl=""');
    expect(html).toContain('data-rest-duration=""');
    expect(html).not.toContain('Full OpenAPI contract');
    expect(html).not.toContain('<div class="rest-schema-list">');
  });

  it('links the single OpenAPI document in the info header', () => {
    const html = restPresentation();
    expect(html).toContain('href="/api/openapi.json" data-rest-full-openapi="">Raw REST OpenAPI JSON</a>');
    expect(html).toContain('wg_demo_session');
    expect(html).not.toContain(JSON.stringify(restDemoOpenApiDocument));
  });

  it('binds editable requests and declared responses to each operation', () => {
    const html = restPresentation();
    expect(html).toContain('data-rest-operation-select="listRecords"');
    expect(html).toContain('data-rest-operation-panel="listRecords"');
    expect(html).toContain('data-rest-form="" data-method="GET" data-path="/api/labs/rest-demo-records"');
    expect(html).toContain('data-rest-operation-select="updateRecord"');
    expect(html).toContain('data-rest-form="" data-method="PATCH" data-path="/api/labs/rest-demo-records/{id}"');
    expect(html).toContain('id="rest-schema-RecordPatch"');
    expect(html).toContain('The record key.');
  });

  it('keeps REST browser evidence owned by the surviving main audit', () => {
    const mainAuditSource = readFileSync('scripts/site-browser-audit.ts', 'utf8');

    expect(mainAuditSource).toContain('REST evidence containment failed');
    expect(mainAuditSource).toContain('GET response/contract/curl evidence is incomplete');
    expect(mainAuditSource).toContain('PATCH behavior was not paired with its relevant contract');
    expect(mainAuditSource).toContain('for (const width of [320, 375, 768, 1440])');
  });

  it('keeps the REST demo routes and publishes them through the canonical OpenAPI source', () => {
    const routes = applicationRouteRegistry.declarations.map((route) => ({
      route: route.pattern,
      methods: route.methods,
      kind: route.kind,
    }));

    for (const expected of [
      '/api/labs/rest-demo-records',
      '/api/labs/rest-demo-records/:id',
      '/api/openapi.json',
    ]) {
      expect(routes.some((route) => route.route === expected && route.kind === 'api')).toBe(true);
    }
    expect(routes.some((route) => route.kind === 'page' && route.route.includes('rest'))).toBe(false);
    expect(readFileSync('src/api/rest-demo-openapi.ts', 'utf8')).toContain("openapi: '3.0.3'");
    expect(readFileSync('contracts/openapi/openapi.json', 'utf8')).toContain('"/api/labs/rest-demo-records"');
  });

  it('preserves the DEMO-267 persistent pane/inspector contract and removes the old REST disclosure dump', () => {
    const demosSource = readFileSync('src/browser/demos.ts', 'utf8');
    const apiSource = readFileSync('src/demos/rest-presentation.tsx', 'utf8');
    const demosStyles = readFileSync('src/styles/demos.css', 'utf8');

    expect(demosStyles).toContain('grid-template-columns:minmax(0,7fr) minmax(16rem,3fr)');
    expect(demosSource).toContain('pending.get(activeId)?.abort()');
    expect(demosSource).toContain("panel.querySelector('[data-demo-section]')?.dispatchEvent(new CustomEvent('demo:deactivate'))");
    expect(demosSource).toContain('if (htmlCache.size >= config.demos.length');
    expect(demosSource).toContain("type InspectorMode = 'Guide' | 'Request' | 'Evidence'");
    expect(apiSource).not.toContain('rest-full-contract');
    expect(apiSource).not.toContain('rest-guided-flow');
    expect(apiSource).not.toContain('durationMs');
    expect(apiSource).not.toContain('Full OpenAPI contract');
  });
});
