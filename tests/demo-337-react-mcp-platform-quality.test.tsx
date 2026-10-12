import { existsSync, readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import assetManifest from '../src/generated/asset-manifest.json';
import { mount as mountAccessibility } from '../src/browser/accessibility';
import { mount as mountDurableObjects } from '../src/browser/durable-objects';
import { mount as mountEdge } from '../src/browser/edge';
import { mount as mountI18n } from '../src/browser/i18n';
import { mount as mountMcp } from '../src/browser/mcp';
import { mount as mountWorkers } from '../src/browser/workers';
import {
  accessibilitySection,
  durableObjectsSection,
  edgeSection,
  i18nSection,
  mcpSection,
  workersSection,
} from '../src/demos/composable-presentations';
import { demonstrations } from '../src/demos/demos-page';
import { bindLocalization, resolveLocalization } from '../src/i18n/runtime';
import type { Env } from '../src/types';
import { accessibilityLabResponse } from '../src/ui/accessibility-lab';

const env = {
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
} as Env;

function localizedEnv(locale: 'en' | 'ar'): Env {
  const request = new Request(`https://demo.wizardgang.ai/demos?lang=${locale}&count=3`);
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

function root(window: Window, name: string): HTMLElement {
  const target = window.document.querySelector<HTMLElement>(`[data-demo-section="${name}"]`);
  if (!target) throw new Error(`Missing ${name} root`);
  return target;
}

afterEach(() => vi.unstubAllGlobals());

describe('DEMO-337 React MCP, platform, and quality demonstrations', () => {
  it('renders all six localized presentations through React with hashed browser modules', () => {
    const localized = localizedEnv('ar');
    const request = new Request('https://demo.wizardgang.ai/api/demos/i18n?lang=ar&count=3');
    const sections = [
      mcpSection(request, localized),
      edgeSection(localized),
      workersSection(localized),
      durableObjectsSection(localized),
      accessibilitySection(request, localized),
      i18nSection(request, localized),
    ];
    const window = windowWith(sections.map((section) => section.body).join(''));
    try {
      const expectedModules = {
        mcp: assetManifest.assets['scripts.mcp'],
        edge: assetManifest.assets['scripts.edge'],
        workers: assetManifest.assets['scripts.workers'],
        'durable-objects': assetManifest.assets['scripts.durableObjects'],
        accessibility: assetManifest.assets['scripts.accessibility'],
        i18n: assetManifest.assets['scripts.i18n'],
      } as const;
      for (const [name, moduleName] of Object.entries(expectedModules)) {
        const sectionRoot = root(window, name);
        expect(sectionRoot.dataset.demoBrowserModule, name).toBe(moduleName);
        expect(sectionRoot.querySelector('script'), name).toBeNull();
        expect(JSON.parse(sectionRoot.dataset.config ?? '{}'), name).toMatchObject({ locale: 'ar' });
      }
      expect(sections[0].body).toContain('Model Context Protocol');
      expect(sections[5].body).toContain('التدويل في الواجهة');
    } finally {
      void window.happyDOM.close();
    }
  });

  it('keeps the MCP ping and endpoint-copy interactions root-scoped', async () => {
    const presentation = mcpSection(new Request('https://demo.wizardgang.ai/api/demos/mcp'), env).body;
    const window = windowWith(presentation);
    const presentationRoot = root(window, 'mcp');
    const clipboard = { writeText: vi.fn(async () => undefined) };
    const fetchMock = vi.fn(async () => new Response('event: message\ndata: {"result":{"content":[{"type":"text","text":"pong"}]}}\n\n', { status: 200, statusText: 'OK' }));
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', window.document);
    vi.stubGlobal('navigator', { clipboard });
    vi.stubGlobal('fetch', fetchMock);
    try {
      mountMcp(presentationRoot);
      presentationRoot.querySelector<HTMLButtonElement>('[data-mcp-run]')?.click();
      await vi.waitFor(() => expect(presentationRoot.querySelector('[data-mcp-output]')?.textContent).toContain('pong'));
      expect(fetchMock).toHaveBeenCalledWith('/mcp', expect.objectContaining({ method: 'POST' }));
      const requestBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body));
      expect(requestBody).toMatchObject({ method: 'tools/call', params: { name: 'ping' } });

      presentationRoot.querySelector<HTMLButtonElement>('[data-copy-value]')?.click();
      await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('https://demo.wizardgang.ai/mcp'));
      expect(presentationRoot.querySelector('[data-copy-status]')?.textContent).toBe('Endpoint copied.');
    } finally {
      await window.happyDOM.close();
    }
  });

  it('keeps Edge, Workers, and Durable Objects API behavior in scoped modules', async () => {
    const window = windowWith(`${edgeSection(env).body}${workersSection(env).body}${durableObjectsSection(env).body}`);
    let counter = 4;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input), window.location.href).pathname;
      if (path === '/api/labs/edge') return Response.json({
        request: { method: 'GET', protocol: 'https:', host: 'demo.wizardgang.ai', accepts: 'text/html' },
        edge: { colo: 'IAD', country: 'US' },
        delivery: { cacheControl: 'no-store' },
      });
      if (path === '/api/labs/workers') return Response.json({ decision: { cache: 'public', route: 'asset', originRequired: false }, reason: 'Public static asset.' });
      if (path === '/api/labs/durable-counter' && init?.method === 'POST') return Response.json({ counter: ++counter });
      if (path === '/api/labs/durable-counter') return Response.json({ counter });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', window.document);
    vi.stubGlobal('FormData', window.FormData);
    vi.stubGlobal('fetch', fetchMock);
    try {
      const edgeRoot = root(window, 'edge');
      const workersRoot = root(window, 'workers');
      const durableRoot = root(window, 'durable-objects');
      mountEdge(edgeRoot);
      mountWorkers(workersRoot);
      await mountDurableObjects(durableRoot);

      edgeRoot.querySelector<HTMLButtonElement>('[data-edge-run]')?.click();
      await vi.waitFor(() => expect(edgeRoot.querySelector('[data-edge-derived]')?.textContent).toContain('IAD'));

      workersRoot.querySelector<HTMLFormElement>('[data-worker-policy]')?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(workersRoot.querySelector('[data-worker-cacheable]')?.textContent).toBe('YES'));
      expect(workersRoot.querySelector<HTMLElement>('[data-worker-result]')?.hidden).toBe(false);

      expect(durableRoot.querySelector('[data-durable-current]')?.textContent).toBe('Current count 4');
      durableRoot.querySelector<HTMLButtonElement>('[data-durable-run="1"]')?.click();
      await vi.waitFor(() => expect(durableRoot.querySelector('[data-durable-final]')?.textContent).toBe('5'));
      expect(durableRoot.querySelector('[data-durable-success]')?.textContent).toBe('1 / 1');
    } finally {
      await window.happyDOM.close();
    }
  });

  it('keeps accessibility reporting, i18n inspection, and inert failure frames intact', async () => {
    const request = new Request('https://demo.wizardgang.ai/api/demos/i18n?count=3');
    const window = windowWith(`${accessibilitySection(request, env).body}${i18nSection(request, env).body}`);
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', window.document);
    try {
      const accessibilityRoot = root(window, 'accessibility');
      const i18nRoot = root(window, 'i18n');
      mountAccessibility(accessibilityRoot);
      mountI18n(i18nRoot);
      const frame = accessibilityRoot.querySelector<HTMLIFrameElement>('[data-a11y-frame]');
      expect(frame?.getAttribute('srcdoc')).toBeNull();
      expect(frame?.getAttribute('src')).toBe('/api/labs/accessibility?mode=accessible');
      expect(accessibilityRoot.querySelector('[data-scan-state]')?.textContent).toBe('Waiting');
      expect(accessibilityRoot.querySelector<HTMLButtonElement>('[data-run-a11y-scan]')?.disabled).toBe(true);

      i18nRoot.querySelector<HTMLButtonElement>('[data-inspect-target="card.title"]')?.click();
      expect(i18nRoot.querySelector('[data-resource-excerpt]')?.textContent).toContain('Ship a dependable edge service');

      const accessible = await accessibilityLabResponse(new Request('https://demo.wizardgang.ai/api/labs/accessibility?mode=accessible')).text();
      const broken = await accessibilityLabResponse(new Request('https://demo.wizardgang.ai/api/labs/accessibility?mode=broken')).text();
      expect(accessible).toContain(`src="${assetManifest.assets['scripts.accessibilityLab']}"`);
      expect(broken).toContain('does not expose intentionally inaccessible controls');
      expect(broken).toContain('&lt;input name=&quot;password&quot; type=&quot;password&quot; onpaste=&quot;return false&quot;&gt;');
      expect(broken).not.toMatch(/<input\b[^>]*\bonpaste=/i);
    } finally {
      await window.happyDOM.close();
    }
  });

  it('removes every legacy string presentation and localization path', () => {
    const sources = Object.fromEntries([
      'src/ui/demo-section.ts',
      'src/ui/page.ts',
      'src/browser/demo-presentation.ts',
    ].map((path) => [path, readFileSync(path, 'utf8')]));
    expect(sources['src/ui/demo-section.ts']).not.toContain('namespaceIds');
    expect(sources['src/ui/demo-section.ts']).not.toContain('createDemoSection');
    expect(sources['src/ui/page.ts']).not.toContain('function pageContent(');
    expect(sources['src/browser/demo-presentation.ts']).not.toContain('executeLegacyScripts');
    expect(existsSync('src/i18n/presentation.ts')).toBe(false);
    for (const path of [
      'src/demos/mcp-curated.ts',
      'src/demos/edge.ts',
      'src/demos/workers.ts',
      'src/demos/durable-objects.ts',
      'src/demos/i18n-page.ts',
      'src/ui/accessibility-lab.ts',
    ]) expect(existsSync(path), path).toBe(false);
    expect(demonstrations.find((demo) => demo.id === 'mcp')?.sourcePath).toBe('src/demos/mcp-presentation.tsx');
    expect(demonstrations.find((demo) => demo.id === 'i18n')?.sourcePath).toBe('src/demos/i18n-presentation.tsx');
  });
});
