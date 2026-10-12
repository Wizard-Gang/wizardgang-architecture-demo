import type { Env } from '../types';
import type { AdminIdentity } from '../lib/admin-auth';
import { getDemoControl, setDemoControl } from '../lib/demo-control';
import {
  getCrawlerControl,
  robotsResponse,
  setCrawlerControl,
} from '../lib/crawler-control';
import { json } from '../lib/http';
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
import type { PageMetadata } from './application-routes';

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
  offline?: 'available' | 'gated';
  cache?: CachePolicy;
  crawling?: 'allow' | 'deny' | 'controlled';
  indexing?: 'allow' | 'deny';
  visibility?: 'public' | 'private';
  authentication?: RouteDeclaration<OperationalRouteContext>['authentication'];
  authorization?: RouteDeclaration<OperationalRouteContext>['authorization'];
  sameOrigin?: RouteDeclaration<OperationalRouteContext>['sameOrigin'];
  page?: PageMetadata;
}

const POLICY_TEST = 'tests/operational-route-registry.test.ts';

function operationalRoute(input: OperationalRouteInput): RouteDeclaration<OperationalRouteContext> & { page?: PageMetadata } {
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
    offline: { mode: input.offline ?? 'available' },
    cache: input.cache ?? { mode: 'no-store' },
    crawler: {
      crawling: input.crawling ?? 'controlled',
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
    ...(input.page ? { page: input.page } : {}),
  };
}

async function adminHandler(request: Request, context: OperationalRouteContext): Promise<Response> {
  const { env, adminIdentity } = context;
  if (!adminIdentity) throw new Error('Admin route executed without an authenticated identity');
  const url = new URL(request.url);

  if (request.method === 'POST') {
    const form = await request.formData();
    const requestedControl = form.get('control');
    if (requestedControl === 'chatgpt-crawl') {
      const requestedState = form.get('state');
      if (requestedState !== 'enabled' && requestedState !== 'disabled') {
        return json({ error: 'invalid_crawler_state' }, { status: 400, headers: { 'cache-control': 'no-store' } });
      }
      await setCrawlerControl(env, requestedState, adminIdentity.username);
      const location = new URL('/admin', url.origin);
      location.searchParams.set('changed', `chatgpt-crawl-${requestedState}`);
      location.hash = 'chatgpt-crawl';
      return new Response(null, { status: 303, headers: { location: location.toString(), 'cache-control': 'no-store' } });
    }
    if (requestedControl !== null && requestedControl !== 'demo') {
      return json({ error: 'invalid_admin_control' }, { status: 400, headers: { 'cache-control': 'no-store' } });
    }
    const state = form.get('state') === 'offline' ? 'offline' : 'online';
    const fallback = state === 'offline' ? 'The demo is temporarily unavailable.' : 'The architecture demo is available.';
    const message = String(form.get('message') || fallback).trim().slice(0, 500) || fallback;
    await setDemoControl(env, state, message, adminIdentity.username);
    const location = new URL('/admin', url.origin);
    location.searchParams.set('changed', state);
    return new Response(null, { status: 303, headers: { location: location.toString(), 'cache-control': 'no-store' } });
  }

  const changed = url.searchParams.get('changed');
  const [demoControl, crawlerControl] = await Promise.all([getDemoControl(env), getCrawlerControl(env)]);
  const notice = changed === 'online' || changed === 'offline'
    ? `Demo is now ${changed}.`
    : changed === 'chatgpt-crawl-enabled' || changed === 'chatgpt-crawl-disabled'
      ? `ChatGPT crawl access is now ${changed.endsWith('enabled') ? 'enabled' : 'disabled'}.`
      : '';
  const { renderAdmin } = await import('../ui/admin');
  return renderAdmin(env, demoControl, crawlerControl, notice);
}

