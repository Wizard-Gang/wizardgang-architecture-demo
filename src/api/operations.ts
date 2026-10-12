import type { Env } from '../types';
import { getDemoControl } from '../lib/demo-control';
import { json } from '../lib/http';
import { identityReadiness } from '../lib/identity-session';
import { COLLECTIONS, TTL_SECONDS, demoBucket, demoRecords } from '../lib/storage';

type Readiness = 'operational' | 'unavailable' | 'unconfigured';

export const AVAILABILITY_INTERVAL_MINUTES = 5;
export const AVAILABILITY_RETENTION_DAYS = 365;
const DAY_MS = 86_400_000;

export interface HealthSnapshot {
  status: 'operational' | 'degraded' | 'offline';
  checkedAt: string;
  demo: { state: 'online' | 'offline'; message: string };
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

/** One scheduled five-minute observation, keyed by its scheduled slot so a scheduler retry replaces it. */
interface HealthObservation {
  status: 'operational' | 'degraded' | 'down';
  responseMs: number;
  intentionalOffline: boolean;
  observedAt: string;
  scheduledAt: string;
  services: HealthSnapshot['services'];
}

/** Scheduled observation counts for one UTC day. `imported` carries counts copied from the retired demo-blob history. */
export interface AvailabilityDay {
  verified: number;
  operational: number;
  intentional: number;
  imported?: { verified: number; operational: number; intentional: number };
}

/** Recounts a day from its retained observations and replaces that day's availability record. */
async function recordAvailabilityDay(env: Env, day: string): Promise<void> {
  const store = demoRecords(env);
  const observations = (await store.list<HealthObservation>(COLLECTIONS.health, { owner: day, limit: 1000 })).map((row) => row.body);
  const existing = (await store.get<AvailabilityDay>(COLLECTIONS.availability, day))?.body;
  const imported = existing?.imported ?? { verified: 0, operational: 0, intentional: 0 };
  const counted: AvailabilityDay = {
    verified: imported.verified + observations.length,
    operational: imported.operational + observations.filter((row) => row.status === 'operational').length,
    intentional: imported.intentional + observations.filter((row) => row.intentionalOffline).length,
    ...(existing?.imported ? { imported } : {}),
  };
  await store.put(COLLECTIONS.availability, day, counted, { ttlSeconds: TTL_SECONDS.availabilityDay });
}

/** The retained availability days (at most the 365-day TTL), oldest first. */
export async function availabilityDays(env: Env): Promise<AvailabilityDay[]> {
  return (await demoRecords(env).list<AvailabilityDay>(COLLECTIONS.availability, { limit: AVAILABILITY_RETENTION_DAYS + 1 })).map((row) => row.body);
}

export async function collectHealth(env: Env, persist = false, scheduledTime?: number): Promise<HealthSnapshot> {
  const checkedAt = new Date().toISOString();
  const control = await getDemoControl(env);
  const objects = demoBucket(env);
  const d1 = await timed(() => demoRecords(env).get(COLLECTIONS.control, 'demo'));
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
  const status = control.state === 'offline' ? 'offline' : dependencyFailure ? 'degraded' : 'operational';
  const snapshot: HealthSnapshot = {
    status,
    checkedAt,
    demo: { state: control.state, message: control.publicMessage },
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

  if (persist && d1.status === 'operational') {
    const persistedAt = new Date(scheduledTime ?? Date.now()).toISOString();
    try {
      // The scheduled timestamp is the observation's record id, so a scheduler retry of the same slot replaces it
      // instead of inflating uptime. Observations are owned by their UTC day, which the day's recount lists.
      const day = persistedAt.slice(0, 10);
      const observation: HealthObservation = {
        status: status === 'offline' ? 'down' : status,
        responseMs: d1.responseMs,
        intentionalOffline: control.state === 'offline',
        observedAt: checkedAt,
        scheduledAt: persistedAt,
        services: snapshot.services,
      };
      await demoRecords(env).put(COLLECTIONS.health, persistedAt, observation, { owner: day, ttlSeconds: TTL_SECONDS.healthObservation });
      await recordAvailabilityDay(env, day);
    } catch {
      // Health reporting should still respond even if history/log persistence is unavailable.
    }
  }

  return snapshot;
}

export async function healthResponse(env: Env): Promise<Response> {
  const snapshot = await collectHealth(env, false);
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
