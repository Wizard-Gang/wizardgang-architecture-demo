import { describe, expect, it } from 'vitest';
import { applicationRouteRegistry, routeUrl } from '../src/routing/application-routes';
import { architectureMapEntries, primaryNavigation } from '../src/routing/navigation';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

const repositoryUrl = 'https://github.com/Wizard-Gang/wizardgang-architecture-demo';
const availability = new SqliteD1();
availability.putRecord('availability', '2026-09-01', { verified: 60, operational: 59, intentional: 1 });
availability.putRecord('availability', '2026-09-02', { verified: 41, operational: 40, intentional: 0 });
const env = {
  WG_DB: availability,
  GITHUB_REPO_URL: repositoryUrl,
  GITHUB_BRANCH: 'main',
  DEPLOYED_VERSION: 'v0.21.0-test',
  DEPLOYED_SHA: 'abcdef0123456789',
} as Env;

async function homeHtml(): Promise<string> {
  const route = applicationRouteRegistry.declarations.find((candidate) => candidate.id === 'interfaces.frontend.index');
  if (!route) throw new Error('Missing homepage route');
  return (await route.handler(new Request('https://demo.wizardgang.ai/'), { env }, {})).text();
}

describe('DEMO-256 minimal public shell', () => {
  it('limits primary navigation to Demos while keeping Source direct', async () => {
    expect(primaryNavigation().map((route) => route.id)).toEqual(['demos.index']);
    const html = await homeHtml();
    const header = html.match(/<header class="site-header">([\s\S]*?)<\/header>/)?.[0] ?? '';
    const nav = header.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/)?.[0] ?? '';
    expect(nav).toContain(`href="${routeUrl('demos.index')}"`);
    expect(nav).not.toContain('href="/operations"');
    expect(header).toContain(`href="${repositoryUrl}" aria-label="Source"><span class="utility-label">Source`);
  });

  it('uses one primary CTA and a compact live proof strip', async () => {
    const html = await homeHtml();
    const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[0] ?? '';
    expect(main).toContain(`class="button-primary" href="${routeUrl('demos.index')}">Explore demos</a>`);
    expect(main).toContain('aria-label="Live proof"');
    expect(main).toContain('Current service state');
    expect(main).toContain('99.000%');
    expect(main).toContain('100 measured intervals · planned offline excluded');
    expect(main).toContain('v0.21.0-test');
    expect(main).toContain('Commit abcdef0');
    expect(main).not.toContain('href="/operations"');
  });

  it('keeps operations out of visitor-facing projections', async () => {
    expect(primaryNavigation().map((route) => route.id)).not.toContain('operations.index');
    expect(architectureMapEntries().map((route) => route.id)).toEqual(['demos.index']);
    expect(applicationRouteRegistry.declarations.find((route) => route.id === 'operations.index')).toBeUndefined();
  });
});
