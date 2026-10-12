import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { restDemoOpenApiDocument, type RestDemoOperation } from '../src/api/rest-demo-openapi';
import { buildRestRequest, curlForRequest, mount } from '../src/browser/rest';
import { restSection } from '../src/demos/rest-presentation';
import type { Env } from '../src/types';

const origin = 'https://demo.wizardgang.ai';
const env = {
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
} as Env;

function documentWindow(): Window {
  const window = new Window({ url: `${origin}/demos#rest` });
  window.document.body.innerHTML = restSection(env).body;
  return window;
}

describe('DEMO-389 REST OpenAPI document', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders metadata, security, every tagged operation, response, and schema from the REST demo spec', async () => {
    const spec = JSON.parse(JSON.stringify(restDemoOpenApiDocument)) as {
      openapi: string;
      info: { title: string; version: string; description: string };
      servers: { url: string }[];
      tags: { name: string; description: string }[];
      security: Record<string, string[]>[];
      paths: Record<string, Record<string, RestDemoOperation | unknown>>;
      components: { securitySchemes: Record<string, { name: string }>; schemas: Record<string, { properties?: Record<string, unknown> }> };
    };
    const window = documentWindow();
    try {
      const root = window.document.querySelector('.rest-openapi')!;
      expect(root.querySelector('.rest-info')?.textContent).toContain(spec.info.title);
      expect(root.querySelector('.rest-info')?.textContent).toContain(spec.info.version);
      expect(root.querySelector('.rest-info')?.textContent).toContain(spec.info.description);
      expect(root.querySelector('.rest-info')?.textContent).toContain(spec.openapi);
      expect(root.querySelector('.rest-server')?.textContent).toContain(spec.servers[0].url);
      expect(root.querySelector('.rest-security')?.textContent).toContain(spec.components.securitySchemes.visitorSession.name);
      expect(spec.security).toEqual([{ visitorSession: [] }]);
      expect(root.querySelectorAll('.rest-tag')).toHaveLength(spec.tags.length);
      for (const tag of spec.tags) {
        const group = [...root.querySelectorAll('.rest-tag')].find((item) => item.querySelector('h3')?.textContent === tag.name);
        expect(group?.textContent).toContain(tag.description);
      }
      const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
        Object.entries(item).filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
          .map(([method, operation]) => ({ path, method, operation: operation as RestDemoOperation })));
      expect(root.querySelectorAll('.rest-operation')).toHaveLength(operations.length);
      for (const { path, method, operation } of operations) {
        const panel = root.querySelector(`[data-rest-operation-panel="${operation.operationId}"]`)!;
        expect(panel.querySelector('summary')?.textContent).toContain(method.toUpperCase());
        expect(panel.querySelector('.rest-path')?.textContent).toBe(path);
        expect(panel.querySelector('summary')?.textContent).toContain(operation.summary);
        expect(panel.textContent).toContain(operation.description);
        expect(panel.querySelector('form')?.getAttribute('data-method')).toBe(method.toUpperCase());
        for (const [status, declared] of Object.entries(operation.responses)) {
          expect(panel.querySelector('.rest-declared-responses')?.textContent).toContain(status);
          expect(panel.querySelector('.rest-declared-responses')?.textContent).toContain(declared.description);
        }
        if (operation.requestBody) expect(panel.querySelector('textarea')?.value).toBe(JSON.stringify(Object.values(operation.requestBody.content)[0].example, null, 2));
      }
      expect(root.querySelectorAll('.rest-schema')).toHaveLength(Object.keys(spec.components.schemas).length);
      for (const [name, schema] of Object.entries(spec.components.schemas)) {
        const element = root.querySelector(`#rest-schema-${name}`)!;
        expect(element.querySelectorAll('.rest-schema-properties>div')).toHaveLength(Object.keys(schema.properties || {}).length);
      }
      expect(root.querySelector('[href="/api/openapi.json"]')).not.toBeNull();
    } finally { await window.happyDOM.close(); }
  });

  it('builds edited path and JSON requests and keeps a reusable curl cookie jar', async () => {
    const window = documentWindow();
    try {
      const form = window.document.querySelector<HTMLFormElement>('[data-rest-operation-panel="replaceRecord"] form')!;
      form.querySelector<HTMLInputElement>('[data-rest-parameter]')!.value = 'changed.key';
      form.querySelector<HTMLTextAreaElement>('[data-rest-body]')!.value = JSON.stringify({ value: { message: "owner's value" } });
      const request = buildRestRequest(form, origin);
      expect(request).toEqual({
        method: 'PUT',
        url: `${origin}/api/labs/rest-demo-records/changed.key`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: { message: "owner's value" } }),
      });
      const curl = curlForRequest(request);
      expect(curl).toContain('--cookie ./wg-rest-demo.cookies --cookie-jar ./wg-rest-demo.cookies');
      expect(curl).toContain('--request PUT');
      expect(curl).toContain("--data-raw '{\"value\":{\"message\":\"owner'\\''s value\"}}'");
    } finally { await window.happyDOM.close(); }
  });

  it('executes an operation and displays request, status, duration, headers, body, and curl', async () => {
    const window = documentWindow();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [], count: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', window.document);
    vi.stubGlobal('fetch', fetchMock);
    try {
      const panel = window.document.querySelector<HTMLElement>('[data-rest-operation-panel="listRecords"]')!;
      const form = panel.querySelector<HTMLFormElement>('form')!;
      mount(window.document.querySelector<HTMLElement>('[data-demo-section="rest"]')!);
      form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(panel.querySelector('[data-rest-status]')?.textContent).toContain('200'));
      expect(fetchMock).toHaveBeenCalledWith(`${origin}/api/labs/rest-demo-records`, expect.objectContaining({ method: 'GET', credentials: 'same-origin' }));
      expect(panel.querySelector('[data-rest-request-url]')?.textContent).toBe(`${origin}/api/labs/rest-demo-records`);
      expect(panel.querySelector('[data-rest-curl]')?.textContent).toContain('--cookie-jar ./wg-rest-demo.cookies');
      expect(panel.querySelector('[data-rest-duration]')?.textContent).toMatch(/^\d+ ms$/);
      expect(panel.querySelector('[data-rest-response-headers]')?.textContent).toContain('content-type: application/json');
      expect(panel.querySelector('[data-rest-response-body]')?.textContent).toContain('"count": 0');
    } finally { await window.happyDOM.close(); }
  });
});
