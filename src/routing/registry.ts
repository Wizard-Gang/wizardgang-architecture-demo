export const ROUTE_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

export type RouteMethod = typeof ROUTE_METHODS[number];
export type RouteKind = 'page' | 'api' | 'protocol' | 'asset';
export type RouteVisibility = 'public' | 'private';

export type AuthenticationPolicy =
  | { mode: 'anonymous' }
  | { mode: 'required'; provider: string };

export type AuthorizationPolicy =
  | { mode: 'none' }
  | { mode: 'policy'; policy: string };

export type OfflinePolicy =
  | { mode: 'available' }
  | { mode: 'gated' };

export type SameOriginPolicy =
  | { mode: 'not-required' }
  | { mode: 'required'; methods: readonly RouteMethod[] };

export type CachePolicy =
  | { mode: 'no-store' }
  | { mode: 'private'; maxAgeSeconds?: number }
  | { mode: 'public'; maxAgeSeconds: number; staleWhileRevalidateSeconds?: number; immutable?: boolean }
  | { mode: 'response' };

export interface CrawlerPolicy {
  crawling: 'allow' | 'deny' | 'controlled';
  indexing: 'allow' | 'deny';
}

export interface RouteDocumentationMetadata {
  title: string;
  description: string;
}

export interface RouteSourceMetadata {
  module: string;
  exportName?: string;
  tests?: readonly string[];
}

export type RouteHandler<TContext = unknown> = (
  request: Request,
  context: TContext,
  params: Readonly<Record<string, string>>,
) => Response | Promise<Response>;

export interface RouteDeclaration<TContext = unknown> {
  id: string;
  pattern: string;
  methods: readonly RouteMethod[];
  kind: RouteKind;
  handler: RouteHandler<TContext>;
  authentication: AuthenticationPolicy;
  authorization: AuthorizationPolicy;
  visibility: RouteVisibility;
  sameOrigin: SameOriginPolicy;
  offline: OfflinePolicy;
  cache: CachePolicy;
  crawler: CrawlerPolicy;
  documentation: RouteDocumentationMetadata;
  source: RouteSourceMetadata;
}

export interface RouteModule<TContext = unknown> {
  id: string;
  routes: readonly RouteDeclaration<TContext>[];
}

export interface MatchedRoute<TContext = unknown> {
  status: 'matched';
  route: RouteDeclaration<TContext>;
  params: Readonly<Record<string, string>>;
}

export interface MethodNotAllowedRoute<TContext = unknown> {
  status: 'method-not-allowed';
  statusCode: 405;
  route: RouteDeclaration<TContext>;
  params: Readonly<Record<string, string>>;
  allowedMethods: readonly RouteMethod[];
}

export interface UnknownRoute {
  status: 'not-found';
  statusCode: 404;
}

export type RouteMatchResult<TContext = unknown> =
  | MatchedRoute<TContext>
  | MethodNotAllowedRoute<TContext>
  | UnknownRoute;

type PatternSegment =
  | { kind: 'literal'; value: string }
  | { kind: 'parameter'; name: string };

interface CompiledPattern {
  normalized: string;
  parameterized: boolean;
  segments: readonly PatternSegment[];
}

interface CompiledRoute<TContext> {
  declaration: RouteDeclaration<TContext>;
  pattern: CompiledPattern;
  allowedMethods: readonly RouteMethod[];
}

const PARAMETER_SEGMENT = /^:([A-Za-z_][A-Za-z0-9_]*)$/;
const ROUTE_ID = /^[a-z0-9][a-z0-9._-]*$/;
const KNOWN_METHODS = new Set<string>(ROUTE_METHODS);

export function defineRouteModule<TContext>(
  id: string,
  routes: readonly RouteDeclaration<TContext>[],
): RouteModule<TContext> {
  return { id, routes };
}

export function normalizeRoutePath(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`Route path must start with '/': ${path}`);
  }
  if (path.includes('?') || path.includes('#')) {
    throw new Error(`Route matcher expects a pathname without query or fragment: ${path}`);
  }
  return path.length > 1 ? path.replace(/\/+$/, '') || '/' : '/';
}

