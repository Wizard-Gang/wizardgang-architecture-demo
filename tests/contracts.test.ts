import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { routeRequest } from '../src/router';
import { applicationRouteRegistry } from '../src/routing/application-routes';
import type { Env } from '../src/types';
import { retiredApiReferencePrefixes } from './fixtures/removed-api-pathnames';
import { SqliteD1 } from './helpers/wg-storage';

const env = {
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
  WG_DB: new SqliteD1(),
} as unknown as Env;

type OpenApiOperation = {
  parameters?: Array<{ name?: string }>;
  responses?: Record<string, unknown>;
  'x-route-id'?: string;
};

type OpenApiDocument = {
  openapi: string;
  info: { description: string };
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    schemas: Record<string, unknown>;
  };
};

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);

function readOpenApi(): OpenApiDocument {
  return JSON.parse(readFileSync('contracts/openapi/openapi.json', 'utf8')) as OpenApiDocument;
}

function documentedRegistryPattern(openapi: OpenApiDocument, path: string): string {
  const basePath = new URL(openapi.servers[0].url).pathname.replace(/\/$/, '');
  return `${basePath}${path}`.replace(/\{([^}]+)\}/g, ':$1').replace(/\/+/g, '/');
}

describe('executable interface contracts', () => {
  it('maps every documented OpenAPI operation directly to the application route registry', () => {
    const openapi = readOpenApi();
    expect(openapi.openapi).toBe('3.1.0');
    expect(openapi.info.description).toContain('bearer-capable machine API');
    expect(openapi.info.description).toContain('/api/labs/rest-demo-openapi.json');
    expect(new URL(openapi.servers[0].url).pathname).toBe('/');

    for (const [path, pathItem] of Object.entries(openapi.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method.toLowerCase())) continue;
        const routeId = operation['x-route-id'];
        expect(routeId, `${method.toUpperCase()} ${path} must declare x-route-id`).toBeTruthy();
        const route = applicationRouteRegistry.declarations.find((candidate) => candidate.id === routeId);
        expect(route, `${method.toUpperCase()} ${path} must reference a registered route ID`).toBeDefined();
        expect(route?.pattern, `${routeId} must own the documented path`).toBe(documentedRegistryPattern(openapi, path));
        expect(route?.methods, `${routeId} must own ${method.toUpperCase()}`).toContain(method.toUpperCase());
      }
    }
  });

  it('documents the operations API family', () => {
    const openapi = readOpenApi();
    for (const path of [
      '/api/operations/health',
      '/api/operations/version',
      '/api/operations/logs',
      '/api/operations/budget',
      '/api/openapi.json',
    ]) expect(openapi.paths[path]).toBeDefined();

    for (const path of Object.keys(openapi.paths)) {
      expect(path.startsWith(`${retiredApiReferencePrefixes[1]}/operations`)).toBe(false);
      expect(path).not.toBe(retiredApiReferencePrefixes[2]);
      expect(path).not.toBe(retiredApiReferencePrefixes[3]);
      expect(path).not.toBe('/api/operations/usage');
    }
  });

  it('serves the current OpenAPI contract through the router', async () => {
    const openapi = await routeRequest(new Request('https://demo.wizardgang.ai/api/openapi.json'), env);
    expect(openapi.status).toBe(200);
    expect(openapi.headers.get('content-type')).toContain('application/json');
    const document = await openapi.json() as { openapi: string; paths: Record<string, unknown> };
    expect(document.openapi).toBe('3.1.0');
    expect(document.paths).toHaveProperty('/api/operations/health');
  });
});
