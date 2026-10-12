import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Test doubles for the shared `wizardgang` bindings. SqliteD1 is a real SQLite database carrying baseline's vendored
// schema (platform/migrations/*.sql), so the wg-edge helpers run their actual SQL against STRICT tables and
// json_valid checks. MemoryR2 keeps whole keys (including the `demo/` prefix) in a Map.

const SCHEMA_DIRECTORY = path.join(process.cwd(), 'platform', 'migrations');

type Value = string | number | bigint | null | Uint8Array;

export class SqliteD1 {
  readonly db = new DatabaseSync(':memory:');
  /** Every prepared SQL string, in order, and the values each bound statement carried. */
  readonly queries: string[] = [];
  readonly binds: unknown[][] = [];
  /** Set to make every statement throw, as an unreachable database would. */
  failing = false;

  constructor() {
    for (const file of fs.readdirSync(SCHEMA_DIRECTORY).filter((name) => name.endsWith('.sql')).sort()) {
      this.db.exec(fs.readFileSync(path.join(SCHEMA_DIRECTORY, file), 'utf8'));
    }
  }

  prepare(sql: string) {
    this.queries.push(sql);
    const statement = () => {
      if (this.failing) throw new Error('D1 unavailable');
      return this.db.prepare(sql);
    };
    const bound = (values: Value[]) => ({
      async first<T>() { return (statement().get(...values) as T | undefined) ?? null; },
      async all<T>() { return { results: statement().all(...values) as T[] }; },
      async run() { return { meta: { changes: Number(statement().run(...values).changes) } }; },
    });
    return {
      bind: (...values: unknown[]) => {
        this.binds.push(values);
        return bound(values as Value[]);
      },
      ...bound([]),
    };
  }

  /** The demo's live rows in one collection, as stored bodies keyed by record id. */
  records<T = unknown>(collection: string, app = 'demo'): Map<string, { body: T; owner: string | null; expiresAt: number | null }> {
    const rows = this.db.prepare('SELECT id, body, owner, expires_at FROM records WHERE app = ? AND collection = ? ORDER BY id')
      .all(app, collection) as Array<{ id: string; body: string; owner: string | null; expires_at: number | null }>;
    return new Map(rows.map((row) => [row.id, { body: JSON.parse(row.body) as T, owner: row.owner, expiresAt: row.expires_at }]));
  }

  /** The demo's events of one kind, oldest first. */
  events<T = unknown>(kind: string, app = 'demo'): Array<{ at: number; body: T; expiresAt: number | null }> {
    const rows = this.db.prepare('SELECT at, body, expires_at FROM events WHERE app = ? AND kind = ? ORDER BY at, rowid')
      .all(app, kind) as Array<{ at: number; body: string; expires_at: number | null }>;
    return rows.map((row) => ({ at: row.at, body: JSON.parse(row.body) as T, expiresAt: row.expires_at }));
  }

  /** Every stored record and event body as text, for asserting that nothing secret was persisted. */
  dump(): string {
    const rows = this.db.prepare('SELECT body FROM records UNION ALL SELECT body FROM events').all() as Array<{ body: string }>;
    return rows.map((row) => row.body).join('\n');
  }

  /** Audit events in the old demo_events row shape, newest first. */
  demoEventRows(): Array<{ id: number; demo_id: string; event_type: string; payload_json: string | null; created_at: string }> {
    return this.events<{ demoId: string; eventType: string; payload: unknown; createdAt: string }>('audit').reverse().map(({ at, body }) => ({
      id: at, demo_id: body.demoId, event_type: body.eventType, payload_json: JSON.stringify(body.payload ?? null), created_at: body.createdAt,
    }));
  }

  /** Identity sessions keyed by the SHA-256 of their session id. */
  identitySessions(): Map<string, { payload: string; expiresAt: string; revokedAt: string | null }> {
    return new Map([...this.records<{ payload: string; expiresAt: string; revokedAt: string | null }>('identity-sessions')].map(([id, row]) => [id, row.body]));
  }

  /** Audit and log events in insertion order as { type, payload }: the audit event type or log key and its detail. */
  auditTrail(): Array<{ type: string; payload: string }> {
    const rows = this.db.prepare("SELECT kind, body FROM events WHERE app = 'demo' ORDER BY rowid").all() as Array<{ kind: string; body: string }>;
    return rows.map((row) => {
      const body = JSON.parse(row.body) as Record<string, unknown>;
      return row.kind === 'audit'
        ? { type: String(body.eventType), payload: JSON.stringify(body.payload ?? null) }
        : { type: String(body.event_key), payload: String(body.detail_json ?? '') };
    });
  }

  /** Inserts a raw record, for seeding state the code would otherwise have written earlier. */
  putRecord(collection: string, id: string, body: unknown, options: { owner?: string | null; expiresAt?: number | null; app?: string } = {}): void {
    const now = Date.now();
    this.db.prepare('INSERT OR REPLACE INTO records (app, collection, id, body, owner, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(options.app ?? 'demo', collection, id, JSON.stringify(body), options.owner ?? null, now, now, options.expiresAt ?? null);
  }
}

interface StoredObject {
  body: string | ArrayBuffer;
  httpMetadata?: { contentType?: string };
}

export class MemoryR2 {
  readonly objects = new Map<string, StoredObject>();

  async put(key: string, value: string | ArrayBuffer | ReadableStream<Uint8Array>, options: { httpMetadata?: { contentType?: string } } = {}) {
    const body = typeof value === 'string' || value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer();
    this.objects.set(key, { body, httpMetadata: options.httpMetadata });
    return { key };
  }

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    const bytes = typeof object.body === 'string' ? new TextEncoder().encode(object.body).buffer : object.body;
    return {
      key,
      size: bytes.byteLength,
      httpMetadata: object.httpMetadata,
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => bytes,
    };
  }

  async head(key: string) {
    return this.objects.has(key) ? { key } : null;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async list({ prefix = '', limit = 1000 }: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort().slice(0, limit);
    return { objects: keys.map((key) => ({ key })), truncated: false };
  }
}

/** Fresh shared bindings for one test environment. */
export function wgStorage(): { WG_DB: SqliteD1; WG_R2: MemoryR2 } {
  return { WG_DB: new SqliteD1(), WG_R2: new MemoryR2() };
}

/** A shared database already holding the demo's control records and, optionally, availability counts. */
export function demoDatabase(options: {
  demo?: 'online' | 'offline';
  message?: string;
  crawler?: 'enabled' | 'disabled';
  availability?: { verified: number; operational: number; intentional: number };
} = {}): SqliteD1 {
  const db = new SqliteD1();
  const demo = options.demo ?? 'online';
  db.putRecord('control', 'demo', { state: demo, publicMessage: options.message ?? (demo === 'online' ? 'Available.' : 'Planned maintenance.'), updatedAt: '2026-09-01T00:00:00.000Z', updatedBy: 'test' });
  db.putRecord('control', 'crawler', { state: options.crawler ?? 'disabled', updatedAt: '2026-09-01T00:00:00.000Z', updatedBy: 'test' });
  if (options.availability) db.putRecord('availability', '2026-09-01', options.availability);
  return db;
}
