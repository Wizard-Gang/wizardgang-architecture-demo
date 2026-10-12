import { existsSync, readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import assetManifest from '../src/generated/asset-manifest.json';
import { mount as mountIdentity } from '../src/browser/identity';
import { mount as mountWebhooks } from '../src/browser/webhooks';
import { demonstrations } from '../src/demos/demos-page';
import { identitySection } from '../src/demos/identity-presentation';
import { webhooksSection } from '../src/demos/webhook-presentation';
import { bindLocalization, resolveLocalization } from '../src/i18n/runtime';
import type { Env } from '../src/types';

const env = {
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
} as Env;

function localizedEnv(locale: 'en' | 'ar'): Env {
  const request = new Request(`https://demo.wizardgang.ai/demos?lang=${locale}`);
  return bindLocalization(env, resolveLocalization(request));
}

function windowWith(body: string, url = 'https://demo.wizardgang.ai/demos'): Window {
  const window = new Window({
    url,
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  window.document.body.innerHTML = body;
  return window;
}

afterEach(() => vi.unstubAllGlobals());

describe('DEMO-336 React webhook and identity demonstrations', () => {
  it('renders both presentations through React with localized inert configuration and hashed modules', () => {
    const webhook = webhooksSection(localizedEnv('ar')).body;
    const identity = identitySection(localizedEnv('ar'), {}, 'sso').body;
    const window = windowWith(`${webhook}${identity}`);
    try {
      const webhookRoot = window.document.querySelector<HTMLElement>('[data-demo-section="webhooks"]');
      const identityRoot = window.document.querySelector<HTMLElement>('[data-demo-section="sso"]');
      expect(webhook).toContain('Webhooks موقّعة');
      expect(identity).toContain('تسجيل الدخول الموحد');
      expect(webhookRoot?.dataset.demoBrowserModule).toBe(assetManifest.assets['scripts.webhooks']);
      expect(identityRoot?.dataset.demoBrowserModule).toBe(assetManifest.assets['scripts.identity']);
      expect(webhookRoot?.querySelector('script')).toBeNull();
      expect(identityRoot?.querySelector('script')).toBeNull();
      expect(JSON.parse(webhookRoot?.dataset.config ?? '{}')).toMatchObject({
        locale: 'ar',
        messages: { evidenceUnavailable: 'دليل التسليم المتحقق منه غير متاح.' },
      });
      expect(JSON.parse(identityRoot?.dataset.config ?? '{}')).toMatchObject({
        locale: 'ar',
        messages: { authFailed: 'تعذر التحقق من المصادقة. لم تُنشأ جلسة للتطبيق.' },
      });
      expect(identity).not.toContain('provider-access-token');
      expect(identity).not.toContain('stable-subject');
    } finally {
      void window.happyDOM.close();
    }
  });

  it('keeps webhook polling, signing simulation, and refresh after shared reset root-scoped', async () => {
    const window = windowWith(webhooksSection(env).body);
    const root = window.document.querySelector<HTMLElement>('[data-demo-section="webhooks"]')!;
    const events: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input), window.location.href).pathname;
      if (path === '/api/labs/webhook-demo' && init?.method === 'POST') {
        events.push({ id: 1, receivedAt: '2026-09-20T12:00:00.000Z', eventType: 'release', provider: 'demo', action: 'published', actor: 'release-bot', repository: 'Wizard-Gang/wizardgang-architecture-demo', summary: { tag: 'v0.27.0' } });
        return new Response(JSON.stringify({ accepted: true }), { status: 202 });
      }
      if (path === '/api/labs/webhook-reset' && init?.method === 'POST') {
        events.splice(0);
        return new Response(JSON.stringify({ reset: true }));
      }
      if (path === '/api/labs/webhook-events') {
        return new Response(JSON.stringify({ events, pollingIntervalMs: 2000, repository: 'Wizard-Gang/wizardgang-architecture-demo' }));
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', window.document);
    vi.stubGlobal('fetch', fetchMock);
    try {
      await mountWebhooks(root);
      expect(root.querySelector('[data-webhook-state]')?.textContent).toBe('Connected');
      expect(root.querySelector('.webhook-empty')?.textContent).toContain('No release deliveries yet');

      root.querySelector<HTMLButtonElement>('[data-webhook-send]')?.click();
      await vi.waitFor(() => expect(root.querySelector('.webhook-event h3')?.textContent).toBe('release'));
      expect([...root.querySelectorAll<HTMLElement>('[data-webhook-stage]')].every((stage) => stage.dataset.state === 'complete')).toBe(true);
      expect(root.querySelector('.webhook-event pre')?.textContent).toContain('v0.27.0');

      events.splice(0);
      root.dispatchEvent(new window.Event('demo:reset-complete'));
      await vi.waitFor(() => expect(root.querySelector('.webhook-empty')).not.toBeNull());
      expect(fetchMock).toHaveBeenCalledWith('/api/labs/webhook-demo', expect.objectContaining({ method: 'POST' }));
      expect(root.querySelector('[data-webhook-reset]')).toBeNull();
      root.dispatchEvent(new window.Event('demo:deactivate'));
    } finally {
      await window.happyDOM.close();
    }
  });

  it('keeps provider readiness, session inspection, authorization, tabs, and sign-out behavior', async () => {
    const window = windowWith(identitySection(env, {}, 'sso').body, 'https://demo.wizardgang.ai/demos?authenticated=google#sso');
    const root = window.document.querySelector<HTMLElement>('[data-demo-section="sso"]')!;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input), window.location.href).pathname;
      if (path === '/auth/session') return new Response(JSON.stringify({
        authenticated: true,
        providers: { microsoft: { configured: true }, saml: { configured: false }, google: { configured: true }, github: { configured: false } },
        session: {
          identity: { provider: 'google', protocol: 'oidc', subject: 'stable-subject', email: 'ada@example.test', displayName: 'Ada Lovelace', assurance: 'provider-authenticated', role: 'viewer', authenticatedAt: '2026-09-20T12:00:00.000Z', expiresAt: '2026-09-20T12:30:00.000Z' },
          providerPayloadLabel: 'Validated ID token claims',
          providerPayload: { email: 'ada@example.test', email_verified: true },
          validation: [{ status: 'valid', label: 'Signature', detail: 'Verified against provider JWKS.' }],
          protocol: { name: 'Authorization Code + PKCE / OpenID Connect', steps: ['State validated', 'Session issued'] },
        },
      }));
      if (path === '/auth/authorize' && init?.method === 'POST') return new Response(JSON.stringify({ authorization: { decision: 'allow', policy: 'Authenticated identities receive demo:read.' } }));
      if (path === '/auth/logout' && init?.method === 'POST') return new Response(JSON.stringify({ authenticated: false }));
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', window.document);
    vi.stubGlobal('history', window.history);
    vi.stubGlobal('location', window.location);
    vi.stubGlobal('fetch', fetchMock);
    try {
      await mountIdentity(root);
      expect(root.querySelector('[data-identity-notice]')?.textContent).toContain('Provider authentication validated');
      expect(root.querySelector<HTMLButtonElement>('[data-identity-reset]')?.hidden).toBe(false);
      expect(root.querySelector('.identity-reset p')?.textContent).toContain('retain their own sessions');
      expect(root.querySelector<HTMLElement>('[data-identity-result]')?.hidden).toBe(false);
      expect(root.querySelector('[data-identity-name]')?.textContent).toBe('Ada Lovelace');
      expect(root.querySelector('[data-provider-payload]')?.textContent).toContain('ada@example.test');
      expect(root.querySelector('[data-config-status="microsoft"]')?.getAttribute('data-configured')).toBe('true');
      expect(root.querySelector<HTMLAnchorElement>('[data-provider-action="google"]')?.getAttribute('href')).toBe('/auth/google');

      root.querySelector<HTMLButtonElement>('[data-identity-tab="authorization"]')?.click();
      expect(root.querySelector<HTMLElement>('[data-identity-panel="authorization"]')?.hidden).toBe(false);
      root.querySelector<HTMLButtonElement>('[data-authorize="demo:read"]')?.click();
      await vi.waitFor(() => expect(root.querySelector('strong[data-decision]')?.textContent).toBe('ALLOW'));

      root.querySelector<HTMLButtonElement>('[data-identity-logout]')?.click();
      await vi.waitFor(() => expect(root.querySelector<HTMLElement>('[data-identity-result]')?.hidden).toBe(true));
      expect(root.querySelector('[data-identity-notice]')?.textContent).toBe('WizardGang application session ended.');
      expect(fetchMock).toHaveBeenCalledWith('/auth/authorize', expect.objectContaining({ method: 'POST' }));
      expect(fetchMock).toHaveBeenCalledWith('/auth/logout', expect.objectContaining({ method: 'POST' }));
    } finally {
      await window.happyDOM.close();
    }
  });

  it('keeps the not-configured state fail-closed without exposing provider actions', async () => {
    const window = windowWith(identitySection(env).body);
    const root = window.document.querySelector<HTMLElement>('[data-demo-section="oauth"]')!;
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', window.document);
    const fetchMock = vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify(
      String(input) === '/auth/logout'
        ? { authenticated: false }
        : { authenticated: false, providers: { microsoft: { configured: false }, saml: { configured: false }, google: { configured: false }, github: { configured: false } } },
    )));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await mountIdentity(root);
      expect([...root.querySelectorAll<HTMLElement>('[data-config-status]')].every((slot) => slot.dataset.configured === 'false')).toBe(true);
      expect([...root.querySelectorAll<HTMLAnchorElement>('[data-provider-action]')].every((action) => !action.hasAttribute('href') && action.getAttribute('aria-disabled') === 'true')).toBe(true);
      expect(root.querySelector<HTMLElement>('[data-identity-result]')?.hidden).toBe(true);
      expect(root.querySelector<HTMLButtonElement>('[data-identity-reset]')?.hidden).toBe(false);
      root.querySelector<HTMLButtonElement>('[data-identity-reset]')?.click();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/auth/logout', expect.objectContaining({ method: 'POST', credentials: 'same-origin' })));
    } finally {
      await window.happyDOM.close();
    }
  });

  it('updates source ownership and removes the replaced builders and retired stylesheet rule', () => {
    expect(demonstrations.find((demo) => demo.id === 'webhooks')?.sourcePath).toBe('src/demos/webhook-presentation.tsx');
    expect(demonstrations.find((demo) => demo.id === 'oauth')?.sourcePath).toBe('src/demos/identity-presentation.tsx');
    expect(existsSync('src/demos/webhook-console.ts')).toBe(false);
    expect(existsSync('src/demos/identity-page.ts')).toBe(false);
    expect(readFileSync('src/styles/demos.css', 'utf8')).not.toContain('.identity-implementation-body');
    expect(readFileSync('src/browser/webhooks.ts', 'utf8')).not.toContain('.innerHTML');
    expect(readFileSync('src/browser/identity.ts', 'utf8')).not.toContain('console.');
  });
});
