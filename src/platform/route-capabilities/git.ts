import { gitDemoStatusResponse } from '../../api/git-demo';
import { NO_STORAGE, definePlatformLaboratoryCapability, noRequestBody } from '../route-capability';

const tests = ['tests/platform-laboratory-routing.test.ts', 'tests/git-demo.test.ts', 'tests/router.test.ts'] as const;

export const gitLaboratoryCapability = definePlatformLaboratoryCapability({
  id: 'platform.git',
  routes: [
    {
      id: 'platform.git.delivery',
      labId: 'git-delivery',
      pattern: '/api/labs/git-delivery',
      methods: ['GET'],
      requestSchemas: { GET: 'git-delivery-status-query-v1' },
      kind: 'api',
      handler: (request, env) => gitDemoStatusResponse(request, env),
      authentication: { mode: 'anonymous' },
      authorization: { mode: 'none' },
      visibility: 'public',
      sameOrigin: { mode: 'not-required' },
      cache: { mode: 'no-store' },
      crawler: { crawling: 'allow', indexing: 'deny' },
      documentation: {
        title: 'Git delivery laboratory API',
        description: 'Public read-only status for the live Git delivery demonstration.',
      },
      source: { module: 'src/platform/route-capabilities/git.ts', exportName: 'gitLaboratoryCapability', tests },
      requestLimits: noRequestBody('GET consumes no body and exposes only sanitized live GitHub delivery status.'),
      storage: NO_STORAGE,
    },
  ],
});
