import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import assetManifest from '../docs/asset-manifest.json';
import { routeRequest } from '../src/router';
import type { Env } from '../src/types';
import { demoDatabase } from './helpers/wg-storage';

const password = 'local-admin-password-that-must-not-render';
const environment = {
  WG_DB: demoDatabase({ crawler: 'enabled', availability: { verified: 11, operational: 10, intentional: 1 } }),
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
} as Env;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('DEMO-329 React homepage and operational pages', () => {
  it('keeps data loading in handlers and renders each migrated page from synchronous TSX', () => {
    const frontendRoutes = readFileSync('src/interfaces/route-capabilities/frontend.ts', 'utf8');
    const operationalRoutes = readFileSync('src/routing/operational-routes.ts', 'utf8');
    for (const path of ['src/ui/home.tsx', 'src/ui/admin.tsx', 'src/ui/offline.tsx', 'src/ui/not-found.tsx']) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).toContain('reactPageResponse');
      expect(source, path).not.toContain('pageResponse(');
      expect(source, path).not.toContain('localizePresentation');
    }
    expect(frontendRoutes).toContain('renderHome(env, await loadHomePageData(env))');
    expect(operationalRoutes).toContain('renderAdmin(env, demoControl, crawlerControl, notice)');
    expect(operationalRoutes).toContain('renderOffline(env, await getDemoControl(env)');
    expect(readFileSync('src/ui/home.tsx', 'utf8')).toContain('export function renderHome(');
  });

  it('preserves the protected admin boundary without rendering credentials', async () => {
    const unauthenticated = await routeRequest(new Request('https://demo.wizardgang.ai/admin'), environment);
    expect(unauthenticated.status).toBe(401);

    const authenticated = await routeRequest(new Request('https://demo.wizardgang.ai/admin', {
      headers: { authorization: `Basic ${btoa(`operator:${password}`)}`, accept: 'text/html' },
    }), environment, { adminAuthorized: true });
    const html = await authenticated.text();
    expect(authenticated.status).toBe(200);
    expect(authenticated.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(html).not.toContain(password);
    expect(html).not.toContain(btoa(`operator:${password}`));
    expect(html.match(/<script(?![^>]*src=)/g)).toHaveLength(1);
    expect(html).toContain(assetManifest.assets['scripts.admin']);
  });

  it('keeps the offline page and ordinary 404 status and crawler contracts', async () => {
    const offline = await routeRequest(new Request('https://demo.wizardgang.ai/offline', { headers: { accept: 'text/html' } }), environment);
    expect(offline.status).toBe(200);
    expect(offline.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(await offline.text()).toContain('The demo is running.');

    const missing = await routeRequest(new Request('https://demo.wizardgang.ai/not-a-registered-route', { headers: { accept: 'text/html' } }), environment);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(await missing.text()).toContain('That route does not exist.');
  });

  it('ships admin behavior as a hashed browser module and enhances preview and confirmation controls', async () => {
    expect(assetManifest.assets['scripts.admin']).toMatch(/^\/assets\/admin-browser-[A-Za-z0-9_-]+\.js$/);
    const window = new Window({ url: 'https://demo.wizardgang.ai/admin' });
    window.document.body.innerHTML = `
      <textarea id="message">Available.</textarea>
      <p data-offline-message-preview>Available.</p>
      <button data-confirm-change="Confirm this change">Change</button>
      <script type="module" data-admin-browser data-messages='{"emptyMessage":"Nothing supplied.","confirm":"Continue?"}'></script>`;
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', window.document);
    const confirm = vi.fn(() => false);
    Object.defineProperty(window, 'confirm', { configurable: true, value: confirm });

    await import('../src/browser/admin');

    const message = window.document.querySelector<HTMLTextAreaElement>('#message')!;
    const preview = window.document.querySelector<HTMLElement>('[data-offline-message-preview]')!;
    message.value = '';
    message.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(preview.textContent).toBe('Nothing supplied.');

    const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    window.document.querySelector<HTMLButtonElement>('[data-confirm-change]')!.dispatchEvent(event);
    expect(confirm).toHaveBeenCalledWith('Confirm this change');
    expect(event.defaultPrevented).toBe(true);
  });
});
