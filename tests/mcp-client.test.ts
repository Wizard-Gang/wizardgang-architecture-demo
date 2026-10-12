import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import {
  MCP_PROTOCOL_VERSION,
  mcpMetaKeys,
  mcpResponse,
} from '../src/api/mcp';
import type { Env } from '../src/types';
import { SqliteD1 } from './helpers/wg-storage';

const sandbox = 'sandbox-0123456789abcdef01234567';
const sandboxRecord = { namespace: sandbox, key: 'architecture', value: { edge: true }, createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z' };

function environment(): Env & { WG_DB: SqliteD1 } {
  const db = new SqliteD1();
  db.putRecord('demo-records', `${sandbox}/architecture`, sandboxRecord, { owner: sandbox });
  return {
    WG_DB: db,
    GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
    GITHUB_BRANCH: 'main',
  };
}

function inProcessTransport(env: Env): StreamableHTTPClientTransport {
  const fetchHandler = async (input: RequestInfo | URL, init?: RequestInit) => {
    return mcpResponse(new Request(input, init), env);
  };
  return new StreamableHTTPClientTransport(new URL('https://demo.example/mcp'), {
    fetch: fetchHandler as typeof fetch,
  });
}

function modernRequest(method: string, params: Record<string, unknown> = {}, headerName?: string): Request {
  return new Request('https://demo.example/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MCP_PROTOCOL_VERSION,
      'mcp-method': method,
      ...(headerName ? { 'mcp-name': headerName } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          [mcpMetaKeys.protocolVersion]: MCP_PROTOCOL_VERSION,
          [mcpMetaKeys.clientInfo]: { name: 'curl', version: '1.0' },
          [mcpMetaKeys.clientCapabilities]: {},
        },
      },
    }),
  });
}

function modernPingRequest(headerName = 'ping'): Request {
  return modernRequest('tools/call', { name: 'ping', arguments: {} }, headerName);
}

async function exerciseClient(client: Client, env: Env & { WG_DB: SqliteD1 }) {
  const transport = inProcessTransport(env);
  await client.connect(transport);

  const catalog = await client.listTools();
  expect(catalog.tools.map((tool) => tool.name)).toEqual(['ping', 'list_demo_records']);
  for (const tool of catalog.tools) {
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tool.outputSchema).toBeDefined();
  }

  const ping = await client.callTool({ name: 'ping', arguments: {} });
  expect(ping.isError).not.toBe(true);
  expect(ping.structuredContent).toMatchObject({
    ok: true,
    server: 'wizardgang-architecture-demo',
    transport: 'streamable-http',
  });

  const records = await client.callTool({ name: 'list_demo_records', arguments: { namespace: sandbox } });
  expect(records.structuredContent).toEqual({
    results: [{ namespace: sandbox, key: 'architecture', valueJson: '{"edge":true}' }],
  });
  const catalogue = await client.callTool({ name: 'list_demo_records', arguments: { namespace: 'public' } });
  const publicResults = (catalogue.structuredContent as { results: Array<{ namespace: string; key: string }> }).results;
  expect(publicResults.map((record) => record.key)).toContain('runtime-d1');
  expect(publicResults.every((record) => record.namespace === 'public')).toBe(true);

  await client.close();
}

describe('official MCP client interoperability', () => {
  it('connects with MCP 2026-07-28, discovers schemas, and invokes both tools', async () => {
    const env = environment();
    const client = new Client(
      { name: 'integration-modern-client', version: '1.0.0' },
      {
        supportedProtocolVersions: [MCP_PROTOCOL_VERSION],
        versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } },
      },
    );

    await exerciseClient(client, env);
  });

  it('accepts the documented modern stateless curl request without a handshake', async () => {
    const response = await mcpResponse(modernPingRequest(), environment());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const payload = await response.json() as { result: { structuredContent: unknown } };
    expect(payload.result.structuredContent).toMatchObject({ ok: true, transport: 'streamable-http' });
  });

  it('rejects a modern request when the tool-name header disagrees with the body', async () => {
    const response = await mcpResponse(modernPingRequest('list_demo_records'), environment());
    expect(response.status).toBe(400);
  });

  it('rejects an unknown MCP method at the real MCP boundary', async () => {
    const response = await mcpResponse(modernRequest('tools/deleteEverything'), environment());
    expect(response.status).toBe(404);
    const payload = await response.json() as { error?: { code?: number } };
    expect(payload.error?.code).toBe(-32601);
  });

  it('rejects an invalid demo-record namespace at the real MCP boundary', async () => {
    const response = await mcpResponse(modernRequest(
      'tools/call',
      { name: 'list_demo_records', arguments: { namespace: '../private' } },
      'list_demo_records',
    ), environment());
    expect(response.status).toBe(200);
    const payload = await response.json() as { result?: { isError?: boolean } };
    expect(payload.result?.isError).toBe(true);
  });

  it('rejects a prohibited write tool at the real MCP boundary', async () => {
    const env = environment();
    const response = await mcpResponse(modernRequest(
      'tools/call',
      { name: 'create_demo_record', arguments: { namespace: 'public', key: 'blocked', valueJson: '{}' } },
      'create_demo_record',
    ), env);
    expect(response.status).toBe(200);
    const payload = await response.json() as { error?: { code?: number } };
    expect(payload.error?.code).toBe(-32602);
    expect([...env.WG_DB.records('demo-records').values()].map((row) => row.body)).toEqual([sandboxRecord]);
  });

  it('accepts a standard initialization notification without creating a compatibility route', async () => {
    const response = await mcpResponse(new Request('https://demo.example/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }), environment());

    expect(response.status).toBe(202);
  });
});
