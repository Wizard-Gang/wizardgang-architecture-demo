import { describe, expect, it } from 'vitest';
import { deleteDemoRecord, listDemoRecords, saveDemoRecord } from '../src/lib/demo-records';
import { HttpError } from '../src/lib/http';
import { COLLECTIONS, KINDS, TTL_SECONDS, demoBucket, demoEvents, demoRecords, latestEvents, sweepDemoStorage } from '../src/lib/storage';
import type { Env } from '../src/types';
import { wgStorage, type MemoryR2, type SqliteD1 } from './helpers/wg-storage';

const HOUR_MS = 3_600_000;

function env(): Env & { WG_DB: SqliteD1; WG_R2: MemoryR2 } {
  return { ...wgStorage(), GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo', GITHUB_BRANCH: 'main' };
}

function insertEvent(db: SqliteD1, kind: string, at: number, body: unknown): void {
  db.db.prepare('INSERT INTO events (app, kind, at, body, expires_at) VALUES (?, ?, ?, ?, ?)').run('demo', kind, at, JSON.stringify(body), at + 7 * 24 * HOUR_MS);
}

describe('demo storage on the shared wizardgang tables', () => {
  it('scopes every row to app demo and every object to demo/', async () => {
    const environment = env();
    await demoRecords(environment).put(COLLECTIONS.control, 'demo', { state: 'online' });
    await demoEvents(environment).append(KINDS.audit, { demoId: 'test' }, { ttlSeconds: TTL_SECONDS.auditEvent });
    await demoBucket(environment)!.put('uploads/session/file.txt', 'bytes');
    const apps = environment.WG_DB.db.prepare('SELECT DISTINCT app FROM records UNION SELECT DISTINCT app FROM events').all() as Array<{ app: string }>;
    expect(apps.map((row) => row.app)).toEqual(['demo']);
    expect([...environment.WG_R2.objects.keys()]).toEqual(['demo/uploads/session/file.txt']);
  });

  it('returns the newest matching events first across page boundaries that split a millisecond', async () => {
    const environment = env();
    const now = Date.now();
    // 2,500 events, three per millisecond, so the 1,000-row pages end inside a shared millisecond.
    for (let index = 0; index < 2500; index += 1) insertEvent(environment.WG_DB, KINDS.audit, now - 30 * 60_000 + Math.floor(index / 3), { index });
    const latest = await latestEvents<{ index: number }>(environment, KINDS.audit, 10, TTL_SECONDS.auditEvent, () => true, now);
    expect(latest.map((event) => event.body.index)).toEqual([2499, 2498, 2497, 2496, 2495, 2494, 2493, 2492, 2491, 2490]);
    const every500th = await latestEvents<{ index: number }>(environment, KINDS.audit, 50, TTL_SECONDS.auditEvent, (body) => body.index % 500 === 0, now);
    expect(every500th.map((event) => event.body.index)).toEqual([2000, 1500, 1000, 500, 0]);
  });

  it('widens past the last hour and day until it has enough events, bounded by the TTL', async () => {
    const environment = env();
    const now = Date.now();
    insertEvent(environment.WG_DB, KINDS.audit, now - 10 * 24 * HOUR_MS, { age: 'beyond-ttl' });
    insertEvent(environment.WG_DB, KINDS.audit, now - 3 * 24 * HOUR_MS, { age: 'three-days' });
    insertEvent(environment.WG_DB, KINDS.audit, now - 5 * HOUR_MS, { age: 'five-hours' });
    insertEvent(environment.WG_DB, KINDS.audit, now - 60_000, { age: 'one-minute' });
    const latest = await latestEvents<{ age: string }>(environment, KINDS.audit, 10, 7 * 24 * 3600, () => true, now);
    expect(latest.map((event) => event.body.age)).toEqual(['one-minute', 'five-hours', 'three-days']);
  });

  it('sweeps only expired demo rows', async () => {
    const environment = env();
    environment.WG_DB.putRecord('control', 'demo', { state: 'online' });
    environment.WG_DB.putRecord('demo-sessions', 'expired', {}, { expiresAt: 1 });
    environment.WG_DB.putRecord('demo-sessions', 'other-app', {}, { expiresAt: 1, app: 'sharktank' });
    expect(await sweepDemoStorage(environment)).toEqual({ records: 1, events: 0 });
    expect(environment.WG_DB.records('demo-sessions').size).toBe(0);
    expect(environment.WG_DB.records('demo-sessions', 'sharktank').size).toBe(1);
    expect(environment.WG_DB.records('control').size).toBe(1);
  });

  it('serves the public catalogue from code and refuses to write it', async () => {
    const environment = env();
    const catalogue = await listDemoRecords(environment, 'public');
    expect(catalogue.map((record) => record.key)).toEqual([...catalogue.map((record) => record.key)].sort());
    expect(catalogue.find((record) => record.key === 'runtime-d1')?.value).toMatchObject({ binding: 'WG_DB -> wizardgang' });
    const write = saveDemoRecord(environment, { namespace: 'public', key: 'x', value: 1, createdAt: '', updatedAt: '' });
    await expect(write).rejects.toBeInstanceOf(HttpError);
    await expect(deleteDemoRecord(environment, 'public', 'runtime-d1')).rejects.toBeInstanceOf(HttpError);
    expect(environment.WG_DB.queries).toEqual([]);
  });
});
