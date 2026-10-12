import { describe, expect, it } from 'vitest';
import type { ApplicationRouteDeclaration } from '../src/routing/application-routes';
import { buildRouteManifest, serializeRouteManifest } from '../src/routing/artifacts';

function pageRoute(
  id: string,
  pattern: string,
  navigation: 'primary' | 'none' = 'primary',
): ApplicationRouteDeclaration {
  return {
    id,
    pattern,
    methods: ['GET'],
    kind: 'page',
    handler: () => new Response('ok'),
    browserHtml: 'page',
    authentication: { mode: 'anonymous' },
    authorization: { mode: 'none' },
    visibility: 'public',
    sameOrigin: { mode: 'not-required' },
    offline: { mode: 'gated' },
    cache: { mode: 'no-store' },
    crawler: { crawling: 'controlled', indexing: 'allow' },
    documentation: {
      title: id,
      description: 'Synthetic route manifest projection for ' + id,
    },
    source: { module: 'tests/route-artifacts.test.ts' },
    page: {
      parent: 'interfaces.frontend.index',
      label: id,
      summary: 'Synthetic page for the route serializer',
      order: 1,
      navigation,
      architectureMap: true,
    },
  };
}

describe('route manifest serializer', () => {
  it('serializes in stable route-ID order with the same formatted bytes regardless of input order', () => {
    const declarations = [
      pageRoute('z.detail', '/items/:itemId'),
      pageRoute('a.index', '/about'),
    ];
    const expected = buildRouteManifest(declarations);
    const serialized = serializeRouteManifest(declarations);

    expect(serialized).toBe(JSON.stringify(expected, null, 2) + '\n');
    expect(serialized).toBe(serializeRouteManifest([...declarations].reverse()));
    expect(expected.map((entry) => entry.id)).toEqual(['a.index', 'z.detail']);
    expect(expected[0]).toMatchObject({
      route: '/about',
      kind: 'page',
      browser_html: 'page',
      navigation: { parent: 'interfaces.frontend.index', sitemap: true },
      status: 'working',
    });
    expect(expected[1]).toMatchObject({
      route: '/items/{itemId}',
      navigation: { sitemap: false },
    });
  });

  it('omits non-navigation page metadata without changing declared route policies', () => {
    const declarations = [pageRoute('z.hidden', '/hidden', 'none')];
    const projected = buildRouteManifest(declarations)[0];

    expect(projected).not.toHaveProperty('navigation');
    expect(projected).toMatchObject({
      id: 'z.hidden',
      methods: ['GET'],
      authentication: { mode: 'anonymous' },
      authorization: { mode: 'none' },
      crawler: { crawling: 'controlled', indexing: 'allow' },
      source: { module: 'tests/route-artifacts.test.ts' },
    });
    expect(serializeRouteManifest(declarations)).toContain('"status": "working"');
  });
});
