import type { AdminIdentity } from '../lib/admin-auth';
import type { Env } from '../types';
import { interfaceIdentityRouteRegistry } from './interface-identity-routes';
import type { InterfaceIdentityRouteContext } from '../interfaces/route-capability';
import {
  operationalRouteRegistry,
  type OperationalRouteContext,
} from './operational-routes';
import { platformLaboratoryRouteRegistry } from './platform-laboratory-routes';
import {
  createRouteRegistry,
  defineRouteModule,
  normalizeRoutePath,
  type RouteDeclaration,
  type RouteModule,
  type RouteRegistry,
} from './registry';
import { configureRegisteredRoutes } from './navigation';
import { withRouteQuery, type RouteQuery } from './route-url';

export type BrowserHtmlPolicy = 'page' | 'never';

export interface PageMetadata {
  parent?: string;
  label: string;
  summary: string;
  order: number;
  navigation: 'primary' | 'none';
  architectureMap: boolean;
}

export interface ApplicationRouteContext {
  env: Env;
  adminIdentity?: AdminIdentity;
}

export interface ApplicationRouteDeclaration extends RouteDeclaration<ApplicationRouteContext> {
  browserHtml: BrowserHtmlPolicy;
  page?: PageMetadata;
}

type RouteWithPage<TContext> = RouteDeclaration<TContext> & { page?: PageMetadata };

function browserHtmlFor<TContext>(route: RouteDeclaration<TContext>): BrowserHtmlPolicy {
  const explicit = (route as RouteDeclaration<TContext> & { browserHtml?: BrowserHtmlPolicy }).browserHtml;
  return explicit ?? (route.kind === 'page' ? 'page' : 'never');
}

function validateApplicationDeclaration(route: ApplicationRouteDeclaration): void {
  if (!route.documentation.title.trim() || !route.documentation.description.trim()) {
    throw new Error(`Route '${route.id}' is undocumented: title and description are required`);
  }
  if (route.documentation.docs.length === 0 || route.documentation.docs.some((doc) => !doc.trim())) {
    throw new Error(`Route '${route.id}' is undocumented: at least one documentation path is required`);
  }
  if (!route.source.module.trim()) {
    throw new Error(`Route '${route.id}' is undocumented: source.module is required`);
  }
  if (route.kind === 'page' && !route.methods.includes('GET')) {
    throw new Error(`Route '${route.id}' is unreachable as a page because it does not support GET`);
  }
  if (route.kind === 'page' && !route.page) {
    throw new Error(`Route '${route.id}' is a page without page metadata`);
  }
  if (route.kind !== 'page' && route.page) {
    throw new Error(`Route '${route.id}' has page metadata but is not a page`);
  }
  if (route.page) {
    if (!route.page.label.trim() || !route.page.summary.trim() || !Number.isFinite(route.page.order)) {
      throw new Error(`Route '${route.id}' has incomplete page metadata`);
    }
    if (route.page.navigation !== 'none' && (
      route.visibility !== 'public' || !route.methods.includes('GET') || route.pattern.includes(':')
    )) {
      throw new Error(`Route '${route.id}' has unreachable page navigation metadata`);
    }
    if (route.page.architectureMap && (
      route.visibility !== 'public' || !route.methods.includes('GET') || route.pattern.includes(':')
    )) {
      throw new Error(`Route '${route.id}' has unreachable architecture-map metadata`);
    }
  }
  if (route.visibility === 'private' && route.crawler.indexing === 'allow') {
    throw new Error(`Route '${route.id}' is private but allows indexing`);
  }
  if (route.visibility === 'private' && route.cache.mode === 'public') {
    throw new Error(`Route '${route.id}' is private but declares public caching`);
  }
}

function validatePageHierarchy(registry: RouteRegistry<ApplicationRouteContext>): void {
  const pages = (registry.declarations as readonly ApplicationRouteDeclaration[])
    .filter((route) => route.kind === 'page');
  const pageById = new Map(pages.map((route) => [route.id, route]));

  for (const route of pages) {
    const parentId = route.page?.parent;
    if (parentId && !pageById.has(parentId)) {
      throw new Error(`Route '${route.id}' declares unknown page parent '${parentId}'`);
    }
  }

  const roots = pages.filter((route) => !route.page?.parent);
  if (roots.length !== 1 || roots[0]?.id !== 'interfaces.frontend.index') {
    throw new Error(`Page hierarchy must have exactly one root: interfaces.frontend.index`);
  }

  for (const route of pages) {
    const seen = new Set<string>();
    let current: ApplicationRouteDeclaration | undefined = route;
    while (current?.page?.parent) {
      if (!seen.add(current.id)) {
        throw new Error(`Page hierarchy contains a cycle at route '${current.id}'`);
      }
      current = pageById.get(current.page.parent);
    }
  }
}

