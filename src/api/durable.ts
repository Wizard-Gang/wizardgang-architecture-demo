import type { Env } from '../types';
import { recordDemoEvent } from '../lib/audit';
import { json, methodNotAllowed } from '../lib/http';

export async function durableCounterResponse(request: Request, env: Env): Promise<Response> {
  if (!['GET', 'POST'].includes(request.method)) return methodNotAllowed(['GET', 'POST']);
  if (!env.DEMO_COORDINATOR) return json({ error: 'durable_object_not_configured' }, { status: 503 });
  const id = env.DEMO_COORDINATOR.idFromName('public-counter');
  const stub = env.DEMO_COORDINATOR.get(id);
  const endpoint = request.method === 'POST' ? 'https://durable-object/increment' : 'https://durable-object/';
  const response = await stub.fetch(new Request(endpoint, { method: request.method }));
  if (!response.ok) return json({ error: 'durable_object_unavailable' }, { status: 503 });
  const state = await response.json() as { counter: number };
  if (request.method === 'POST') {
    const event = await recordDemoEvent(env, 'durable-objects', 'counter_incremented', { counter: state.counter, objectName: 'public-counter' });
    return json({ ...state, coordination: 'Durable Object', persistence: 'Durable Object storage', auditEventId: event.id });
  }
  return json({ ...state, coordination: 'Durable Object', persistence: 'Durable Object storage' });
}
