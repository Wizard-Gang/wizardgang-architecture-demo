import type { Env } from '../types';
import type { AdminIdentity } from '../lib/admin-auth';
import { healthResponse, versionResponse } from '../api/operations';
import { securityTxtResponse } from '../api/security-policy';
import { sitemapResponse } from '../api/sitemap';
import { uiAssetResponse } from '../ui/assets';
import { gitDemoPreflightResponse, gitDemoReleaseResponse, gitDemoStartResponse } from '../api/git-demo';
import {
  createRouteRegistry,
  defineRouteModule,
  type CachePolicy,
  type RouteDeclaration,
  type RouteHandler,
  type RouteKind,
  type RouteMethod,
} from './registry';

export interface OperationalRouteContext {
  env: Env;
  adminIdentity?: AdminIdentity;
}

interface OperationalRouteInput {
  id: string;
  pattern: string;
  methods: readonly RouteMethod[];
  kind: RouteKind;
  handler: RouteHandler<OperationalRouteContext>;
  title: string;
  description: string;
  sourceModule: string;
  sourceExport: string;
  cache?: CachePolicy;
  crawling?: 'allow' | 'deny';
  indexing?: 'allow' | 'deny';
  visibility?: 'public' | 'private';
  authentication?: RouteDeclaration<OperationalRouteContext>['authentication'];
  authorization?: RouteDeclaration<OperationalRouteContext>['authorization'];
  sameOrigin?: RouteDeclaration<OperationalRouteContext>['sameOrigin'];
}

const POLICY_TEST = 'tests/operational-route-registry.test.ts';

function operationalRoute(input: OperationalRouteInput): RouteDeclaration<OperationalRouteContext> {
  return {
    id: input.id,
    pattern: input.pattern,
    methods: input.methods,
    kind: input.kind,
    handler: input.handler,
    authentication: input.authentication ?? { mode: 'anonymous' },
    authorization: input.authorization ?? { mode: 'none' },
    visibility: input.visibility ?? 'public',
    sameOrigin: input.sameOrigin ?? { mode: 'not-required' },
    cache: input.cache ?? { mode: 'no-store' },
    crawler: {
      crawling: input.crawling ?? 'allow',
      indexing: input.indexing ?? 'deny',
    },
    documentation: {
      title: input.title,
      description: input.description,
    },
    source: {
      module: input.sourceModule,
      exportName: input.sourceExport,
      tests: [POLICY_TEST, 'tests/router.test.ts'],
    },
  };
}

const globalOperationalRoutes = [
  operationalRoute({
    id: 'operations.admin-git-delivery', pattern: '/admin/api/labs/git-delivery', methods: ['GET', 'POST'], kind: 'api',
    handler: (request, { env }) => request.method === 'GET'
      ? gitDemoPreflightResponse(request, env)
      : gitDemoStartResponse(request, env),
    title: 'Git delivery operator action', description: 'Protected release preflight and start action behind the shared operator gate.',
    sourceModule: 'src/api/git-demo.ts', sourceExport: 'gitDemoPreflightResponse', visibility: 'private',
    authentication: { mode: 'required', provider: 'wg-ops' }, authorization: { mode: 'policy', policy: 'admin + release controls' },
    sameOrigin: { mode: 'required', methods: ['POST'] }, crawling: 'deny',
  }),
  operationalRoute({
    id: 'operations.admin-git-release', pattern: '/admin/api/labs/git-release', methods: ['POST'], kind: 'api',
    handler: (request, { env }) => gitDemoReleaseResponse(request, env),
    title: 'Git release operator action', description: 'Protected merge-and-release action behind the shared operator gate.',
    sourceModule: 'src/api/git-demo.ts', sourceExport: 'gitDemoReleaseResponse', visibility: 'private',
    authentication: { mode: 'required', provider: 'wg-ops' }, authorization: { mode: 'policy', policy: 'admin + release-ready controls' },
    sameOrigin: { mode: 'required', methods: ['POST'] }, crawling: 'deny',
  }),
  operationalRoute({
    id: 'operations.health', pattern: '/api/operations/health', methods: ['GET'], kind: 'api', handler: (_request, { env }) => healthResponse(env),
    title: 'Operations health', description: 'Machine-readable runtime and dependency health.',
    sourceModule: 'src/api/operations.ts', sourceExport: 'healthResponse',
  }),
  operationalRoute({
    id: 'operations.version', pattern: '/api/operations/version', methods: ['GET'], kind: 'api', handler: (_request, { env }) => versionResponse(env),
    title: 'Operations version', description: 'Machine-readable deployed version and source metadata.',
    sourceModule: 'src/api/operations.ts', sourceExport: 'versionResponse',
  }),
  operationalRoute({
    id: 'operations.security-txt', pattern: '/.well-known/security.txt', methods: ['GET', 'HEAD'], kind: 'protocol',
    handler: (request, { env }) => securityTxtResponse(request, env),
    title: 'Security contact', description: 'RFC 9116 vulnerability-reporting contact and policy metadata.',
    sourceModule: 'src/api/security-policy.ts', sourceExport: 'securityTxtResponse', crawling: 'allow',
    cache: { mode: 'public', maxAgeSeconds: 3600 },
  }),
  operationalRoute({
    id: 'operations.assets', pattern: '/assets/:asset', methods: ['GET', 'HEAD'], kind: 'asset',
    handler: (request, { env }, params) => uiAssetResponse(request, env, params.asset || ''), title: 'Static browser asset', description: 'Locally built immutable browser and social-preview assets.',
    sourceModule: 'src/ui/assets.ts', sourceExport: 'uiAssetResponse',
    cache: { mode: 'public', maxAgeSeconds: 31_536_000, immutable: true },
  }),
  operationalRoute({
    id: 'operations.sitemap', pattern: '/sitemap.xml', methods: ['GET'], kind: 'protocol',
    handler: (request) => sitemapResponse(request), title: 'Sitemap', description: 'Registry-generated public sitemap.',
    sourceModule: 'src/api/sitemap.ts', sourceExport: 'sitemapResponse',
    cache: { mode: 'public', maxAgeSeconds: 3600 },
  }),
] as const;

export const operationalRouteRegistry = createRouteRegistry([
  defineRouteModule('operations', globalOperationalRoutes),
]);
