import { describe, expect, it } from 'vitest';
import { runScheduledOperations } from '../src/index';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

function env(): Env {
  return { WG_DB: new SqliteD1(), GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo', GITHUB_BRANCH: 'main' };
}

describe('operations machine behavior', () => {
  it('only sweeps expired rows on the schedule', async () => {
    const environment = env();
    const db = environment.WG_DB as SqliteD1;
    db.putRecord('demo-records', 'session/expired', { key: 'expired' }, { owner: 'session', expiresAt: Date.parse('2026-09-01T00:00:00.000Z') });
    await runScheduledOperations(environment, Date.parse('2026-09-02T12:05:00.000Z'));
    expect(db.records('demo-records').size).toBe(0);
    expect(db.records('health').size).toBe(0);
  });
});
