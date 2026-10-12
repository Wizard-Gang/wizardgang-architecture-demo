import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { accessibilitySection } from '../src/demos/accessibility-page';
import { d1Section } from '../src/demos/d1-presentation';
import { i18nSection } from '../src/demos/i18n-presentation';
import { r2Section } from '../src/demos/r2-presentation';
import {
  bindLocalization,
  localeNormalizationRedirect,
  resolveLocalization,
} from '../src/i18n/runtime';
import { routeRequest } from '../src/router';
import { routeUrl } from '../src/routing/application-routes';
import { accessibilityLabResponse } from '../src/ui/accessibility-lab';
import { browserAssetPath } from '../src/ui/asset-map';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

const shellStyles = readFileSync('src/styles/shell.css', 'utf8');

const env = {
  WG_DB: new SqliteD1(),
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
} as unknown as Env;

function localized(url: string, headers: HeadersInit = {}): { request: Request; env: Env } {
  const request = new Request(url, { headers });
  return { request, env: bindLocalization(env, resolveLocalization(request)) };
}

async function demosShell(url: string, environment: Env = env): Promise<string> {
  const response = await routeRequest(new Request(url, { headers: { accept: 'text/html' } }), environment);
  expect(response.status).toBe(200);
  return response.text();
}

describe('D1 database console', () => {
  it('leads with table navigation and progressively discloses relational CRUD controls', async () => {
    const html = d1Section(env).body;
    expect(html).not.toContain('aria-label="Breadcrumb"');
    expect(html).toContain('Cloudflare D1 Database');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('Users <bdi dir="ltr"><strong data-count="users">—</strong> / 10</bdi>');
    expect(html).toContain('Tasks <bdi dir="ltr"><strong data-count="tasks">—</strong> / 25</bdi>');
    expect(html).toContain('data-form="users" hidden');
    expect(html).toContain('data-form="tasks" hidden');
    expect(html).toContain('SQL Inspector');
    expect(html).not.toContain('Tasks belong to users');
    expect(html).not.toContain('Query these users with GraphQL');
    expect(html).not.toContain('Parameters');
    expect(html).not.toContain('sessionId');
    expect(html).not.toContain('WG_DB');
    expect(html).not.toContain('d1-inspector-footer');
    expect(html).not.toContain('Implementation details');
    expect(html).not.toContain('Platform / /d1');
    expect(html).not.toContain('laboratory');
    expect(html).not.toContain('data-refresh');
  });

  it('surfaces API failures and confirms relational and reset behavior', async () => {
    const html = d1Section(env).body;
    const browser = readFileSync('src/browser/d1.ts', 'utf8');
    expect(browser).toContain("email_already_exists: message('emailAlreadyExists', 'That email already exists.')");
    expect(browser).toContain("user_limit_reached: message('userLimitReached', 'This sandbox has reached its 10-user limit.')");
    expect(browser).toContain("task_limit_reached: message('taskLimitReached', 'This sandbox has reached its 25-task limit.')");
    expect(browser).toContain("message('assignedTasksWill', 'assigned tasks will become Unassigned.')");
    expect(html).toContain('data-confirm-dialog');
    expect(browser).toContain("root.addEventListener('demo:reset-complete'");
    expect(browser).toContain('const confirmButton = event.currentTarget as HTMLButtonElement;');
    expect(browser).not.toContain('event.currentTarget.disabled');
    expect(browser).not.toContain('catch (_) {}');
  });
});

describe('R2 storage workspace', () => {
  it('leads with the sandbox workflow and progressively discloses technical evidence', async () => {
    const html = r2Section(env).body;
    const browser = readFileSync('src/browser/r2.ts', 'utf8');
    expect(html).not.toContain('aria-label="Breadcrumb"');
    expect(html).toContain('Cloudflare R2 Storage');
    expect(html).toContain('Your R2 sandbox');
    expect(html).toContain('Drop a file here');
    expect(html).toMatch(/data-upload-button=""[^>]*disabled=""/);
    expect(html).toContain('data-operation-status');
    expect(html).toContain('View response JSON');
    expect(html).not.toContain('Storage details');
    expect(html).not.toContain('WG_R2');
    expect(html).not.toContain('wizardgang-demo-r2');
    expect(html).not.toContain('2 visible');
    expect(html).not.toContain('How this works');
    expect(html).not.toContain('One request, two stores');
    expect(html).not.toContain('data-count');
    expect(browser).toContain('download.dataset.downloadId = file.id');
    expect(browser).toContain("'file-preview file-preview-text'");
    expect(browser).toContain("'file-preview file-preview-image'");
    expect(html).not.toContain('Implementation details');
    expect(html).not.toContain('Platform / /r2');
    expect(html).not.toContain('Latest R2 operation');
  });

  it('validates uploads and uses inline confirmation with surfaced operation errors', async () => {
    const html = r2Section(env).body;
    const browser = readFileSync('src/browser/r2.ts', 'utf8');
    expect(browser).toContain('state.selectedFile.size > MAX_FILE_BYTES');
    expect(browser).toContain('File exceeds the 5 MiB limit.');
    expect(browser).toContain('data-confirm-delete');
    expect(html).not.toContain('data-confirm-reset');
    expect(browser).toContain('Upload failed — try again.');
    expect(browser).not.toContain("confirm('Delete this R2 object?')");
    expect(browser).not.toContain('catch (_) {}');
  });
});

