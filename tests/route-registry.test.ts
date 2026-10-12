import { describe, expect, it } from 'vitest';
import {
  createRouteRegistry,
  defineRouteModule,
  matchRoute,
  type RouteDeclaration,
  type RouteMethod,
} from '../src/routing/registry';

const handler = () => new Response('ok');

function route(
  id: string,
  pattern: string,
  methods: readonly RouteMethod[] = ['GET'],
): RouteDeclaration<void> {
  return {
    id,
    pattern,
    methods,
    kind: 'page',
    handler,
    authentication: { mode: 'anonymous' },
    authorization: { mode: 'none' },
    visibility: 'public',
    sameOrigin: { mode: 'not-required' },
    cache: { mode: 'no-store' },
    crawler: { crawling: 'allow', indexing: 'allow' },
    documentation: {
      title: id,
      description: `Test route ${id}`,
    },
    source: {
      module: 'tests/route-registry.test.ts',
      exportName: 'handler',
      tests: ['tests/route-registry.test.ts'],
    },
  };
}

describe('declarative route registry', () => {
  it('lets independent capability modules contribute routes without a domain switch', () => {
    const registry = createRouteRegistry([
      defineRouteModule('records', [route('records.list', '/records')]),
      defineRouteModule('health', [route('health.read', '/healthz')]),
    ]);

    expect(registry.moduleIds).toEqual(['records', 'health']);
    expect(matchRoute(registry, 'GET', '/records')).toMatchObject({
      status: 'matched',
      route: { id: 'records.list', kind: 'page', visibility: 'public' },
    });
    expect(matchRoute(registry, 'GET', '/healthz')).toMatchObject({
      status: 'matched',
      route: { id: 'health.read' },
    });
  });

  it('gives exact routes precedence over parameter routes', () => {
    const registry = createRouteRegistry([
      defineRouteModule('articles', [
        route('articles.detail', '/articles/:articleId', ['GET']),
        route('articles.create-form', '/articles/new', ['POST']),
      ]),
    ]);

    expect(matchRoute(registry, 'POST', '/articles/new')).toMatchObject({
      status: 'matched',
      route: { id: 'articles.create-form' },
      params: {},
    });

    expect(matchRoute(registry, 'GET', '/articles/new')).toMatchObject({
      status: 'method-not-allowed',
      statusCode: 405,
      route: { id: 'articles.create-form' },
      allowedMethods: ['POST'],
    });
  });

  it('normalizes trailing slashes and decoded parameter values', () => {
    const registry = createRouteRegistry([
      defineRouteModule('teams', [
        route('teams.member', '/teams/:teamId/members/:memberId'),
      ]),
    ]);

    const result = matchRoute(
      registry,
      'GET',
      '/teams/alpha%20one/members/e%CC%81/',
    );

    expect(result).toMatchObject({
      status: 'matched',
      params: { teamId: 'alpha one', memberId: 'é' },
    });
  });

  it('rejects duplicate stable route IDs across capability modules', () => {
    expect(() => createRouteRegistry([
      defineRouteModule('alpha', [route('shared.route', '/alpha')]),
      defineRouteModule('beta', [route('shared.route', '/beta')]),
    ])).toThrow("Duplicate route ID 'shared.route'");
  });

  it('rejects duplicate normalized route patterns', () => {
    expect(() => createRouteRegistry([
      defineRouteModule('alpha', [route('alpha.route', '/same/')]),
      defineRouteModule('beta', [route('beta.route', '/same')]),
    ])).toThrow("Duplicate route pattern '/same'");
  });

  it('rejects parameter patterns that can match the same request path', () => {
    expect(() => createRouteRegistry([
      defineRouteModule('files', [
        route('files.edit', '/files/:folder/edit'),
        route('files.section', '/files/new/:action'),
      ]),
    ])).toThrow("Ambiguous route patterns '/files/:folder/edit' and '/files/new/:action'");
  });

  it('handles methods consistently and does not imply undeclared HEAD support', () => {
    const registry = createRouteRegistry([
      defineRouteModule('records', [
        route('records.item', '/records/:recordId', ['GET', 'POST']),
      ]),
    ]);

    expect(matchRoute(registry, 'post', '/records/ABC-123')).toMatchObject({
      status: 'matched',
      params: { recordId: 'ABC-123' },
    });
    expect(matchRoute(registry, 'DELETE', '/records/ABC-123')).toMatchObject({
      status: 'method-not-allowed',
      statusCode: 405,
      allowedMethods: ['GET', 'POST'],
    });
    expect(matchRoute(registry, 'HEAD', '/records/ABC-123')).toMatchObject({
      status: 'method-not-allowed',
      statusCode: 405,
      allowedMethods: ['GET', 'POST'],
    });
  });

  it('validates same-origin methods against the supported method contract', () => {
    const declaration = route('records.write', '/records', ['GET', 'POST']);
    declaration.sameOrigin = { mode: 'required', methods: ['POST'] };
    expect(() => createRouteRegistry([defineRouteModule('records', [declaration])])).not.toThrow();

    const invalid = route('records.invalid', '/invalid', ['GET']);
    invalid.sameOrigin = { mode: 'required', methods: ['POST'] };
    expect(() => createRouteRegistry([defineRouteModule('invalid', [invalid])]))
      .toThrow("requires same-origin for undeclared method 'POST'");
  });

  it('returns a standard 404 result for unknown and malformed parameter paths', () => {
    const registry = createRouteRegistry([
      defineRouteModule('records', [route('records.item', '/records/:recordId')]),
    ]);

    expect(matchRoute(registry, 'GET', '/unknown')).toEqual({
      status: 'not-found',
      statusCode: 404,
    });
    expect(matchRoute(registry, 'GET', '/records/%E0%A4%A')).toEqual({
      status: 'not-found',
      statusCode: 404,
    });
  });
});
