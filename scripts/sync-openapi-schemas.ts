import fs from 'node:fs';
import path from 'node:path';
import { restDemoOpenApiDocument } from '../src/api/rest-demo-openapi.ts';

const root = process.cwd();
const openApiPath = path.join(root, 'contracts', 'openapi', 'openapi.json');

const openApi = JSON.parse(fs.readFileSync(openApiPath, 'utf8'));

if (!openApi.components || typeof openApi.components !== 'object') {
  throw new Error('OpenAPI components are required before generated paths can be synchronized.');
}

// The REST demo page renders restDemoOpenApiDocument; its records operations are published only through this document.
const REST_DEMO_ROUTE_IDS = {
  '/api/labs/rest-demo-records': 'platform.d1.rest-demo-records',
  '/api/labs/rest-demo-records/{id}': 'platform.d1.rest-demo-record',
};
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

function restDemoPaths() {
  const security = restDemoOpenApiDocument.security;
  return Object.fromEntries(Object.entries(structuredClone(restDemoOpenApiDocument.paths)).map(([currentPath, pathItem]) => {
    const routeId = REST_DEMO_ROUTE_IDS[currentPath];
    if (!routeId) throw new Error(`REST demo path ${currentPath} has no registered route ID.`);
    for (const method of HTTP_METHODS) {
      if (pathItem[method]) pathItem[method] = { ...pathItem[method], 'x-route-id': routeId, security };
    }
    return [currentPath, pathItem];
  }));
}

const jsonObjectResponse = (description, schema = { type: 'object' }) => ({
  description,
  content: {
    'application/json': { schema },
  },
});

function operationsPaths() {
  return {
    '/api/operations/health': {
      get: {
        summary: 'Read runtime and dependency health',
        'x-route-id': 'operations.health',
        responses: { '200': jsonObjectResponse('Current health state.'), '503': jsonObjectResponse('A required dependency is unhealthy.') },
      },
    },
    '/api/operations/version': {
      get: {
        summary: 'Read deployed version metadata',
        'x-route-id': 'operations.version',
        responses: { '200': jsonObjectResponse('Current deployed version and source metadata.') },
      },
    },
  };
}

function canonicalize(document) {
  const retained = {};
  for (const [currentPath, pathItem] of Object.entries(document.paths ?? {})) {
    if (currentPath.startsWith('/api/operations/') || currentPath === '/api/openapi.json' || REST_DEMO_ROUTE_IDS[currentPath]) continue;
    retained[currentPath] = pathItem;
  }

  const firstServer = document.servers?.[0] && typeof document.servers[0] === 'object'
    ? document.servers[0]
    : {};
  document.servers = [{ ...firstServer, url: 'https://demo.wizardgang.ai' }];
  document.paths = {
    ...restDemoPaths(),
    ...retained,
    ...operationsPaths(),
    '/api/openapi.json': {
      get: {
        summary: 'Read the canonical OpenAPI 3.1 document',
        'x-route-id': 'interfaces.openapi.json',
        responses: {
          '200': jsonObjectResponse('Canonical OpenAPI 3.1 document.'),
        },
      },
    },
  };
  document.tags = structuredClone(restDemoOpenApiDocument.tags);
  document.components.schemas = structuredClone(restDemoOpenApiDocument.components.schemas);
  document.components.securitySchemes = {
    ...document.components.securitySchemes,
    ...structuredClone(restDemoOpenApiDocument.components.securitySchemes),
  };
  return document;
}

const expected = canonicalize(structuredClone(openApi));
fs.writeFileSync(openApiPath, `${JSON.stringify(expected, null, 2)}\n`);
