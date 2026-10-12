import type { Env } from '../types';
import type { PageMetadata } from '../routing/application-routes';
import type {
  CachePolicy,
  RouteDeclaration,
  RouteHandler,
  RouteKind,
  RouteMethod,
} from '../routing/registry';

export interface InterfaceIdentityRouteContext {
  env: Env;
}

export type BrowserHtmlPolicy = 'page' | 'never';

export interface InterfaceIdentityRouteDeclaration extends RouteDeclaration<InterfaceIdentityRouteContext> {
  browserHtml: BrowserHtmlPolicy;
  page?: PageMetadata;
}

export interface InterfaceIdentityCapability {
  id: string;
  routes: readonly InterfaceIdentityRouteDeclaration[];
}

interface InterfaceIdentityRouteInput {
  id: string;
  pattern: string;
  methods: readonly RouteMethod[];
  kind: RouteKind;
  handler: RouteHandler<InterfaceIdentityRouteContext>;
  title: string;
  description: string;
  sourceModule: string;
  sourceExport?: string;
  tests?: readonly string[];
  authentication?: InterfaceIdentityRouteDeclaration['authentication'];
  authorization?: InterfaceIdentityRouteDeclaration['authorization'];
  visibility?: InterfaceIdentityRouteDeclaration['visibility'];
  sameOrigin?: InterfaceIdentityRouteDeclaration['sameOrigin'];
  cache?: CachePolicy;
  crawling?: InterfaceIdentityRouteDeclaration['crawler']['crawling'];
  indexing?: InterfaceIdentityRouteDeclaration['crawler']['indexing'];
  browserHtml?: BrowserHtmlPolicy;
  page?: PageMetadata;
}

const ROUTE_TEST = 'tests/interface-identity-routing.test.ts';

export function interfaceIdentityRoute(input: InterfaceIdentityRouteInput): InterfaceIdentityRouteDeclaration {
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
    offline: { mode: 'gated' },
    cache: input.cache ?? { mode: 'no-store' },
    crawler: {
      crawling: input.crawling ?? 'controlled',
      indexing: input.indexing ?? (input.kind === 'page' ? 'allow' : 'deny'),
    },
    browserHtml: input.browserHtml ?? (input.kind === 'page' ? 'page' : 'never'),
    documentation: {
      title: input.title,
      description: input.description,
    },
    source: {
      module: input.sourceModule,
      ...(input.sourceExport ? { exportName: input.sourceExport } : {}),
      tests: [ROUTE_TEST, ...(input.tests ?? [])],
    },
    ...(input.page ? { page: input.page } : {}),
  };
}

export function defineInterfaceIdentityCapability(
  id: string,
  routes: readonly InterfaceIdentityRouteDeclaration[],
): InterfaceIdentityCapability {
  return { id, routes };
}
