import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const openApiPath = path.join(root, 'contracts', 'openapi', 'openapi.json');

const openApi = JSON.parse(fs.readFileSync(openApiPath, 'utf8'));

const schemas = openApi.components?.schemas;
if (!schemas || typeof schemas !== 'object') {
  throw new Error('OpenAPI components.schemas is required before generated paths can be synchronized.');
}

const jsonObjectResponse = (description, schema = { type: 'object' }) => ({
  description,
  content: {
    'application/json': { schema },
  },
});

const errorResponses = {
  '400': jsonObjectResponse('Invalid request.'),
  '401': jsonObjectResponse('Authentication required.'),
  '403': jsonObjectResponse('Insufficient permission.'),
  '404': jsonObjectResponse('Resource not found.'),
};

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
    '/api/operations/logs': {
      get: {
        summary: 'Read sanitized application logs',
        'x-route-id': 'operations.api-logs',
        responses: { '200': jsonObjectResponse('Sanitized operational log telemetry.'), ...errorResponses },
      },
    },
    '/api/operations/budget': {
      post: {
        summary: 'Calculate the synthetic operations budget demonstration',
        'x-route-id': 'operations.api-budget',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': jsonObjectResponse('Synthetic budget calculation.'), '400': jsonObjectResponse('Invalid budget input.') },
      },
    },
  };
}

function canonicalize(document) {
  const retained = {};
  for (const [currentPath, pathItem] of Object.entries(document.paths ?? {})) {
    if (currentPath.startsWith('/api/operations/') || currentPath === '/api/openapi.json') continue;
    retained[currentPath] = pathItem;
  }

  const firstServer = document.servers?.[0] && typeof document.servers[0] === 'object'
    ? document.servers[0]
    : {};
  document.servers = [{ ...firstServer, url: 'https://demo.wizardgang.ai' }];
  document.paths = {
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
  return document;
}

const expected = canonicalize(structuredClone(openApi));
fs.writeFileSync(openApiPath, `${JSON.stringify(expected, null, 2)}\n`);