describe('internationalized interface', () => {
  it('renders Arabic from the shared application context with matching lang and RTL direction', async () => {
    const context = localized('https://demo.example/interfaces/i18n?lang=ar&count=3');
    const html = `${await demosShell('https://demo.wizardgang.ai/demos?lang=ar&count=3', context.env)}${i18nSection(context.request, context.env).body}`;
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('التدويل في الواجهة');
    expect(html).toContain('src/i18n/locales/ar.json');
    expect(html).toContain('<code data-direction="">rtl</code>');
    expect(html).toContain('src/i18n/runtime.ts');
    expect(html).toContain('انتقل إلى المحتوى الرئيسي');
  });

  it('falls back to English and normalizes unsupported locale input without losing other state', () => {
    const request = new Request('https://demo.example/interfaces/i18n?lang=xx&count=7');
    expect(resolveLocalization(request).locale).toBe('en');
    expect(localeNormalizationRedirect(request)).toBe('https://demo.example/interfaces/i18n?count=7');
  });

  it('keeps six synchronized resources while the demonstration defers language changes to the global control', async () => {
    const context = localized('https://demo.example/interfaces/i18n?lang=ja&count=7');
    const html = `${await demosShell('https://demo.wizardgang.ai/demos?lang=ja&count=7', context.env)}${i18nSection(context.request, context.env).body}`;
    expect(html).toContain('<html lang="ja" dir="ltr">');
    expect(html).toContain('<input type="hidden" name="lang" value="ja"/>');
    expect(html).toContain('グローバルヘッダーの言語コントロール');
    expect(html).not.toContain('id="locale-demo"');
    expect(html).toContain('data-inspect-target="Intl.NumberFormat.currency"');
    expect(html).toContain('グローバルコンテキスト検査');
    expect(html).toContain('items_other');
    expect(html).not.toContain('history.replaceState');
  });
});

