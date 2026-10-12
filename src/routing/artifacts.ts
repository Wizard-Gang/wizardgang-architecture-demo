import type { ApplicationRouteDeclaration } from './application-routes';

export interface RouteManifestEntry {
  id: string;
  route: string;
  methods: readonly string[];
  kind: ApplicationRouteDeclaration['kind'];
  visibility: ApplicationRouteDeclaration['visibility'];
  browser_html: ApplicationRouteDeclaration['browserHtml'];
  authentication: ApplicationRouteDeclaration['authentication'];
  authorization: ApplicationRouteDeclaration['authorization'];
  same_origin: ApplicationRouteDeclaration['sameOrigin'];
  offline: ApplicationRouteDeclaration['offline'];
  cache: ApplicationRouteDeclaration['cache'];
  crawler: ApplicationRouteDeclaration['crawler'];
  title: string;
  description: string;
  source: ApplicationRouteDeclaration['source'];
  navigation?: {
    parent?: string;
    label: string;
    order: number;
    navigation: 'primary' | 'secondary';
    architectureMap: boolean;
    sitemap: boolean;
  };
  status: 'working';
}

function publishedPattern(pattern: string): string {
  return pattern.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

function sitemapMember(route: ApplicationRouteDeclaration): boolean {
  return route.kind === 'page'
    && route.visibility === 'public'
    && route.crawler.indexing === 'allow'
    && !route.pattern.includes(':');
}

export function buildRouteManifest(
  declarations: readonly ApplicationRouteDeclaration[],
): RouteManifestEntry[] {
  return declarations
    .map((route) => ({
      id: route.id,
      route: publishedPattern(route.pattern),
      methods: [...route.methods],
      kind: route.kind,
      visibility: route.visibility,
      browser_html: route.browserHtml,
      authentication: route.authentication,
      authorization: route.authorization,
      same_origin: route.sameOrigin,
      offline: route.offline,
      cache: route.cache,
      crawler: route.crawler,
      title: route.documentation.title,
      description: route.documentation.description,
      source: route.source,
      ...(route.page && route.page.navigation !== 'none' ? {
        navigation: {
          ...(route.page.parent ? { parent: route.page.parent } : {}),
          label: route.page.label,
          order: route.page.order,
          navigation: route.page.navigation,
          architectureMap: route.page.architectureMap,
          sitemap: sitemapMember(route),
        },
      } : {}),
      status: 'working' as const,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function serializeRouteManifest(
  declarations: readonly ApplicationRouteDeclaration[],
): string {
  return `${JSON.stringify(buildRouteManifest(declarations), null, 2)}\n`;
}
