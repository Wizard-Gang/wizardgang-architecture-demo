import type { Env } from '../types';
import { HttpError } from './http';
import { COLLECTIONS, TTL_SECONDS, demoRecords } from './storage';

// The REST demo and the MCP tool share one record shape. Each namespace (a visitor session or `public`) owns its rows
// in the shared records table; the record id is `<namespace>/<key>`, so a list by owner comes back in key order.
// Neither part may contain `/`, so ids never collide.

export interface DemoRecord {
  namespace: string;
  key: string;
  value: unknown;
  createdAt: string;
  updatedAt: string;
}

export const PUBLIC_NAMESPACE = 'public';
const LIST_LIMIT = 100;
const SEEDED_AT = '2026-08-31T00:00:00.000Z';

function publicRecord(key: string, value: Record<string, string>): DemoRecord {
  return Object.freeze({ namespace: PUBLIC_NAMESPACE, key, value: Object.freeze(value), createdAt: SEEDED_AT, updatedAt: SEEDED_AT });
}

// No principal can write the public namespace (every writer carries a sandbox namespace), so the public catalogue is
// fixed content served from code rather than seeded rows.
const PUBLIC_RECORDS: readonly DemoRecord[] = Object.freeze([
  publicRecord('integration-graphql', { layer: 'Integration', route: '/api', binding: '/graphql', summary: 'Schema-driven reads resolving against the same records and the same policy as REST.' }),
  publicRecord('integration-mcp', { layer: 'AI Integration', route: '/mcp', binding: 'list_demo_records', summary: 'JSON-RPC tool operating inside ordinary application permissions and data limits.' }),
  publicRecord('integration-rest', { layer: 'Integration', route: '/api', binding: '/api/labs/rest-demo-records', summary: 'Versioned REST/JSON resource endpoints isolated by a signed visitor-session cookie.' }),
  publicRecord('runtime-d1', { layer: 'Runtime', route: '/d1', binding: 'WG_DB -> wizardgang', summary: 'Shared records and events tables for application state and audit metadata, with per-row TTLs.' }),
  publicRecord('runtime-durable-objects', { layer: 'Runtime', route: '/durable-objects', binding: 'DEMO_COORDINATOR', summary: 'Coordinated stateful compute for requests that must agree on shared state.' }),
  publicRecord('runtime-edge', { layer: 'Runtime', route: '/edge', binding: 'Cloudflare global network', summary: 'Public edge boundary for DNS, TLS, CDN, routing, and security policy.' }),
  publicRecord('runtime-r2', { layer: 'Runtime', route: '/r2', binding: 'WG_R2 -> wizardgang/demo/', summary: 'Object storage for files and artifacts; D1 holds metadata and references only.' }),
  publicRecord('runtime-workers', { layer: 'Runtime', route: '/workers', binding: 'Worker script', summary: 'Stateless TypeScript compute mediating clients, platform state, and integrations.' }),
]);

function recordId(namespace: string, key: string): string {
  return `${namespace}/${key}`;
}

export async function listDemoRecords(env: Env, namespace: string): Promise<DemoRecord[]> {
  if (namespace === PUBLIC_NAMESPACE) return [...PUBLIC_RECORDS];
  const rows = await demoRecords(env).list<DemoRecord>(COLLECTIONS.demoRecords, { owner: namespace, limit: LIST_LIMIT });
  return rows.map((row) => row.body);
}

export async function findDemoRecord(env: Env, namespace: string, key: string): Promise<DemoRecord | null> {
  if (namespace === PUBLIC_NAMESPACE) return PUBLIC_RECORDS.find((record) => record.key === key) ?? null;
  return (await demoRecords(env).get<DemoRecord>(COLLECTIONS.demoRecords, recordId(namespace, key)))?.body ?? null;
}

/** Creates or replaces one record; `createdAt` is the existing record's when it is a replacement. */
export async function saveDemoRecord(env: Env, record: DemoRecord): Promise<void> {
  if (record.namespace === PUBLIC_NAMESPACE) throw new HttpError(403, 'public_records_read_only');
  await demoRecords(env).put(COLLECTIONS.demoRecords, recordId(record.namespace, record.key), record, {
    owner: record.namespace,
    ttlSeconds: TTL_SECONDS.sandbox,
  });
}

export async function deleteDemoRecord(env: Env, namespace: string, key: string): Promise<boolean> {
  if (namespace === PUBLIC_NAMESPACE) throw new HttpError(403, 'public_records_read_only');
  return demoRecords(env).delete(COLLECTIONS.demoRecords, recordId(namespace, key));
}
