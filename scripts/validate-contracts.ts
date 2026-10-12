import fs from 'node:fs';

const failures: string[] = [];
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);
const openapi = JSON.parse(fs.readFileSync('contracts/openapi/openapi.json', 'utf8'));
const routeManifest = JSON.parse(fs.readFileSync('src/generated/route-manifest.json', 'utf8')) as Array<{
  id: string;
  route: string;
  methods: string[];
}>;
const routesById = new Map(routeManifest.map((route) => [route.id, route]));

function fail(message: string): void {
  failures.push(message);
}

function resolveLocalRef(ref: unknown, root: any = openapi): any {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  return ref.slice(2).split('/').reduce((value: any, segment) => {
    if (!value || typeof value !== 'object') return undefined;
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    return value[key];
  }, root);
}

function visit(value: any, pointer = '#', resourceRoot: any = openapi): void {
  if (!value || typeof value !== 'object') return;
  const currentResourceRoot = !Array.isArray(value) && typeof value.$id === 'string' ? value : resourceRoot;
  if (
    typeof value.$ref === 'string'
    && value.$ref.startsWith('#/')
    && resolveLocalRef(value.$ref, currentResourceRoot) === undefined
  ) {
    fail(`unresolved OpenAPI reference at ${pointer}: ${value.$ref}`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visit(entry, `${pointer}/${index}`, currentResourceRoot));
    return;
  }
  for (const [key, entry] of Object.entries(value)) visit(entry, `${pointer}/${key}`, currentResourceRoot);
}

if (openapi.openapi !== '3.1.0') fail('REST contract must be OpenAPI 3.1.0');
if (openapi.jsonSchemaDialect !== 'https://json-schema.org/draft/2020-12/schema') {
  fail('OpenAPI must declare the JSON Schema 2020-12 dialect');
}
const serverPath = (() => {
  try {
    return new URL(openapi.servers?.[0]?.url ?? '').pathname.replace(/\/$/, '') || '/';
  } catch {
    return '';
  }
})();
if (serverPath !== '/') fail('OpenAPI server URL must use the application root; documented paths own their complete runtime URL.');
if (!Array.isArray(openapi.servers) || openapi.servers.length !== 1
  || openapi.servers[0]?.url !== 'https://demo.wizardgang.ai') {
  fail('OpenAPI server URL must use the canonical public demo origin.');
}
if (!openapi.components?.securitySchemes?.BearerToken) fail('BearerToken security scheme is missing');
let operationCount = 0;
for (const [path, pathItem] of Object.entries(openapi.paths ?? {})) {
  if (!path.startsWith('/')) fail(`OpenAPI path must be an absolute application path: ${path}`);
  for (const [method, operation] of Object.entries(pathItem ?? {})) {
    if (!HTTP_METHODS.has(method.toLowerCase())) continue;
    operationCount += 1;
    if (!operation || typeof operation !== 'object') {
      fail(`invalid OpenAPI operation: ${method.toUpperCase()} ${path}`);
      continue;
    }
    const routeId = operation['x-route-id'];
    if (typeof routeId !== 'string' || !routeId.trim()) {
      fail(`documented operation is missing x-route-id: ${method.toUpperCase()} ${path}`);
    } else {
      const declaredRoute = routesById.get(routeId);
      if (!declaredRoute) {
        fail(`OpenAPI operation references unknown route ID ${routeId}: ${method.toUpperCase()} ${path}`);
      } else {
        if (declaredRoute.route !== path) {
          fail(`OpenAPI path for route ${routeId} differs from registered route ${declaredRoute.route}: ${path}`);
        }
        if (!declaredRoute.methods.includes(method.toUpperCase())) {
          fail(`OpenAPI method ${method.toUpperCase()} is not registered for route ${routeId}`);
        }
      }
    }
    if (!operation.responses || typeof operation.responses !== 'object' || Array.isArray(operation.responses)) {
      fail(`documented operation is missing a Responses Object: ${method.toUpperCase()} ${path}`);
    } else if ('$ref' in operation.responses) {
      fail(`Responses Object cannot be replaced by $ref: ${method.toUpperCase()} ${path}`);
    }
  }
}
if (operationCount === 0) fail('OpenAPI contract documents no REST operations');
visit(openapi);

if (fs.existsSync('contracts/openapi/swagger.json')) fail('legacy contracts/openapi/swagger.json must not exist');

const graphql = fs.readFileSync('contracts/graphql/schema.graphql', 'utf8');
if (!graphql.includes('users: [User!]!') || graphql.includes('demoRecords') || graphql.includes('DemoRecord')) {
  fail('GraphQL schema must expose only the current user contract');
}
const mcp = JSON.parse(fs.readFileSync('contracts/mcp/tools.json', 'utf8'));
if (mcp.status !== 'working' || mcp.transport?.path !== '/mcp' || mcp.protocol?.version !== '2026-07-28' || Object.keys(mcp.protocol).length !== 1) {
  fail('MCP manifest does not match the live transport');
}
for (const name of ['ping', 'list_demo_records']) {
  const tool = mcp.tools?.find((candidate: any) => candidate.name === name);
  if (!tool?.inputSchema || !tool?.outputSchema || tool.annotations?.readOnlyHint !== true) {
    fail(`MCP manifest is missing the complete ${name} contract`);
  }
}
const webhooks = JSON.parse(fs.readFileSync('contracts/webhooks/events.json', 'utf8'));
if (webhooks.status !== 'working' || !webhooks.events?.some((event: any) => event.type === 'demo.record.changed')) {
  fail('webhook contract does not match the live event');
}

if (failures.length) {
  console.error('Contract validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Contract validation passed: ${operationCount} OpenAPI operations plus synchronized GraphQL, MCP, and webhook contracts.`);