const globalOperationalRoutes = [
  operationalRoute({
    id: 'operations.admin', pattern: '/admin', methods: ['GET', 'POST'], kind: 'page', handler: adminHandler,
    title: 'Demo administration', description: 'Protected control surface for demo availability and ChatGPT fetch policy.',
    sourceModule: 'src/ui/admin.tsx', sourceExport: 'renderAdmin', visibility: 'private', crawling: 'allow', indexing: 'deny',
    authentication: { mode: 'required', provider: 'wg-ops' }, authorization: { mode: 'policy', policy: 'admin' },
    sameOrigin: { mode: 'required', methods: ['POST'] },
    page: {
      parent: 'interfaces.frontend.index',
      label: 'Demo administration',
      summary: 'Protected control surface for demo availability and ChatGPT fetch policy.',
      order: 0,
      navigation: 'none',
      architectureMap: false,
    },
  }),
  operationalRoute({
    id: 'operations.admin-git-delivery', pattern: '/admin/api/labs/git-delivery', methods: ['GET', 'POST'], kind: 'api',
    handler: (request, { env }) => request.method === 'GET'
      ? gitDemoPreflightResponse(request, env)
      : gitDemoStartResponse(request, env),
    title: 'Git delivery operator action', description: 'Protected release preflight and start action behind the shared operator gate.',
    sourceModule: 'src/api/git-demo.ts', sourceExport: 'gitDemoPreflightResponse', visibility: 'private',
    authentication: { mode: 'required', provider: 'wg-ops' }, authorization: { mode: 'policy', policy: 'admin + release controls' },
    sameOrigin: { mode: 'required', methods: ['POST'] }, offline: 'gated', crawling: 'deny',
  }),
  operationalRoute({
    id: 'operations.admin-git-release', pattern: '/admin/api/labs/git-release', methods: ['POST'], kind: 'api',
    handler: (request, { env }) => gitDemoReleaseResponse(request, env),
    title: 'Git release operator action', description: 'Protected merge-and-release action behind the shared operator gate.',
    sourceModule: 'src/api/git-demo.ts', sourceExport: 'gitDemoReleaseResponse', visibility: 'private',
    authentication: { mode: 'required', provider: 'wg-ops' }, authorization: { mode: 'policy', policy: 'admin + release-ready controls' },
    sameOrigin: { mode: 'required', methods: ['POST'] }, offline: 'gated', crawling: 'deny',
  }),
  operationalRoute({
    id: 'operations.offline', pattern: '/offline', methods: ['GET'], kind: 'page',
    handler: async (request, { env }) => {
      const { renderOffline } = await import('../ui/offline');
      return renderOffline(env, await getDemoControl(env), new URL(request.url).searchParams.get('from') || '/');
    },
    title: 'Offline recovery page', description: 'Public maintenance page shown when ordinary demo routes are intentionally offline.',
    sourceModule: 'src/ui/offline.tsx', sourceExport: 'renderOffline', indexing: 'deny',
    page: {
      parent: 'interfaces.frontend.index',
      label: 'Offline recovery page',
      summary: 'Public maintenance page shown when ordinary demo routes are intentionally offline.',
      order: 1,
      navigation: 'none',
      architectureMap: false,
    },
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
    id: 'operations.robots', pattern: '/robots.txt', methods: ['GET', 'HEAD'], kind: 'protocol',
    handler: async (request, { env }) => robotsResponse(request, await getCrawlerControl(env)),
    title: 'Robots policy', description: 'Dynamic crawler policy preserving ChatGPT fetch controls and GPTBot opt-out.',
    sourceModule: 'src/lib/crawler-control.ts', sourceExport: 'robotsResponse', crawling: 'allow',
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
    sourceModule: 'src/api/sitemap.ts', sourceExport: 'sitemapResponse', offline: 'gated',
    cache: { mode: 'public', maxAgeSeconds: 3600 },
  }),
] as const;

export const operationalRouteRegistry = createRouteRegistry([
  defineRouteModule('operations', globalOperationalRoutes),
]);