function adaptRoute<TContext>(
  route: RouteDeclaration<TContext>,
  handler: ApplicationRouteDeclaration['handler'],
): ApplicationRouteDeclaration {
  const applicationRoute = route as RouteWithPage<TContext>;
  return {
    ...applicationRoute,
    handler,
    browserHtml: browserHtmlFor(route),
  };
}

function operationalRoutes(): ApplicationRouteDeclaration[] {
  return operationalRouteRegistry.declarations.map((route) => adaptRoute(
    route,
    (request, context, params) => route.handler(
      request,
      { env: context.env, adminIdentity: context.adminIdentity } satisfies OperationalRouteContext,
      params,
    ),
  ));
}

function interfaceIdentityRoutes(): ApplicationRouteDeclaration[] {
  return interfaceIdentityRouteRegistry.declarations.map((route) => adaptRoute(
    route,
    (request, context, params) => route.handler(
      request,
      { env: context.env } satisfies InterfaceIdentityRouteContext,
      params,
    ),
  ));
}

function platformRoutes(): ApplicationRouteDeclaration[] {
  return platformLaboratoryRouteRegistry.declarations.map((route) => adaptRoute(
    route,
    (request, context, params) => route.handler(request, context.env, params),
  ));
}

const applicationModules: readonly RouteModule<ApplicationRouteContext>[] = [
  defineRouteModule('application.operations', operationalRoutes()),
  defineRouteModule('application.interfaces', interfaceIdentityRoutes()),
  defineRouteModule('application.platform', platformRoutes()),
];

function normalizeAdditionalModule(
  module: RouteModule<ApplicationRouteContext>,
): RouteModule<ApplicationRouteContext> {
  return defineRouteModule(
    module.id,
    module.routes.map((route) => adaptRoute(route, route.handler)),
  );
}

export function createApplicationRouteRegistry(
  additionalModules: readonly RouteModule<ApplicationRouteContext>[] = [],
): RouteRegistry<ApplicationRouteContext> {
  const registry = createRouteRegistry([
    ...applicationModules,
    ...additionalModules.map(normalizeAdditionalModule),
  ]);
  for (const route of registry.declarations as readonly ApplicationRouteDeclaration[]) {
    validateApplicationDeclaration(route);
  }
  validatePageHierarchy(registry);
  return registry;
}

function interpolatePattern(pattern: string, params: Readonly<Record<string, string>>): string {
  const expected = new Set<string>();
  const route = normalizeRoutePath(pattern).split('/').map((segment) => {
    if (!segment.startsWith(':')) return segment;
    const name = segment.slice(1);
    expected.add(name);
    const value = params[name];
    if (value === undefined) throw new Error(`Missing route parameter '${name}' for ${pattern}`);
    return encodeURIComponent(value.normalize('NFC'));
  }).join('/');
  for (const name of Object.keys(params)) {
    if (!expected.has(name)) throw new Error(`Unexpected route parameter '${name}' for ${pattern}`);
  }
  return route || '/';
}

export function routeUrlFromRegistry(
  registry: RouteRegistry<ApplicationRouteContext>,
  routeId: string,
  params: Readonly<Record<string, string>> = {},
  query: RouteQuery = {},
): string {
  const route = registry.declarations.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error(`Unknown route ID '${routeId}'`);
  return withRouteQuery(interpolatePattern(route.pattern, params), query);
}

export const applicationRouteRegistry = createApplicationRouteRegistry();
configureRegisteredRoutes(applicationRouteRegistry.declarations as readonly ApplicationRouteDeclaration[]);

export function routeUrl(
  routeId: string,
  params: Readonly<Record<string, string>> = {},
  query: RouteQuery = {},
): string {
  return routeUrlFromRegistry(applicationRouteRegistry, routeId, params, query);
}