function compilePattern(pattern: string): CompiledPattern {
  const normalized = normalizeRoutePath(pattern);
  if (normalized.includes('//')) {
    throw new Error(`Route pattern cannot contain empty path segments: ${pattern}`);
  }

  const rawSegments = normalized === '/' ? [] : normalized.slice(1).split('/');
  const parameterNames = new Set<string>();
  let parameterized = false;
  const segments = rawSegments.map<PatternSegment>((segment) => {
    if (!segment.startsWith(':')) return { kind: 'literal', value: segment };
    const match = PARAMETER_SEGMENT.exec(segment);
    if (!match) {
      throw new Error(`Invalid route parameter segment '${segment}' in ${pattern}`);
    }
    const name = match[1];
    if (parameterNames.has(name)) {
      throw new Error(`Duplicate route parameter ':${name}' in ${pattern}`);
    }
    parameterNames.add(name);
    parameterized = true;
    return { kind: 'parameter', name };
  });

  return { normalized, parameterized, segments };
}

function validateRouteId(id: string, label: string): void {
  if (!ROUTE_ID.test(id)) {
    throw new Error(`${label} must be a stable lowercase identifier: ${id}`);
  }
}

function normalizeMethods(methods: readonly RouteMethod[], routeId: string): readonly RouteMethod[] {
  if (methods.length === 0) {
    throw new Error(`Route '${routeId}' must declare at least one supported method`);
  }
  const seen = new Set<string>();
  const normalized: RouteMethod[] = [];
  for (const method of methods) {
    if (!KNOWN_METHODS.has(method)) {
      throw new Error(`Route '${routeId}' declares unsupported method '${method}'`);
    }
    if (seen.has(method)) {
      throw new Error(`Route '${routeId}' declares duplicate method '${method}'`);
    }
    seen.add(method);
    normalized.push(method);
  }
  return Object.freeze(normalized);
}

function validateSameOriginPolicy(
  policy: SameOriginPolicy,
  allowedMethods: readonly RouteMethod[],
  routeId: string,
): void {
  if (policy.mode === 'not-required') return;
  if (policy.methods.length === 0) {
    throw new Error(`Route '${routeId}' same-origin policy must declare at least one method`);
  }
  const seen = new Set<RouteMethod>();
  for (const method of policy.methods) {
    if (!allowedMethods.includes(method)) {
      throw new Error(`Route '${routeId}' requires same-origin for undeclared method '${method}'`);
    }
    if (seen.has(method)) {
      throw new Error(`Route '${routeId}' same-origin policy declares duplicate method '${method}'`);
    }
    seen.add(method);
  }
}

function parameterPatternsOverlap(left: CompiledPattern, right: CompiledPattern): boolean {
  if (left.segments.length !== right.segments.length) return false;
  return left.segments.every((leftSegment, index) => {
    const rightSegment = right.segments[index];
    if (leftSegment.kind === 'parameter' || rightSegment.kind === 'parameter') return true;
    return leftSegment.value === rightSegment.value;
  });
}

function decodeParameter(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment).normalize('NFC');
  } catch {
    return undefined;
  }
}

function matchParameterizedPattern(
  pattern: CompiledPattern,
  path: string,
): Readonly<Record<string, string>> | undefined {
  const rawSegments = path === '/' ? [] : path.slice(1).split('/');
  if (rawSegments.length !== pattern.segments.length) return undefined;
  const params: Record<string, string> = {};

  for (let index = 0; index < pattern.segments.length; index += 1) {
    const patternSegment = pattern.segments[index];
    const pathSegment = rawSegments[index];
    if (patternSegment.kind === 'literal') {
      if (patternSegment.value !== pathSegment) return undefined;
      continue;
    }
    if (pathSegment.length === 0) return undefined;
    const decoded = decodeParameter(pathSegment);
    if (decoded === undefined) return undefined;
    params[patternSegment.name] = decoded;
  }

  return Object.freeze(params);
}

