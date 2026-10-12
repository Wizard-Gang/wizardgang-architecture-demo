import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import assetManifest from '../src/generated/asset-manifest.json';
import { mountDemoPresentation } from '../src/browser/demo-presentation';
import { routeRequest } from '../src/router';
import type { Env } from '../src/types';
import {
  DemoHeading,
  DemoPresentationScope,
  createDemoPresentationScope,
  useDemoPresentationScope,
} from '../src/ui/demo-presentation-scope';
import { SqliteD1 } from './helpers/wg-storage';

const env = {
  WG_DB: new SqliteD1(),
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
} as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

function ScopedFixture() {
  const scope = useDemoPresentationScope();
  return <>
    <DemoHeading level={1} id={scope.id('title')}>Scoped title</DemoHeading>
    <label {...scope.attributes({ htmlFor: 'field' })}>Field</label>
    <input {...scope.attributes({
      id: 'field',
      'aria-labelledby': 'title help',
      'data-copy-target': '#field',
      list: 'choices',
    })} />
    <a {...scope.attributes({ href: '#field' })}>Jump</a>
  </>;
}

describe('DEMO-333 React demos workbench', () => {
  it('renders the localized workbench through React and a hashed browser module', async () => {
    const response = await routeRequest(new Request('https://demo.wizardgang.ai/demos?lang=ar#graphql', {
      headers: { accept: 'text/html' },
    }), env);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('data-demo-workbench=""');
    expect(html).toContain('data-demos-browser=""');
    expect(assetManifest.assets['scripts.demos']).toMatch(/^\/assets\/demos-browser-[A-Za-z0-9_-]+\.js$/);
    expect(html).toContain(`src="${assetManifest.assets['scripts.demos']}"`);
    expect(html).not.toContain('dangerouslySetInnerHTML');

    const workbenchSource = readFileSync('src/demos/demos-workbench.tsx', 'utf8');
    expect(workbenchSource).toContain('useRequestLocalization()');
    expect(workbenchSource).toContain('localization.exact(');
    expect(workbenchSource).toContain("browserAssetName('scripts.demos')");
    expect(workbenchSource).not.toContain('localizePresentation');
    expect(workbenchSource).not.toContain('escapeHtml');
  });

  it('mounts declared presentation modules and rejects undeclared legacy fragments', async () => {
    const window = new Window();
    vi.stubGlobal('document', window.document);

    const migrated = window.document.createElement('div');
    migrated.dataset.demoBrowserModule = '/assets/presentation-proof.js';
    const migratedScript = window.document.createElement('script');
    migratedScript.textContent = 'window.legacyExecuted = true';
    migrated.append(migratedScript);
    const mount = vi.fn();
    const loadModule = vi.fn(async () => ({ mount }));
    await mountDemoPresentation(migrated, loadModule);
    expect(loadModule).toHaveBeenCalledWith('/assets/presentation-proof.js');
    expect(mount).toHaveBeenCalledWith(migrated);
    expect(migrated.querySelector('script')).toBe(migratedScript);

    const legacy = window.document.createElement('div');
    const legacyLoader = vi.fn();
    await expect(mountDemoPresentation(legacy, legacyLoader)).rejects.toThrow('does not declare a browser module');
    expect(legacyLoader).not.toHaveBeenCalled();
  });

  it('prefixes React presentation IDs and references while shifting headings', () => {
    const scope = createDemoPresentationScope('proof', 3);
    expect(scope.id('field')).toBe('proof-field');
    expect(scope.references('title help')).toBe('proof-title proof-help');
    expect(scope.fragment('field')).toBe('#proof-field');
    expect(scope.heading(1)).toBe(3);
    expect(scope.heading(3)).toBe(5);

    const html = renderToStaticMarkup(createElement(DemoPresentationScope, {
      name: 'proof',
      headingLevel: 3,
      browserModule: '/assets/presentation-proof.js',
      children: createElement(ScopedFixture),
    }));
    expect(html).toContain('data-demo-section="proof"');
    expect(html).toContain('data-demo-browser-module="/assets/presentation-proof.js"');
    expect(html).toContain('<h3 id="proof-title">Scoped title</h3>');
    expect(html).toContain('<label for="proof-field">Field</label>');
    expect(html).toContain('id="proof-field"');
    expect(html).toContain('aria-labelledby="proof-title proof-help"');
    expect(html).toContain('data-copy-target="#proof-field"');
    expect(html).toContain('list="proof-choices"');
    expect(html).toContain('href="#proof-field"');
  });

  it('removes every raw HTML presentation boundary', () => {
    const documentSource = readFileSync('src/ui/document.tsx', 'utf8');
    const pageSource = readFileSync('src/ui/page.ts', 'utf8');
    expect(documentSource).toContain('<main className="site-main" id="main">{content.body}</main>');
    expect(documentSource).not.toContain('LegacyBody');
    expect(documentSource).not.toContain('dangerouslySetInnerHTML');
    expect(pageSource).not.toContain('export function renderPage(');
    expect(pageSource).not.toContain('interface PageContent extends');
    expect(pageSource).not.toContain('function pageContent(');
  });
});
