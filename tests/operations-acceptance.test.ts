import { describe, expect, it } from 'vitest';
import { routeRequest } from '../src/router';
import { applicationRouteRegistry, routeUrl } from '../src/routing/application-routes';
import { architectureMapEntries, primaryNavigation } from '../src/routing/navigation';
import type { Env } from '../src/types';
import { retiredOperationsHtmlPathname } from './fixtures/removed-html-pathnames';
import { demoDatabase } from './helpers/wg-storage';

function environment(offline = false): Env {
  return {
    GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
    GITHUB_BRANCH: 'main',
    DEPLOYED_VERSION: 'v0.21.0-test',
    DEPLOYED_SHA: 'abcdef0123456789',
    WG_DB: demoDatabase({ demo: offline ? 'offline' : 'online', message: 'Acceptance fixture', crawler: 'enabled' }),
  } as Env;
}

async function request(path: string, env = environment()): Promise<Response> {
  return routeRequest(new Request(`https://demo.example${path}`, { headers: { accept: 'text/html' } }), env);
}

describe('DEMO-259 operations retirement acceptance', () => {
  it('lets the retired operations page and query variants fall through to the ordinary application 404 without redirect or alias', async () => {
    for (const path of [retiredOperationsHtmlPathname, `${retiredOperationsHtmlPathname}?anything=still-retired`, `${retiredOperationsHtmlPathname}?view=overview`]) {
      const response = await request(path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get('location'), path).toBeNull();
    }
    expect(applicationRouteRegistry.declarations.some((route) => route.id === 'operations.index')).toBe(false);
    expect(applicationRouteRegistry.declarations.some((route) => route.pattern === retiredOperationsHtmlPathname)).toBe(false);
  });

  it('keeps required operations machine endpoints registered and working', async () => {
    const routeIds = new Set(applicationRouteRegistry.declarations.map((route) => route.id));
    for (const id of ['operations.health', 'operations.version']) {
      expect(routeIds.has(id), id).toBe(true);
    }

    const health = await request(routeUrl('operations.health'));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'operational', services: { worker: 'operational', d1: 'operational' } });

    const version = await request(routeUrl('operations.version'));
    expect(version.status).toBe(200);
    expect(await version.json()).toMatchObject({ version: 'v0.21.0-test', commit: 'abcdef0123456789', branch: 'main' });
  });

  it('keeps admin protected and offline recovery available', async () => {
    const admin = await request(routeUrl('operations.admin'));
    expect(admin.status).toBe(401);

    const offline = await request(routeUrl('operations.offline'), environment(true));
    expect(offline.status).toBe(503);
    expect(await offline.text()).toContain('Acceptance fixture');
  });

  it('does not advertise the retired page through navigation, architecture discovery, or sitemap', async () => {
    expect(primaryNavigation().map((route) => route.id)).not.toContain('operations.index');
    expect(architectureMapEntries().map((route) => route.id)).not.toContain('operations.index');

    const sitemap = await request(routeUrl('operations.sitemap'));
    expect(sitemap.status).toBe(200);
    expect(await sitemap.text()).not.toContain(`<loc>https://demo.example${retiredOperationsHtmlPathname}</loc>`);
  });
});
