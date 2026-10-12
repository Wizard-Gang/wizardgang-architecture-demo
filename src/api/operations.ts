import type { Env } from '../types';
import { json } from '../lib/http';
import { identityReadiness } from '../lib/identity-session';
import { COLLECTIONS, demoBucket, demoRecords } from '../lib/storage';

type Readiness = 'operational' | 'unavailable' | 'unconfigured';

export interface HealthSnapshot {
  status: 'operational' | 'degraded';
  checkedAt: string;
  identity: 'ready' | 'not-configured';
  services: {
    worker: 'operational';
    d1: Readiness;
    r2: Readiness;
    durableObjects: Readiness;
  };
  responseMs: Partial<Record<'d1' | 'r2' | 'durableObjects', number>>;
}

async function timed(check: () => Promise<unknown>): Promise<{ status: 'operational' | 'unavailable'; responseMs: number }> {
  const started = Date.now();
  try {
    await check();
    return { status: 'operational', responseMs: Date.now() - started };
  } catch {
    return { status: 'unavailable', responseMs: Date.now() - started };
  }
}

export async function collectHealth(env: Env): Promise<HealthSnapshot> {
  const checkedAt = new Date().toISOString();
  const objects = demoBucket(env);
  const d1 = await timed(() => demoRecords(env).get(COLLECTIONS.demoRecords, '__wizardgang_health_probe__'));
  const r2 = objects
    ? await timed(() => objects.head('__wizardgang_health_probe__'))
    : { status: 'unconfigured' as const, responseMs: 0 };
  const durableObjects = env.DEMO_COORDINATOR
    ? await timed(async () => {
      const id = env.DEMO_COORDINATOR!.idFromName('health');
      const response = await env.DEMO_COORDINATOR!.get(id).fetch(new Request('https://durable-object/'));
      if (!response.ok) throw new Error('Durable Object probe failed');
    })
    : { status: 'unconfigured' as const, responseMs: 0 };

  const dependencyFailure = [d1.status, r2.status, durableObjects.status].includes('unavailable');
  return {
    status: dependencyFailure ? 'degraded' : 'operational',
    checkedAt,
    identity: await identityReadiness(env),
    services: {
      worker: 'operational',
      d1: d1.status,
      r2: r2.status,
      durableObjects: durableObjects.status,
    },
    responseMs: {
      d1: d1.responseMs,
      ...(objects ? { r2: r2.responseMs } : {}),
      ...(env.DEMO_COORDINATOR ? { durableObjects: durableObjects.responseMs } : {}),
    },
  };
}

export async function healthResponse(env: Env): Promise<Response> {
  const snapshot = await collectHealth(env);
  return json(snapshot, { status: snapshot.status === 'operational' ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}

export function versionResponse(env: Env): Response {
  return json({
    service: 'wizardgang-architecture-demo',
    version: env.DEPLOYED_VERSION || 'development',
    commit: env.DEPLOYED_SHA || null,
    branch: env.GITHUB_BRANCH,
    repository: env.GITHUB_REPO_URL,
    environment: env.DEPLOYMENT_ENVIRONMENT || 'local',
    ci: env.DEPLOYMENT_CI_STATUS || null,
  }, { headers: { 'cache-control': 'no-store' } });
}
