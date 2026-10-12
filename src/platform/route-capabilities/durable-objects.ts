import { durableCounterResponse } from '../../api/durable';
import {
  DURABLE_OBJECT_STORAGE,
  definePlatformLaboratoryCapability,
  noRequestBody,
} from '../route-capability';

const tests = ['tests/platform-laboratory-routing.test.ts', 'tests/runtime.test.ts', 'tests/router.test.ts'] as const;

export const durableObjectsLaboratoryCapability = definePlatformLaboratoryCapability({
  id: 'platform.durable-objects',
  routes: [

    {
      id: 'platform.durable-objects.counter',
      labId: 'durable-counter',
      pattern: '/api/labs/durable-counter',
      methods: ['GET', 'POST'],
      requestSchemas: { GET: 'none', POST: 'none' },
      kind: 'api',
      handler: (request, env) => durableCounterResponse(request, env),
      authentication: { mode: 'anonymous' },
      authorization: { mode: 'none' },
      visibility: 'public',
      sameOrigin: { mode: 'not-required' },
      cache: { mode: 'no-store' },
      crawler: { crawling: 'allow', indexing: 'deny' },
      documentation: {
        title: 'Durable Object counter laboratory API',
        description: 'Reads or increments the public counter coordinated and persisted by a Durable Object.',
      },
      source: {
        module: 'src/platform/route-capabilities/durable-objects.ts',
        exportName: 'durableObjectsLaboratoryCapability',
        tests,
      },
      requestLimits: noRequestBody('GET and POST use the method as the operation and do not consume a request body.'),
      storage: DURABLE_OBJECT_STORAGE,
    },
  ],
});
