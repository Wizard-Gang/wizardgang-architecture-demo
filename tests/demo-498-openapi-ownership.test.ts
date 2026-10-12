import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generatedArtifactDefinitions } from '../scripts/validate-generated-artifacts.ts';

const repo = process.cwd();
const generated = 'contracts/openapi/openapi.json';
const files = [
  generated,
  'docs/route-manifest.json',
  'contracts/graphql/schema.graphql',
  'contracts/mcp/tools.json',
  'contracts/webhooks/events.json',
];
const temporaryDirectories: string[] = [];

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-498-openapi-ownership-'));
  temporaryDirectories.push(cwd);
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.copyFileSync(path.join(repo, file), path.join(cwd, file));
  }
  return cwd;
}

function validate(cwd: string) {
  return spawnSync(process.execPath, [path.join(repo, 'scripts/validate-contracts.ts')], {
    cwd, encoding: 'utf8',
  });
}

function changeOpenApi(cwd: string, mutate: (document: any) => void) {
  const target = path.join(cwd, generated);
  const document = JSON.parse(fs.readFileSync(target, 'utf8'));
  mutate(document);
  fs.writeFileSync(target, JSON.stringify(document, null, 2) + '\n');
}

afterEach(() => {
  for (const cwd of temporaryDirectories.splice(0)) fs.rmSync(cwd, { recursive: true, force: true });
});

describe('DEMO-498 OpenAPI acceptance ownership', () => {
  it('uses parity for generated freshness and the contract command only for semantic validation', () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).scripts;
    expect(scripts['validate:contracts']).toBe('node scripts/validate-contracts.ts');
    expect(scripts['generate:openapi']).toBe('node scripts/sync-openapi-schemas.ts');
    const openapi = generatedArtifactDefinitions.find((definition) => definition.id === 'openapi');
    expect(openapi?.command).toEqual(['npm', ['run', 'generate:openapi']]);
    expect(openapi?.outputs).toEqual([generated]);
    const source = fs.readFileSync(path.join(repo, 'scripts/sync-openapi-schemas.ts'), 'utf8');
    expect(source).not.toContain("process.argv.includes('--check')");
    expect(source).not.toContain('assert.deepStrictEqual(');
  });

  it('accepts current schemas and registered operation routing without regenerating OpenAPI', () => {
    const result = validate(fixture());
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Contract validation passed:');
  });

  it('rejects an operation whose route ID, path or method is not registered', () => {
    const cwd = fixture();
    changeOpenApi(cwd, (document) => { document.paths['/api/operations/health'].get['x-route-id'] = 'unknown.route'; });
    expect(validate(cwd).stderr).toContain('unknown route ID');

    changeOpenApi(cwd, (document) => { document.paths['/api/operations/health'].get['x-route-id'] = 'operations.health'; });
    const entry = JSON.parse(fs.readFileSync(path.join(cwd, generated), 'utf8')).paths['/api/operations/health'].get;
    changeOpenApi(cwd, (document) => {
      delete document.paths['/api/operations/health'];
      document.paths['/api/not-health'] = { get: entry };
    });
    expect(validate(cwd).stderr).toContain('differs from registered route');

    changeOpenApi(cwd, (document) => {
      const operation = document.paths['/api/not-health'].get;
      delete document.paths['/api/not-health'];
      document.paths['/api/operations/health'] = { post: operation };
    });
    expect(validate(cwd).stderr).toContain('not registered for route');
  });

  it('retains the server-origin assertion', () => {
    const cwd = fixture();
    changeOpenApi(cwd, (document) => { document.servers[0].url = 'https://other.example'; });
    expect(validate(cwd).stderr).toContain('canonical public demo origin');
  });
});