describe('global localization and accessibility runtime', () => {
  it('makes the ordinary application shell English and accessible by default', async () => {
    const html = await demosShell('https://demo.wizardgang.ai/demos');
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('<a class="skip-link" href="#main">Skip to main content</a>');
    expect(html).toContain('<main class="site-main" id="main">');
    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toContain('class="language-selector"');
    expect(html).toContain('id="global-language" name="lang"');
    expect(html).toContain('data-theme-toggle="" aria-label="Theme" aria-pressed="true"><span class="utility-label">Theme</span><span class="utility-icon" aria-hidden="true">◐</span></button>');
    expect(html).toContain('<a href="/demos" aria-current="page">Demos</a>');
  });

  it('localizes shell-owned strings and preserves unrelated state on an ordinary RTL page', async () => {
    const context = localized('https://demo.example/demos?lang=ar&filter=recent');
    const html = await demosShell('https://demo.wizardgang.ai/demos?lang=ar&filter=recent', context.env);
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('aria-label="التنقل الرئيسي"');
    expect(html).toContain('>العروض التوضيحية</a>');
    expect(html).toContain('انتقل إلى المحتوى الرئيسي');
    expect(html).toContain('name="filter" value="recent"');
    expect(html).toContain('<option value="ar" aria-label="العربية" selected="">AR</option>');
    expect(html).toContain('data-theme-toggle="" aria-label="السمة" aria-pressed="true"><span class="utility-label">السمة</span><span class="utility-icon" aria-hidden="true">◐</span></button>');
    expect(html).toContain('href="/demos?lang=ar"');
  });

  it('uses explicit query, persisted preference, then configured default with clean default URLs', () => {
    const explicit = resolveLocalization(new Request('https://demo.example/operations?lang=ar'));
    expect(explicit.locale).toBe('ar');
    const demosRoute = routeUrl('demos.index');
    expect(explicit.href(`${demosRoute}?sample=one`)).toBe(`${demosRoute}?sample=one&lang=ar`);

    const persisted = resolveLocalization(new Request('https://demo.example/operations', {
      headers: { cookie: 'other=value; wg-lang=ja' },
    }));
    expect(persisted.locale).toBe('ja');

    const defaultRequest = new Request('https://demo.example/operations?lang=en&window=24h');
    expect(resolveLocalization(defaultRequest).locale).toBe('en');
    expect(localeNormalizationRedirect(defaultRequest)).toBe('https://demo.example/operations?window=24h');
  });

  it('ships reduced-motion, forced-colors, and logical-direction shared CSS', () => {
    expect(shellStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(shellStyles).toContain('@media (forced-colors: active)');
    expect(shellStyles).toContain('scroll-behavior: auto !important');
    expect(shellStyles).toContain('padding-inline');
    expect(shellStyles).toContain('max-inline-size');
    expect(shellStyles).toContain('margin-inline-start');
    expect(shellStyles).toContain('inset-inline-start');
  });
});

describe('accessible interaction surface', () => {
  it('pairs one accessible interaction with inert criterion-level failure analysis', async () => {
    const html = `${await demosShell('https://demo.wizardgang.ai/demos')}${accessibilitySection(new Request('https://demo.example/accessibility'), env).body}`;
    expect(html.match(/class="skip-link"/g)).toHaveLength(1);
    expect(html).toContain('sandbox="allow-scripts allow-forms"');
    expect(html.indexOf('How to run')).toBeLessThan(html.indexOf('data-a11y-frame'));
    expect(html).toContain('data-run-a11y-scan=""');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html.match(/class="criterion-card"/g)).toHaveLength(12);
    expect(html.match(/<details class="criterion-card"/g)).toHaveLength(12);
    expect(html).not.toContain('data-a11y-mode');
    expect(html).not.toContain('data-broken-warning');
    expect(html.match(/<th scope="row">/g)).toHaveLength(12);
    expect(html).toContain('<th scope="col">Working behavior</th>');
    expect(html).toContain('<th scope="col">Failure fixture</th>');
    expect(html).toContain('<th scope="col">How we verify it</th>');
    expect(html).toContain('&lt;input type=&quot;password&quot; onpaste=&quot;return false&quot;&gt;');
    expect(html).not.toMatch(/<input\b[^>]*\bonpaste=/i);
    expect(html).toContain('axe-core / partial coverage');
    expect(html).toContain('The inert failure fixtures were not scanned.');
    expect(html).toContain('WCAG 2.2 engineering evidence — no conformance claim');
  });

  it('ships deterministic accessible and broken frame variants with local axe execution', async () => {
    const accessibleResponse = accessibilityLabResponse(new Request('https://demo.example/api/labs/accessibility?mode=accessible'));
    expect(accessibleResponse.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    expect(accessibleResponse.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    const accessible = await accessibleResponse.text();
    expect(accessible).toContain('<html lang="en">');
    expect(accessible).toContain('<label for="email">');
    expect(accessible).toContain('role="dialog" aria-modal="true"');
    expect(accessible).toContain(`src="${browserAssetPath('vendor.axe')}"`);
    expect(accessible).toContain('data-accessibility-lab=""');
    const labBrowser = readFileSync('src/browser/accessibility-lab.ts', 'utf8');
    expect(labBrowser).toContain('axe.run(document');
    expect(labBrowser).toContain("type: 'wg-accessibility-report'");
    expect(labBrowser).not.toContain('if (parent === window) scan()');

    const broken = await accessibilityLabResponse(new Request('https://demo.example/api/labs/accessibility?mode=broken')).text();
    expect(broken).toContain('data-fixture-signatures');
    expect(broken).toContain('&lt;html&gt;&lt;head&gt;');
    expect(broken).toContain('onpaste=&quot;return false&quot;');
    expect(broken).toContain('outline:none!important');
    expect(broken).toContain('&lt;img class=&quot;product&quot; src=');
  });
});

describe('right-to-left layout safety', () => {
  it('never parks off-screen affordances on the inline axis', () => {
    // A large negative left/right offset extends the document's scrollable width.
    // Under dir="rtl" the scroll origin sits at the opposite edge, so the reader
    // lands on that empty canvas and the page looks blank. Hide vertically instead.
    expect(shellStyles).not.toMatch(/\b(left|right)\s*:\s*-\d{3,}px/);
  });

  it('defines both themes from the same token set', () => {
    expect(shellStyles).toContain(':root[data-theme="light"]');
    for (const token of ['--ink', '--paper', '--acid', '--violet', '--line', '--focus']) {
      expect(shellStyles.match(new RegExp(`${token}:`, 'g'))?.length, token).toBeGreaterThanOrEqual(2);
    }
  });
});
