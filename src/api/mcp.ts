import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  McpServer,
  PROTOCOL_VERSION_META_KEY,
  createMcpHandler,
} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { Env } from '../types';
import { authorize } from '../lib/authorization';
import { json } from '../lib/http';
import { listDemoRecords } from '../lib/demo-records';

export const MCP_SERVER_PATH = '/mcp';
export const MCP_PROTOCOL_VERSION = '2026-07-28';

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const PingOutput = z.object({
  ok: z.literal(true),
  server: z.literal('wizardgang-architecture-demo'),
  transport: z.literal('streamable-http'),
  timestamp: z.string(),
});

const DemoRecord = z.object({
  namespace: z.string(),
  key: z.string(),
  valueJson: z.string(),
});

const ListDemoRecordsOutput = z.object({ results: z.array(DemoRecord) });

function createWizardGangMcpServer(env: Env): McpServer {
  const server = new McpServer(
    { name: 'wizardgang-architecture-demo', version: '2.0.0' },
    {
      supportedProtocolVersions: [MCP_PROTOCOL_VERSION],
      instructions: 'Use ping to verify connectivity. All exposed tools are public, read-only demonstrations governed by the same application authorization boundary as REST and GraphQL.',
      cacheHints: {
        'server/discover': { ttlMs: 60_000, cacheScope: 'public' },
        'tools/list': { ttlMs: 60_000, cacheScope: 'public' },
      },
    },
  );

  server.registerTool(
    'ping',
    {
      title: 'Ping WizardGang',
      description: 'Verify MCP client connectivity to the WizardGang architecture demo.',
      inputSchema: z.object({}),
      outputSchema: PingOutput,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      const output = {
        ok: true as const,
        server: 'wizardgang-architecture-demo' as const,
        transport: 'streamable-http' as const,
        timestamp: new Date().toISOString(),
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    'list_demo_records',
    {
      title: 'List demo records',
      description: 'Read bounded public demonstration records through the shared D1 authorization boundary.',
      inputSchema: z.object({
        namespace: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/).default('public'),
      }),
      outputSchema: ListDemoRecordsOutput,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ namespace }) => {
      const rows = await listDemoRecords(env, namespace);
      const output = {
        results: rows.map((row) => ({
          namespace: row.namespace,
          key: row.key,
          valueJson: JSON.stringify(row.value ?? null),
        })),
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  return server;
}

function originRejected(request: Request): Response | undefined {
  const origin = request.headers.get('origin');
  if (!origin || origin === new URL(request.url).origin) return undefined;
  return json({ error: 'invalid_origin' }, { status: 403, headers: { 'cache-control': 'no-store' } });
}

export async function mcpResponse(request: Request, env: Env): Promise<Response> {
  const originFailure = originRejected(request);
  if (originFailure) return originFailure;

  const principal = await authorize(request, env, 'demo:read');
  if (principal instanceof Response) return principal;
  const handler = createMcpHandler(
    () => createWizardGangMcpServer(env),
    { legacy: 'reject', responseMode: 'auto' },
  );
  return handler.fetch(request);
}

export const mcpMetaKeys = {
  protocolVersion: PROTOCOL_VERSION_META_KEY,
  clientInfo: CLIENT_INFO_META_KEY,
  clientCapabilities: CLIENT_CAPABILITIES_META_KEY,
} as const;
