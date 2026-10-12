import { bucket, events, records, sweepExpired } from '#wg-edge';
import type { Bucket, EdgeEnv, Events, Records, StoredEvent } from '#wg-edge';
import type { Env } from '../types';

// The demo stores everything in baseline's shared `wizardgang` D1 records/events tables (binding WG_DB) and under
// `demo/` in the shared `wizardgang` R2 bucket (binding WG_R2), through the vendored wg-edge helpers. Baseline owns
// the only schema (platform/migrations/0001_universal.sql); the demo ships no DDL and no tables of its own.

// The Worker keeps its current name until DEMO-459 adopts the shell, so the storage identity is named here rather
// than read from a WG_APP var (the same choice as derived-keys.ts). Every row binds app 'demo'; every key is `demo/…`.
const DEMO_APP = 'demo';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Records collections. One place names them, so a typo cannot fork a collection. */
export const COLLECTIONS = {
  control: 'control',
  demoSessions: 'demo-sessions',
  labUsers: 'lab-users',
  labTasks: 'lab-tasks',
  demoRecords: 'demo-records',
  identitySessions: 'identity-sessions',
  samlRequests: 'saml-requests',
  samlAssertions: 'saml-assertions',
  r2Objects: 'r2-objects',
  webhookDeliveries: 'webhook-deliveries',
  health: 'health',
  availability: 'availability',
} as const;

/** Event kinds. */
export const KINDS = {
  audit: 'audit',
} as const;

/** Every TTL in seconds. The scheduled sweeper deletes expired rows; reads treat them as absent before that. */
export const TTL_SECONDS = {
  /** A visitor sandbox lives as long as its 24-hour demo session cookie. */
  sandbox: DAY,
  auditEvent: 30 * DAY,
  githubDelivery: 30 * DAY,
  /** Raw five-minute observations are kept only until their day's availability record is final. */
  healthObservation: 2 * DAY,
  /** One availability record per UTC day; the home page sums the retained days. */
  availabilityDay: 365 * DAY,
} as const;

function edgeEnv(env: Partial<Pick<Env, 'WG_DB' | 'WG_R2'>>): EdgeEnv {
  return { WG_APP: DEMO_APP, WG_DB: env.WG_DB, WG_R2: env.WG_R2 };
}

export function demoRecords(env: Pick<Env, 'WG_DB'>): Records {
  return records(edgeEnv(env));
}

export function demoEvents(env: Pick<Env, 'WG_DB'>): Events {
  return events(edgeEnv(env));
}

/** The shared R2 bucket seen through the `demo/` prefix, or null when WG_R2 is not bound (local tests without R2). */
export function demoBucket(env: Pick<Env, 'WG_R2'>): Bucket | null {
  return env.WG_R2 ? bucket(edgeEnv(env)) : null;
}

export function sweepDemoStorage(env: Pick<Env, 'WG_DB'>, now = Date.now()): Promise<{ records: number; events: number }> {
  return sweepExpired(edgeEnv(env), { now: () => now });
}

/** Seconds from now until an ISO or millisecond expiry, at least 1 so a just-expiring row still gets a valid TTL. */
export function secondsUntil(expiresAt: string | number, now = Date.now()): number {
  const at = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
  return Math.max(1, Math.ceil((at - now) / 1000));
}

const PAGE = 1000;
const WINDOWS_SECONDS = [HOUR, DAY] as const;

/**
 * The newest `limit` events of one kind that pass `match`, newest first. wg-edge lists events oldest first from
 * `since`, so this reads widening windows (one hour, one day, then the whole TTL) and keeps the tail of each pass.
 * Rows that share a millisecond come back in insertion order, so a page boundary resumes at that millisecond and
 * skips the rows it has already seen. Callers bound the cost by giving each kind a short TTL.
 */
export async function latestEvents<T>(
  env: Pick<Env, 'WG_DB'>,
  kind: string,
  limit: number,
  ttlSeconds: number,
  match: (body: T) => boolean = () => true,
  now = Date.now(),
): Promise<Array<StoredEvent<T>>> {
  const store = demoEvents(env);
  const windows = [...WINDOWS_SECONDS.filter((seconds) => seconds < ttlSeconds), ttlSeconds];
  let kept: Array<StoredEvent<T>> = [];
  for (const seconds of windows) {
    kept = [];
    let since = Math.max(0, now - seconds * 1000);
    let seenAtSince = 0;
    for (;;) {
      const page = await store.list<T>(kind, { since, limit: PAGE });
      const fresh = page.slice(Math.min(seenAtSince, page.length));
      for (const event of fresh) {
        if (!match(event.body)) continue;
        kept.push(event);
        if (kept.length > limit) kept.shift();
      }
      if (page.length < PAGE) break;
      const lastAt = page[page.length - 1].at;
      // A full page inside one millisecond cannot advance `since`; stop rather than re-read it forever.
      if (lastAt === since) break;
      seenAtSince = page.filter((event) => event.at === lastAt).length;
      since = lastAt;
    }
    if (kept.length >= limit) break;
  }
  return kept.reverse();
}
