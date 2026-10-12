import { openApiResponse } from '../../api/openapi';
import { defineInterfaceIdentityCapability, interfaceIdentityRoute } from '../route-capability';

export const restRouteCapability = defineInterfaceIdentityCapability('interfaces.rest', [

  interfaceIdentityRoute({
    id: 'interfaces.openapi.json',
    pattern: '/api/openapi.json',
    methods: ['GET'],
    kind: 'api',
    handler: (request) => openApiResponse(request),
    title: 'OpenAPI JSON contract',
    description: 'The single OpenAPI 3.1 contract: REST demo records, identity, GraphQL, MCP, webhooks and operations.',
    sourceModule: 'src/api/openapi.ts',
    sourceExport: 'openApiResponse',
    cache: { mode: 'public', maxAgeSeconds: 300 },
    tests: ['tests/contracts.test.ts', 'tests/api-records.test.ts'],
  }),
]);
