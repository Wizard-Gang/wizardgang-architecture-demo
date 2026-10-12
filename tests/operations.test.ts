import { describe, expect, it } from 'vitest';
import { runScheduledOperations } from '../src/index';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

function env(): Env {
  return { WG_DB: new SqliteD1(), GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo', GITHUB_BRANCH: 'main' };
}

describe('operations machine behavior', () => {
  it('runs scheduled health independently', async () => {
    const environment = env();
    await runScheduledOperations(environment, Date.parse('2026-09-02T12:05:00.000Z'));
    expect((environment.WG_DB as SqliteD1).records('health').size).toBe(1);
  });
});