function resultForMethod<TContext>(
  route: CompiledRoute<TContext>,
  method: string,
  params: Readonly<Record<string, string>>,
): RouteMatchResult<TContext> {
  const normalizedMethod = method.trim().toUpperCase();
  if (route.allowedMethods.includes(normalizedMethod as RouteMethod)) {
    return { status: 'matched', route: route.declaration, params };
  }
  return {
    status: 'method-not-allowed',
    statusCode: 405,
    route: route.declaration,
    params,
    allowedMethods: route.allowedMethods,
  };
}

export class RouteRegistry<TContext = unknown> {
  readonly declarations: readonly RouteDeclaration<TContext>[];
  readonly moduleIds: readonly string[];

  private readonly exactRoutes: ReadonlyMap<string, CompiledRoute<TContext>>;
  private readonly parameterRoutes: readonly CompiledRoute<TContext>[];

  constructor(modules: readonly RouteModule<TContext>[]) {
    const moduleIds = new Set<string>();
    const routeIds = new Set<string>();
    const routePatterns = new Set<string>();
    const exactRoutes = new Map<string, CompiledRoute<TContext>>();
    const parameterRoutes: CompiledRoute<TContext>[] = [];
    const declarations: RouteDeclaration<TContext>[] = [];

    for (const module of modules) {
      validateRouteId(module.id, 'Route module ID');
      if (moduleIds.has(module.id)) {
        throw new Error(`Duplicate route module ID '${module.id}'`);
      }
      moduleIds.add(module.id);

      for (const declaration of module.routes) {
        validateRouteId(declaration.id, 'Route ID');
        if (routeIds.has(declaration.id)) {
          throw new Error(`Duplicate route ID '${declaration.id}'`);
        }
        routeIds.add(declaration.id);

        const pattern = compilePattern(declaration.pattern);
        if (routePatterns.has(pattern.normalized)) {
          throw new Error(`Duplicate route pattern '${pattern.normalized}'`);
        }
        routePatterns.add(pattern.normalized);

        const allowedMethods = normalizeMethods(declaration.methods, declaration.id);
        validateSameOriginPolicy(declaration.sameOrigin, allowedMethods, declaration.id);
        const route: CompiledRoute<TContext> = {
          declaration,
          pattern,
          allowedMethods,
        };

        if (pattern.parameterized) {
          for (const existing of parameterRoutes) {
            if (parameterPatternsOverlap(existing.pattern, pattern)) {
              throw new Error(
                `Ambiguous route patterns '${existing.pattern.normalized}' and '${pattern.normalized}'`,
              );
            }
          }
          parameterRoutes.push(route);
        } else {
          exactRoutes.set(pattern.normalized, route);
        }
        declarations.push(declaration);
      }
    }

    this.declarations = Object.freeze(declarations);
    this.moduleIds = Object.freeze([...moduleIds]);
    this.exactRoutes = exactRoutes;
    this.parameterRoutes = Object.freeze(parameterRoutes);
  }

  match(method: string, path: string): RouteMatchResult<TContext> {
    const normalizedPath = normalizeRoutePath(path);
    const exactRoute = this.exactRoutes.get(normalizedPath);
    if (exactRoute) {
      return resultForMethod(exactRoute, method, Object.freeze({}));
    }

    for (const route of this.parameterRoutes) {
      const params = matchParameterizedPattern(route.pattern, normalizedPath);
      if (params) return resultForMethod(route, method, params);
    }

    return { status: 'not-found', statusCode: 404 };
  }
}

export function createRouteRegistry<TContext = unknown>(
  modules: readonly RouteModule<TContext>[],
): RouteRegistry<TContext> {
  return new RouteRegistry(modules);
}

export function matchRoute<TContext = unknown>(
  registry: RouteRegistry<TContext>,
  method: string,
  path: string,
): RouteMatchResult<TContext> {
  return registry.match(method, path);
}
