import { existsSync, readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import assetManifest from '../src/generated/asset-manifest.json';
import { demonstrations } from '../src/demos/demos-page';
import { routeRequest } from '../src/router';
import { applicationRouteRegistry } from '../src/routing/application-routes';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

const env = {
  WG_DB: new SqliteD1(),
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
} as Env;

async function presentation(id: 'd1' | 'r2', locale = 'en') {
  const response = await routeRequest(new Request(`https://demo.wizardgang.ai/api/demos/${id}?lang=${locale}`, {
    headers: { accept: 'text/html' },
  }), env);
  expect(response.status).toBe(200);
  const html = await response.text();
  const window = new Window({ url: `https://demo.wizardgang.ai/api/demos/${id}?lang=${locale}` });
  window.document.body.innerHTML = html;
  return { html, window, root: window.document.querySelector<HTMLElement>('[data-demo-section]') };
}

describe('DEMO-334 React D1 and R2 demonstrations', () => {
  it('renders both scoped fragments from React with hashed mount modules and localized data messages', async () => {
    const d1 = await presentation('d1', 'ar');
    const r2 = await presentation('r2', 'ar');

    try {
      expect(d1.html).toContain('قاعدة بيانات Cloudflare D1');
      expect(r2.html).toContain('تخزين Cloudflare R2');
      expect(r2.html).toContain('رفع ملف');
      expect(d1.root?.dataset.demoBrowserModule).toBe(assetManifest.assets['scripts.d1']);
      expect(r2.root?.dataset.demoBrowserModule).toBe(assetManifest.assets['scripts.r2']);
      expect(d1.root?.querySelector('script')).toBeNull();
      expect(r2.root?.querySelector('script')).toBeNull();

      const d1Config = JSON.parse(d1.root?.dataset.config ?? '{}') as { locale?: string; messages?: Record<string, string> };
      const r2Config = JSON.parse(r2.root?.dataset.config ?? '{}') as { locale?: string; messages?: Record<string, string> };
      expect(d1Config).toMatchObject({ locale: 'ar', messages: { runningQuery: 'جارٍ تنفيذ الاستعلام…' } });
      expect(r2Config).toMatchObject({ locale: 'ar', messages: { uploadFailed: 'فشل الرفع — حاول مرة أخرى.' } });
    } finally {
      await d1.window.happyDOM.close();
      await r2.window.happyDOM.close();
    }
  });

  it('keeps D1 requests, tabs, SQL/response inspection, reset, and root-scoped DOM construction', async () => {
    const rendered = await presentation('d1');
    const browser = readFileSync('src/browser/d1.ts', 'utf8');
    try {
      expect(rendered.html).toContain('role="tablist"');
      expect(rendered.html).toContain('data-inspector-sql');
      expect(rendered.html).toContain('data-state-output');
      expect(rendered.html).not.toContain('data-reset=""');
      expect(browser).toContain("await load('users'");
      expect(browser).toContain("await load('tasks'");
      expect(browser).toContain("method: id ? 'PATCH' : 'POST'");
      expect(browser).toContain("{ method: 'DELETE' }");
      expect(browser).toContain("root.addEventListener('demo:reset-complete'");
      expect(browser).toContain('root.querySelectorAll');
      expect(browser).not.toContain('.innerHTML');
      expect(browser).not.toContain('document.querySelector(');
    } finally {
      await rendered.window.happyDOM.close();
    }
  });

  it('keeps R2 list/upload/preview/download/delete/reset requests and safe DOM construction', async () => {
    const rendered = await presentation('r2');
    const browser = readFileSync('src/browser/r2.ts', 'utf8');
    try {
      expect(rendered.html).toContain('data-upload-form');
      expect(rendered.html).toContain('data-r2-output');
      expect(rendered.html).not.toContain('data-confirm-reset');
      expect(browser).toContain("call('/api/labs/r2-files', {}, 'LIST'");
      expect(browser).toContain("call('/api/labs/r2-files', { method: 'POST', body }, 'PUT'");
      expect(browser).toContain("{ method: 'DELETE' }, 'DELETE'");
      expect(browser).toContain("root.addEventListener('demo:reset-complete'");
      expect(browser).toContain("file.contentType === 'text/plain'");
      expect(browser).toContain("file.contentType === 'image/svg+xml'");
      expect(browser).toContain('root.querySelector');
      expect(browser).not.toContain('.innerHTML');
      expect(browser).not.toContain('document.querySelector(');
    } finally {
      await rendered.window.happyDOM.close();
    }
  });

  it('updates public source ownership and removes the legacy string modules and retired rules', () => {
    expect(demonstrations.find((demo) => demo.id === 'd1')?.sourcePath).toBe('src/demos/d1-presentation.tsx');
    expect(demonstrations.find((demo) => demo.id === 'r2')?.sourcePath).toBe('src/demos/r2-presentation.tsx');
    const route = applicationRouteRegistry.declarations.find((candidate) => candidate.id === 'demos.presentation');
    expect(route?.source).toMatchObject({
      module: 'src/demos/demo-presentations.ts',
      exportName: 'demoPresentationResponse',
    });
    expect(existsSync('src/demos/d1-page.ts')).toBe(false);
    expect(existsSync('src/demos/r2-page.ts')).toBe(false);
    const styles = readFileSync('src/styles/demos.css', 'utf8');
    expect(styles).not.toContain('.d1-page-header');
    expect(styles).not.toContain('.d1-implementation-body');
    expect(styles).not.toContain('.r2-implementation');
  });
});
