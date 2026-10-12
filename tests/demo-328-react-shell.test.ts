import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import assetManifest from '../src/generated/asset-manifest.json';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('DEMO-328 React document shell', () => {
  it('renders every full document through React with no raw HTML boundary or shell inline handlers', () => {
    const documentSource = readFileSync('src/ui/document.tsx', 'utf8');
    const pageSource = readFileSync('src/ui/page.ts', 'utf8');

    expect(documentSource).toContain("import { renderToStaticMarkup } from 'react-dom/server'");
    expect(documentSource).toContain('renderToStaticMarkup(<LocalizedDocument');
    expect(pageSource).toContain('renderDocument(env, content, localization)');
    expect(pageSource).not.toContain('export function renderPage(');
    expect(documentSource).not.toContain('dangerouslySetInnerHTML');
    expect(documentSource).not.toContain('onChange=');
    expect(documentSource).not.toContain('onSubmit=');
  });

  it('ships the shell behavior as a hashed module with localized data configuration', () => {
    expect(assetManifest.assets['scripts.shell']).toMatch(/^\/assets\/shell-browser-[A-Za-z0-9_-]+\.js$/);
    const documentSource = readFileSync('src/ui/document.tsx', 'utf8');
    expect(documentSource).toContain("browserAssetName('scripts.shell')");
    expect(documentSource).toContain('data-messages={messages}');
  });

  it('enhances theme and fragment-preserving language selection without inline events', async () => {
    const window = new Window({ url: 'https://demo.wizardgang.ai/demos?lang=en#graphql' });
    window.document.body.innerHTML = `
      <button type="button" data-theme-toggle aria-label="Theme" aria-pressed="true">Theme</button>
      <form method="get" action="/demos" data-preserve-fragment>
        <select name="lang"><option value="en">English</option><option value="ar">العربية</option></select>
        <noscript><button type="submit">Apply</button></noscript>
      </form>
      <script type="module" data-shell-browser data-messages='{"theme":"Theme"}'></script>`;
    vi.stubGlobal('document', window.document);
    vi.stubGlobal('location', window.location);
    vi.stubGlobal('localStorage', window.localStorage);

    await import('../src/browser/shell');

    const toggle = window.document.querySelector<HTMLButtonElement>('[data-theme-toggle]')!;
    toggle.click();
    expect(window.document.documentElement.dataset.theme).toBe('light');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(window.localStorage.getItem('wg-theme')).toBe('light');

    const form = window.document.querySelector<HTMLFormElement>('form')!;
    const select = form.querySelector<HTMLSelectElement>('select')!;
    select.value = 'ar';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(form.action).toBe('https://demo.wizardgang.ai/demos#graphql');
    expect(form.querySelector('noscript button')).not.toBeNull();
  });
});
