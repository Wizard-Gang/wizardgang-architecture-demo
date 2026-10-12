import type { Env } from '../types';
import { recordDemoEvent } from '../lib/audit';
import { HttpError, errorResponse, json, methodNotAllowed, readJson } from '../lib/http';

interface ComputeInput {
  operation?: unknown;
  values?: unknown;
  request?: unknown;
}

export async function edgeInspectionResponse(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf ?? {};
  const allowedCfFields = ['colo', 'country', 'region', 'city', 'timezone', 'httpProtocol', 'tlsVersion', 'asOrganization'];
  const edge = Object.fromEntries(allowedCfFields.filter((key) => cf[key] !== undefined).map((key) => [key, cf[key]]));
  return json({
    deliveredBy: 'Cloudflare Worker',
    request: { method: request.method, protocol: new URL(request.url).protocol, host: new URL(request.url).host, accepts: request.headers.get('accept') || null },
    edge,
    delivery: { cacheControl: 'no-store', boundary: 'Cloudflare Worker' },
    privacy: 'Client IP addresses, cookies, authorization, and raw request headers are intentionally excluded.',
  }, { headers: { 'cache-control': 'no-store' } });
}

export async function workerComputeResponse(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  try {
    const body = await readJson<ComputeInput>(request, 4096);
    const operation = typeof body.operation === 'string' ? body.operation : '';
    if (operation === 'edge-policy') {
      if (!body.request || typeof body.request !== 'object' || Array.isArray(body.request)) throw new HttpError(400, 'invalid_request');
      const candidate = body.request as Record<string, unknown>;
      const method = typeof candidate.method === 'string' ? candidate.method.toUpperCase() : '';
      const path = typeof candidate.path === 'string' ? candidate.path.trim() : '';
      const hasCookie = candidate.hasCookie === true;
      const hasAuthorization = candidate.hasAuthorization === true;
      if (!['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new HttpError(400, 'invalid_method');
      if (!/^\/[a-zA-Z0-9/_?=&.%-]{1,199}$/.test(path)) throw new HttpError(400, 'invalid_path');
      const asset = path.startsWith('/assets/');
      const edgeCacheable = ['GET', 'HEAD'].includes(method) && asset && !hasCookie && !hasAuthorization;
      const route = asset ? 'asset' : 'worker';
      const cache = edgeCacheable ? 'public' : 'private';
      const reason = edgeCacheable
        ? 'Anonymous read requests for non-API assets can be served from the nearest edge location.'
        : 'Dynamic routes, credentialed requests, and state-changing methods stay private and continue through the Worker boundary.';
      const event = await recordDemoEvent(env, 'workers', 'edge_policy_applied', { method, path, route, cache });
      return json({
        operation,
        request: { method, path, hasCookie, hasAuthorization },
        decision: { route, cache, originRequired: !edgeCacheable },
        reason,
        state: 'No process memory was used for persistence.',
        auditEventId: event.id,
      });
    }
    if (!['sum', 'average', 'min', 'max'].includes(operation)) throw new HttpError(400, 'invalid_operation');
    if (!Array.isArray(body.values) || body.values.length < 1 || body.values.length > 100 || !body.values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new HttpError(400, 'invalid_values', 'values must contain 1–100 finite numbers.');
    }
    const values = body.values as number[];
    const result = operation === 'sum' ? values.reduce((total, value) => total + value, 0)
      : operation === 'average' ? values.reduce((total, value) => total + value, 0) / values.length
        : operation === 'min' ? Math.min(...values) : Math.max(...values);
    const event = await recordDemoEvent(env, 'workers', 'stateless_compute', { operation, inputCount: values.length });
    return json({ operation, inputCount: values.length, result, state: 'No process memory was used for persistence.', auditEventId: event.id });
  } catch (error) {
    return errorResponse(error);
  }
}
