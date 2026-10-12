import type { PageMetadata } from './application-routes';

export interface RegisteredRouteMetadataView {
  id: string;
  pattern: string;
  methods: readonly string[];
  kind: string;
  visibility: 'public' | 'private';
  crawler: { crawling: string; indexing: 'allow' | 'deny' };
  documentation: { title: string; description: string };
  source: { module: string; exportName?: string; tests?: readonly string[] };
  page?: PageMetadata;
}

let registeredRoutes: readonly RegisteredRouteMetadataView[] = Object.freeze([]);

export function configureRegisteredRoutes(routes: readonly RegisteredRouteMetadataView[]): void {
  registeredRoutes = Object.freeze([...routes]);
}

export function registeredRouteMetadata(): readonly RegisteredRouteMetadataView[] {
  return registeredRoutes;
}

function registeredPages(): RegisteredRouteMetadataView[] {
  return registeredRoutes
    .filter((route) => route.kind === 'page' && route.page)
    .sort((left, right) => (left.page?.order ?? 0) - (right.page?.order ?? 0) || left.id.localeCompare(right.id));
}

export function primaryNavigation(): RegisteredRouteMetadataView[] {
  const root = registeredPages().find((route) => !route.page?.parent);
  if (!root) return [];
  return registeredPages()
    .filter((route) => (
      route.page?.navigation === 'primary'
      && route.page.parent === root.id
      && route.visibility === 'public'
      && route.methods.includes('GET')
    ));
}

/** Project only the visitor-facing MVP product destinations into the homepage architecture map. */
export function architectureMapEntries(): RegisteredRouteMetadataView[] {
  return registeredPages()
    .filter((route) => (
      route.visibility === 'public'
      && route.methods.includes('GET')
      && Boolean(route.page?.parent)
      && route.page?.architectureMap === true
      && !route.pattern.includes(':')
    ));
}

export function sitemapPaths(): string[] {
  return registeredPages()
    .filter((route) => route.visibility === 'public' && route.crawler.indexing === 'allow' && !route.pattern.includes(':'))
    .map((route) => route.pattern);
}
