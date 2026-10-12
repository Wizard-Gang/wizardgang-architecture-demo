import { describe, expect, it } from 'vitest';
import { billingScenarioResponse } from '../src/api/billing';
import { workerComputeResponse } from '../src/api/runtime';
import { runScheduledOperations } from '../src/index';
import { routeUrl } from '../src/routing/application-routes';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

function env(): Env {
  return { WG_DB: new SqliteD1(), GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo', GITHUB_BRANCH: 'main', BILLING_DEMO_MONTHLY_BUDGET_USD: '10' };
}

describe('operations machine behavior', () => {
  it('retains workload behavior across each simulator state and recovery', async () => {
    const environment = env();
    for (const state of ['normal', 'warning', 'degraded', 'normal']) {
      const response = await billingScenarioResponse(new Request('https://demo.example' + routeUrl('operations.api-budget'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: state }) }), environment);
      expect(await response.json()).toMatchObject({ state, optionalWorkerCompute: state === 'degraded' ? 'paused' : 'available' });
      const compute = await workerComputeResponse(new Request('https://demo.example/api/labs/workers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'sum', values: [1, 2] }) }), environment);
      expect(compute.status).toBe(state === 'degraded' ? 429 : 200);
    }
  });

  it('runs scheduled health independently', async () => {
    const environment = env();
    await runScheduledOperations(environment, Date.parse('2026-09-02T12:05:00.000Z'));
    expect((environment.WG_DB as SqliteD1).records('health').size).toBe(1);
  });
});
