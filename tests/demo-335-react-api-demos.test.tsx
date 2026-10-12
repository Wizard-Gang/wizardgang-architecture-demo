import { existsSync, readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import assetManifest from '../src/generated/asset-manifest.json';
import { restDemoOpenApiDocument } from '../src/api/rest-demo-openapi';
import { bindLocalization, resolveLocalization } from '../src/i18n/runtime';
import { demonstrations } from '../src/demos/demos-page';
import { GRAPHQL_EXAMPLES } from '../src/demos/graphql-examples';
import { graphqlSection } from '../src/demos/graphql-presentation';
import { restSection } from '../src/demos/rest-presentation';
import type { Env } from '../src/types';
import { localGraphiqlDocument } from '../src/ui/graphiql-document';
import { initializeGraphiql } from '../src/browser/graphiql';

const env = {
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
} as Env;

function localizedEnv(locale: 'en' | 'ar'): Env {
  const request = new Request(`https://demo.wizardgang.ai/demos?lang=${locale}`);
  return bindLocalization(env, resolveLocalization(request));
}

describe('DEMO-335 React REST and GraphQL demonstrations', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('renders REST and GraphQL from React with localized configuration and hashed mounted modules', () => {
    const rest = restSection(localizedEnv('ar')).body;
    const graphql = graphqlSection(localizedEnv('ar')).body;
    const window = new Window();
    try {
      window.document.body.innerHTML = `${rest}${graphql}`;
      const restRoot = window.document.querySelector<HTMLElement>('[data-demo-section="rest"]');
      const graphqlRoot = window.document.querySelector<HTMLElement>('[data-demo-section="graphql"]');
      expect(rest).toContain('عرض WizardGang REST');
      expect(graphql).toContain('واجهة GraphQL API');
      expect(restRoot?.dataset.demoBrowserModule).toBe(assetManifest.assets['scripts.rest']);
      expect(graphqlRoot?.dataset.demoBrowserModule).toBe(assetManifest.assets['scripts.graphql']);
      expect(restRoot?.querySelector('script')).toBeNull();
      expect(graphqlRoot?.querySelector('script')).toBeNull();
      expect(JSON.parse(restRoot?.dataset.config ?? '{}')).toMatchObject({ locale: 'ar', messages: { invalidJson: 'تعذر تحليل المحتوى بصيغة JSON.' } });
      expect(JSON.parse(graphqlRoot?.dataset.config ?? '{}')).toMatchObject({ locale: 'ar', messages: { runningQuery: 'جارٍ تنفيذ الاستعلام…' } });
    } finally {
      void window.happyDOM.close();
    }
  });

  it('keeps all REST operations and OpenAPI links while removing code samples', () => {
    const html = restSection(env).body;
    const methodCount = Object.values(restDemoOpenApiDocument.paths).reduce((total, path) => total
      + ['get', 'post', 'put', 'patch', 'delete'].filter((method) => Object.hasOwn(path, method)).length, 0);
    expect(methodCount).toBe(6);
    expect(html.match(/data-rest-operation-select=/g)).toHaveLength(methodCount);
    expect(html.match(/data-rest-form=/g)).toHaveLength(methodCount);
    expect(html).toContain('href="/api/openapi.json"');
    expect(html).toContain('/rest-demo-records<wbr/></span><span>/{id}');
    expect(html).not.toContain('Code samples for this operation');
    expect(html).not.toContain('Focused browser tutorial');
    expect(html).not.toContain('Choose one request');
  });

  it('keeps both GraphQL request examples and the first-party query runner', () => {
    const html = graphqlSection(env).body;
    for (const example of GRAPHQL_EXAMPLES) {
      expect(html).toContain(example.query.replaceAll('"', '&quot;'));
    }
    expect(html).toContain('data-graphql-form=""');
    expect(html).toContain('name="query"');
    expect(html).toContain('data-graphql-workspace-result=""');
    const browser = readFileSync('src/browser/graphql.ts', 'utf8');
    expect(browser).toContain("fetch('/graphql'");
    expect(browser).toContain("method: 'POST'");
    expect(browser).toContain("accept: 'application/json'");
    expect(browser).toContain('root.querySelector');
    expect(browser).not.toContain('document.querySelector');
  });

  it('renders GraphiQL from React and delegates setup to its hashed browser module', () => {
    const html = localGraphiqlDocument(new Request('https://demo.wizardgang.ai/graphql', { headers: { accept: 'text/html' } }));
    expect(html).toContain('<!doctype html><html lang="en">');
    expect(html).toContain(assetManifest.assets['vendor.graphiql.styles']);
    expect(html).toContain(assetManifest.assets['vendor.graphiql.script']);
    expect(html).toContain(assetManifest.assets['scripts.graphiql']);
    expect(html).toContain(assetManifest.assets['vendor.monaco.editor']);
    expect(html).toContain(assetManifest.assets['vendor.monaco.json']);
    expect(html).toContain(assetManifest.assets['vendor.monaco.graphql']);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    const setup = readFileSync('src/browser/graphiql.ts', 'utf8');
    expect(setup).toContain('MonacoEnvironment');
    expect(setup).toContain('URL.createObjectURL');
    expect(setup).toContain('renderYogaGraphiQL');
  });

  it('loads the Monaco workers and mounts the vendored GraphiQL runtime locally', async () => {
    const html = localGraphiqlDocument(new Request('https://demo.wizardgang.ai/graphql', { headers: { accept: 'text/html' } }));
    const window = new Window({
      url: 'https://demo.wizardgang.ai/graphql',
      settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
    });
    const renderYogaGraphiQL = vi.fn();
    const workerFetch = vi.fn(async () => new Response('self.onmessage=()=>{}', { status: 200 }));
    try {
      window.document.write(html);
      const root = window.document.querySelector<HTMLElement>('#root[data-config]');
      expect(root).not.toBeNull();
      vi.stubGlobal('fetch', workerFetch);
      vi.stubGlobal('YogaGraphiQL', { renderYogaGraphiQL });
      await initializeGraphiql(root!);
      expect(workerFetch).toHaveBeenCalledTimes(3);
      expect(renderYogaGraphiQL).toHaveBeenCalledWith(root, expect.objectContaining({ endpoint: 'https://demo.wizardgang.ai/graphql' }));
      expect((globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment).toBeDefined();
    } finally {
      delete (globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment;
      await window.happyDOM.close();
    }
  });

  it('updates presentation ownership and removes the replaced legacy modules', () => {
    expect(demonstrations.find((demo) => demo.id === 'rest')?.sourcePath).toBe('src/demos/rest-presentation.tsx');
    expect(demonstrations.find((demo) => demo.id === 'graphql')?.sourcePath).toBe('src/demos/graphql-presentation.tsx');
    expect(existsSync('src/demos/api-page.ts')).toBe(false);
    expect(existsSync('src/demos/openapi-console.ts')).toBe(false);
    expect(existsSync('src/demos/graphql-console.ts')).toBe(false);
    expect(existsSync('src/ui/graphiql-assets.ts')).toBe(false);
  });
});
