import { describe, expect, it } from 'vitest';
import { applicationRouteRegistry } from '../src/routing/application-routes';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

const env: Env = {
  WG_DB: new SqliteD1(),
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
};

function currentPageCount(html: string): number {
  return (html.match(/<[a-z][^>]*\baria-current="page"[^>]*>/gi) ?? []).length;
}

describe('derived frontend navigation', () => {
  it('renders only the primary MVP product destinations in the header', async () => {
    const route = applicationRouteRegistry.declarations.find((candidate) => candidate.id === 'demos.index');
    if (!route) throw new Error('Missing demos.index route');
    const html = await (await route.handler(new Request('https://demo.wizardgang.ai/demos'), { env }, {})).text();
    const primary = html.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/)?.[0] ?? '';
    expect(primary).not.toBe('');
    expect(primary).toContain('>Demos</a>');
    for (const label of ['Architecture', 'Platform', 'Interfaces', 'Operations', 'Security']) {
      expect(primary).not.toContain(`>${label}</a>`);
    }
    expect(html).toContain('<span class="utility-label">Source</span><span class="utility-icon" aria-hidden="true">↗</span></a>');
  });

  it('marks Demos as the current task on /demos#d1', async () => {
    const route = applicationRouteRegistry.declarations.find((candidate) => candidate.id === 'demos.index');
    if (!route) throw new Error('Missing demos.index route');
    const html = await (await route.handler(new Request('https://demo.wizardgang.ai/demos#d1'), { env }, {})).text();
    expect(currentPageCount(html)).toBe(1);
    expect(html).toContain(`<a href="${route.pattern}" aria-current="page">Demos</a>`);
    expect(html).not.toContain('name="view"');
    expect(html).not.toContain(`${route.pattern}?view=`);
  });
});
