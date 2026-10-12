import { edgeInspectionResponse } from '../../api/runtime';
import {
  NO_STORAGE,
  definePlatformLaboratoryCapability,
  noRequestBody,
} from '../route-capability';

const tests = ['tests/platform-laboratory-routing.test.ts', 'tests/router.test.ts'] as const;

export const edgeLaboratoryCapability = definePlatformLaboratoryCapability({
  id: 'platform.edge',
  routes: [

    {
      id: 'platform.edge.inspect',
      labId: 'edge',
      pattern: '/api/labs/edge',
      methods: ['GET'],
      requestSchemas: { GET: 'none' },
      kind: 'api',
      handler: (request, env) => edgeInspectionResponse(request, env),
      authentication: { mode: 'anonymous' },
      authorization: { mode: 'none' },
      visibility: 'public',
      sameOrigin: { mode: 'not-required' },
      cache: { mode: 'no-store' },
      crawler: { crawling: 'allow', indexing: 'deny' },
      documentation: {
        title: 'Edge inspection laboratory API',
        description: 'Returns the allowlisted Cloudflare request context without client identifiers.',
      },
      source: {
        module: 'src/platform/route-capabilities/edge.ts',
        exportName: 'edgeLaboratoryCapability',
        tests,
      },
      requestLimits: noRequestBody('GET inspects request metadata and does not consume a request body.'),
      storage: NO_STORAGE,
    },
  ],
});
