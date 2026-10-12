import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import assetManifest from '../docs/asset-manifest.json';
import { routeRequest } from '../src/router';
import { routeUrl } from '../src/routing/application-routes';
import { browserAssetName } from '../src/ui/asset-map';
import type { AssetsBinding, Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

const shellStyles = readFileSync('src/styles/shell.css', 'utf8');
const demoStyles = readFileSync('src/styles/demos.css', 'utf8');

const staticAssets: AssetsBinding = {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const body = path === assetManifest.assets['styles.shell']
      ? shellStyles
      : path === assetManifest.assets['styles.demos']
        ? demoStyles
        : 'static asset';
    const contentType = path.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
    return new Response(request.method === 'HEAD' ? null : body, {
      headers: { 'content-type': contentType, etag: '"static-test"' },
    });
  },
};

function env(): Env {
  return {
    WG_DB: new SqliteD1(),
    ASSETS: staticAssets,
    GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
    GITHUB_BRANCH: 'main',
    BILLING_DEMO_MONTHLY_BUDGET_USD: '10',
  };
}

const demosPath = routeUrl('demos.index');
const shellAssetPath = routeUrl('operations.assets', { asset: browserAssetName('styles.shell') });
const demosAssetPath = routeUrl('operations.assets', { asset: browserAssetName('styles.demos') });
const shellBrowserAssetPath = routeUrl('operations.assets', { asset: browserAssetName('scripts.shell') });
const accessibilityLabAssetPaths = [
  demosAssetPath,
  routeUrl('operations.assets', { asset: browserAssetName('vendor.axe') }),
  routeUrl('operations.assets', { asset: browserAssetName('scripts.accessibilityLab') }),
];
const publicPaths = [
  routeUrl('interfaces.frontend.index'),
  demosPath,
] as const;

describe('DEMO-327 Workers Static Assets stylesheet delivery', () => {
  it('pins deterministic content-hashed stylesheet names in the committed asset map', () => {
    expect(assetManifest.assets['styles.shell']).toMatch(/^\/assets\/shell-[A-Za-z0-9_-]+\.css$/);
    expect(assetManifest.assets['styles.demos']).toMatch(/^\/assets\/demos-[A-Za-z0-9_-]+\.css$/);
    expect(shellStyles).toContain('.site-header');
    expect(shellStyles).not.toContain('.d1-page-header');
    expect(demoStyles).not.toContain('.d1-page-header');
    expect(shellStyles).toContain('--violet: #a98fff');
    expect(shellStyles).toContain('--cyan: #005a6d');
  });

  it('serves built styles through the registered asset route with immutable caching and security headers', async () => {
    const get = await routeRequest(new Request(`https://demo.wizardgang.ai${shellAssetPath}`), env());
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(get.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(get.headers.get('x-content-type-options')).toBe('nosniff');
    expect(get.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(get.headers.get('etag')).toBe('"static-test"');
    expect(await get.text()).toBe(shellStyles);

    const head = await routeRequest(new Request(`https://demo.wizardgang.ai${shellAssetPath}`, { method: 'HEAD' }), env());
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('allows only the sandboxed accessibility lab dependencies to load from its opaque origin', async () => {
    for (const path of accessibilityLabAssetPaths) {
      const response = await routeRequest(new Request(`https://demo.wizardgang.ai${path}`), env());
      expect(response.status, path).toBe(200);
      expect(response.headers.get('access-control-allow-origin'), path).toBe('*');
      expect(response.headers.get('cross-origin-resource-policy'), path).toBe('cross-origin');
    }
  });

  it('uses render-blocking external stylesheets and retires inline style delivery', async () => {
    for (const path of publicPaths) {
      const response = await routeRequest(new Request(`https://demo.wizardgang.ai${path}`, { headers: { accept: 'text/html' } }), env());
      const html = await response.text();
      expect(response.status, path).toBe(200);
      expect(html, path).toContain(`<link rel="stylesheet" href="${shellAssetPath}"/>`);
      expect(html, path).not.toContain('<style');
      expect(html, path).toContain(`<script type="module" src="${shellBrowserAssetPath}"`);
      if (path === demosPath) expect(html).toContain(`<link rel="stylesheet" href="${demosAssetPath}"/>`);
      else expect(html).not.toContain(`<link rel="stylesheet" href="${demosAssetPath}"/>`);
    }
  });
});
