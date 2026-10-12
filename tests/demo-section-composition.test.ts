import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MCP_SERVER_PATH } from '../src/api/mcp';
import {
  accessibilitySection,
  d1Section,
  durableObjectsSection,
  edgeSection,
  graphqlSection,
  i18nSection,
  identitySection,
  mcpSection,
  r2Section,
  restSection,
  webhooksSection,
  workersSection,
} from '../src/demos/composable-presentations';
import { routeUrl } from '../src/routing/application-routes';
import type { Env } from '../src/types';
import type { DemoSection } from '../src/ui/demo-section';
import { demoDatabase } from './helpers/wg-storage';

const env: Env = {
  WG_DB: demoDatabase(),
  WG_SESSION_KEY: 'test-composition-cursor-secret-that-is-long-enough',
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
};

const request = new Request('https://demo.wizardgang.ai/demos?count=3', {
  headers: { accept: 'text/html' },
});

function withoutScripts(html: string): string {
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

function headings(html: string): number[] {
  return [...html.matchAll(/<h([1-6])(?:\s|>)/g)].map((match) => Number(match[1]));
}

async function composedSections(): Promise<DemoSection[]> {
  return [
    edgeSection(env),
    workersSection(env),
    durableObjectsSection(env),
    d1Section(env),
    r2Section(env),
    restSection(env),
    graphqlSection(env),
    webhooksSection(env),
    identitySection(env),
    await mcpSection(request, env),
    accessibilitySection(request, env),
    i18nSection(request, env),
  ];
}

describe('composable demo presentations', () => {
  it('places all twelve demonstrations in one document without duplicate DOM IDs', async () => {
    const sections = await composedSections();
    const html = `<main><h1>Demonstrations</h1>${sections.map((item) => item.body).join('')}</main>`;
    const markup = withoutScripts(html);
    const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);

    expect(sections).toHaveLength(12);
    expect(new Set(ids).size).toBe(ids.length);

    for (const match of markup.matchAll(/(?:^|[\s<])(?:for|aria-controls|aria-labelledby|aria-describedby|aria-owns|aria-activedescendant|headers|list|form|data-copy-target)="([^"]+)"/g)) {
      for (const referencedId of match[1].split(/\s+/)) {
        expect(ids, `missing referenced ID ${referencedId}`).toContain(referencedId);
      }
    }
    for (const match of markup.matchAll(/href="#([^"]+)"/g)) {
      expect(ids, `missing fragment target ${match[1]}`).toContain(match[1]);
    }
  });

  it('produces one h1 with h2-rooted sections and a valid heading outline', async () => {
    const sections = await composedSections();
    for (const item of sections) {
      const levels = headings(withoutScripts(item.body));
      expect(levels[0], item.scope).toBe(2);
      expect(levels, item.scope).not.toContain(1);
    }

    const levels = headings(`<h1>Demonstrations</h1>${sections.map((item) => withoutScripts(item.body)).join('')}`);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index], `heading ${index}`).toBeLessThanOrEqual(levels[index - 1] + 1);
    }
  });

  it('keeps interactive controls native and scopes every client script to its own section', async () => {
    const sections = await composedSections();
    for (const item of sections) {
      const markup = withoutScripts(item.body);
      expect(markup, item.scope).not.toMatch(/<(?:div|span)[^>]*\brole="button"/i);
      if (item.body.includes('data-demo-browser-module=')) {
        expect(item.body, item.scope).toContain('data-config=');
        expect(item.body, item.scope).not.toContain('<script');
      } else {
        expect(item.body, item.scope).toContain(`document.querySelector('[data-demo-section="${item.scope}"]')`);
        expect(item.body, item.scope).toContain('const sectionDocument = new Proxy(sectionRoot');
      }
    }

    const tabSections = sections.filter((item) => /\brole="tab"/.test(withoutScripts(item.body)));
    expect(tabSections.length).toBeGreaterThan(0);
    for (const item of tabSections) {
      const tabs = [...withoutScripts(item.body).matchAll(/<button\b[^>]*\brole="tab"[^>]*>/g)].map((match) => match[0]);
      expect(tabs.length, item.scope).toBeGreaterThan(0);
      for (const tab of tabs) {
        expect(tab, item.scope).toContain('type="button"');
        expect(tab, item.scope).toContain('aria-controls=');
      }
    }

    const d1Browser = readFileSync('src/browser/d1.ts', 'utf8');
    expect(d1Browser).toContain('ArrowLeft');
    expect(d1Browser).toContain('ArrowRight');
    const identityBrowser = readFileSync('src/browser/identity.ts', 'utf8');
    expect(identityBrowser).toContain('ArrowLeft');
    expect(identityBrowser).toContain('ArrowRight');
  });

  it('parameterizes presentation ownership while preserving machine and protocol targets', async () => {
    const presentationPath = routeUrl('demos.index');
    const options = { presentationPath, canonicalPath: presentationPath } as const;
    const identity = identitySection(env, options);
    const i18n = i18nSection(request, env, options);
    const graphql = graphqlSection(env, options);
    const mcp = await mcpSection(request, env, options);

    expect(identity.page.canonicalPath).toBe(presentationPath);
    expect(i18n.page.canonicalPath).toBe(presentationPath);
    expect(identity.body).not.toContain(`${routeUrl('demos.index')}#identity`);
    expect(i18n.body).not.toContain(`${routeUrl('demos.index')}#i18n`);
    expect(readFileSync('src/browser/identity.ts', 'utf8')).toContain('/auth/session');
    expect(graphql.body).toContain('/graphql');
    expect(mcp.body).toContain(MCP_SERVER_PATH);

    const endpointEvidence = [
      [readFileSync('src/browser/edge.ts', 'utf8'), '/api/labs/edge'],
      [readFileSync('src/browser/workers.ts', 'utf8'), '/api/labs/workers'],
      [readFileSync('src/browser/durable-objects.ts', 'utf8'), '/api/labs/durable-counter'],
      [readFileSync('src/browser/d1.ts', 'utf8'), '/api/labs/d1-'],
      [readFileSync('src/browser/r2.ts', 'utf8'), '/api/labs/r2-files'],
      [restSection(env).body, '/api/labs/rest-demo-records'],
      [readFileSync('src/browser/webhooks.ts', 'utf8'), '/api/labs/webhook-demo'],
      [readFileSync('src/demos/accessibility-presentation.tsx', 'utf8'), "routeUrl('platform.accessibility.lab')"],
    ] as const;
    for (const [body, endpoint] of endpointEvidence) expect(body).toContain(endpoint);
  });

  it('owns each presentation under the consolidated demos route with stable scoped IDs and headings', () => {
    const section = edgeSection(env);
    expect(section.body).toContain('data-demo-section="edge"');
    expect(section.body).toContain('id="edge-');
    expect(section.body).not.toContain('id="edge-edge-');
    expect(headings(withoutScripts(section.body))[0]).toBe(2);
    expect(section.page.canonicalPath).toBe(`${routeUrl('demos.index')}#edge`);
  });
});
