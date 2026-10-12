import {
  r2FilesResetResponse,
  r2FilesResponse,
} from '../../api/r2';
import {
  R2_OBJECT_STORAGE,
  definePlatformLaboratoryCapability,
  noRequestBody,
} from '../route-capability';

const tests = [
  'tests/platform-laboratory-routing.test.ts',
  'tests/r2-lab.test.ts',
  'tests/router.test.ts',
] as const;


export const r2LaboratoryCapability = definePlatformLaboratoryCapability({
  id: 'platform.r2',
  routes: [
    {
      id: 'platform.r2.files',
      labId: 'r2-files',
      pattern: '/api/labs/r2-files',
      methods: ['GET', 'POST'],
      requestSchemas: { GET: 'none', POST: 'r2-file-upload-v1' },
      kind: 'api',
      handler: (request, env) => r2FilesResponse(request, env),
      authentication: { mode: 'anonymous' },
      authorization: { mode: 'none' },
      visibility: 'public',
      sameOrigin: { mode: 'required', methods: ['POST'] },
      offline: { mode: 'gated' },
      cache: { mode: 'no-store' },
      crawler: { crawling: 'controlled', indexing: 'deny' },
      documentation: {
        title: 'R2 files laboratory API',
        description: 'Lists or uploads visitor-scoped files whose bytes live in R2 and metadata lives in D1.',
      },
      source: {
        module: 'src/platform/route-capabilities/r2.ts',
        exportName: 'r2LaboratoryCapability',
        tests,
      },
      requestLimits: {
        maxBodyBytes: 5 * 1024 * 1024 + 65_536,
        maxObjectBytes: 5 * 1024 * 1024,
        maxObjectsPerSession: 10,
        maxTotalBytesPerSession: 20 * 1024 * 1024,
        notes: ['POST accepts multipart form data; the body allowance includes multipart overhead.'],
      },
      storage: R2_OBJECT_STORAGE,
    },
    {
      id: 'platform.r2.file',
      labId: 'r2-files',
      pattern: '/api/labs/r2-files/:id',
      methods: ['GET', 'DELETE'],
      requestSchemas: { GET: 'r2-file-id-v1', DELETE: 'r2-file-id-v1' },
      kind: 'api',
      handler: (request, env, params) => r2FilesResponse(request, env, encodeURIComponent(params.id)),
      authentication: { mode: 'anonymous' },
      authorization: { mode: 'none' },
      visibility: 'public',
      sameOrigin: { mode: 'required', methods: ['DELETE'] },
      offline: { mode: 'gated' },
      cache: { mode: 'no-store' },
      crawler: { crawling: 'controlled', indexing: 'deny' },
      documentation: {
        title: 'R2 file item laboratory API',
        description: 'Streams a visible R2 object or deletes one owned by the visitor sandbox.',
      },
      source: {
        module: 'src/platform/route-capabilities/r2.ts',
        exportName: 'r2LaboratoryCapability',
        tests,
      },
      requestLimits: noRequestBody('GET and DELETE operate on the path identifier and do not consume a request body.'),
      storage: R2_OBJECT_STORAGE,
    },
    {
      id: 'platform.r2.reset',
      labId: 'r2-reset',
      pattern: '/api/labs/r2-reset',
      methods: ['POST'],
      requestSchemas: { POST: 'none' },
      kind: 'api',
      handler: (request, env) => r2FilesResetResponse(request, env),
      authentication: { mode: 'anonymous' },
      authorization: { mode: 'none' },
      visibility: 'public',
      sameOrigin: { mode: 'required', methods: ['POST'] },
      offline: { mode: 'gated' },
      cache: { mode: 'no-store' },
      crawler: { crawling: 'controlled', indexing: 'deny' },
      documentation: {
        title: 'R2 files reset laboratory API',
        description: 'Deletes visitor-owned R2 objects and their D1 metadata rows.',
      },
      source: {
        module: 'src/platform/route-capabilities/r2.ts',
        exportName: 'r2LaboratoryCapability',
        tests,
      },
      requestLimits: noRequestBody('POST resets the visitor R2 sandbox without consuming a request body.'),
      storage: R2_OBJECT_STORAGE,
    },
  ],
});
