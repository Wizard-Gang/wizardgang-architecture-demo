import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectAcceptedClientOutput, runGeneratedArtifactParity } from '../scripts/validate-generated-artifacts.ts';

const temporaryDirectories: string[] = [];
const asset = 'assets/shell-browser-1234567890abcdef.js';
const assetManifest = { version: 1, assets: { 'scripts.shell': '/' + asset } };
const viteManifest = { 'src/browser/shell.ts': { file: asset, isEntry: true } };
const serializedAssets = JSON.stringify(assetManifest) + '\n';
const serializedVite = JSON.stringify(viteManifest) + '\n';

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-498-client-assets-'));
  temporaryDirectories.push(cwd);
  fs.mkdirSync(path.join(cwd, 'src/generated'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'dist/client/.vite'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'dist/client/assets'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src/generated/asset-manifest.json'), serializedAssets);
  fs.writeFileSync(path.join(cwd, 'dist/client/.vite/manifest.json'), serializedVite);
  fs.writeFileSync(path.join(cwd, 'dist/client', asset), 'first pass');
  return cwd;
}

type FixtureBehavior = {
  trackedOutput?: 'stable' | 'stale' | 'unstable';
  unexpectedOutput?: boolean;
  unstableClient?: boolean;
};

function committedFixture() {
  const cwd = fixture();
  fs.writeFileSync(path.join(cwd, '.gitignore'), 'dist/\n.ci-diagnostics/\n');
  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd });
  execFileSync('git', ['add', '.gitignore', 'src/generated/asset-manifest.json'], { cwd });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd });
  return cwd;
}

function runFixtureParity(cwd: string, {
  trackedOutput = 'stable',
  unexpectedOutput = false,
  unstableClient = false,
}: FixtureBehavior = {}) {
  const alternateManifest = JSON.stringify(assetManifest, null, 2) + '\n';
  const manifestBytes = trackedOutput === 'stale'
    ? JSON.stringify(alternateManifest)
    : trackedOutput === 'unstable'
      ? `count === 1 ? ${JSON.stringify(serializedAssets)} : ${JSON.stringify(alternateManifest)}`
      : JSON.stringify(serializedAssets);
  const clientBytes = unstableClient ? "count === 1 ? 'first pass' : 'second pass'" : "'stable pass'";
  const generator = [
    "const fs = require('node:fs');",
    "fs.mkdirSync('.ci-diagnostics', { recursive: true });",
    "const countFile = '.ci-diagnostics/generation-count';",
    "const count = fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, 'utf8')) + 1 : 1;",
    "fs.writeFileSync(countFile, String(count));",
    "fs.mkdirSync('dist/client/.vite', { recursive: true });",
    "fs.mkdirSync('dist/client/assets', { recursive: true });",
    "fs.writeFileSync('src/generated/asset-manifest.json', " + manifestBytes + ");",
    "fs.writeFileSync('dist/client/.vite/manifest.json', " + JSON.stringify(serializedVite) + ");",
    "fs.writeFileSync('dist/client/" + asset + "', " + clientBytes + ");",
    ...(unexpectedOutput ? ["fs.writeFileSync('src/generated/unexpected-generator-output.txt', 'unowned');"] : []),
  ].join('\n');
  return runGeneratedArtifactParity({
    cwd,
    diagnosticsDirectory: '.ci-diagnostics',
    definitions: [{
      id: 'assets',
      command: [process.execPath, ['-e', generator]],
      inputs: [],
      outputs: ['src/generated/asset-manifest.json'],
    }],
  });
}

afterEach(() => {
  for (const cwd of temporaryDirectories.splice(0)) fs.rmSync(cwd, { recursive: true, force: true });
});

describe('DEMO-498 accepted client generation', () => {
  it('accepts a complete hashed asset inventory and rejects missing or empty output', () => {
    const cwd = fixture();
    expect(inspectAcceptedClientOutput(cwd).issues).toEqual([]);
    fs.rmSync(path.join(cwd, 'dist/client', asset));
    expect(inspectAcceptedClientOutput(cwd).issues).toContain('dist/client/' + asset + ': missing generated file');
    fs.writeFileSync(path.join(cwd, 'dist/client', asset), '');
    expect(inspectAcceptedClientOutput(cwd).issues).toContain('dist/client/' + asset + ': not a nonempty regular file');
  });

  it('rejects unexpected leftover files and missing Vite inventory', () => {
    const cwd = fixture();
    fs.writeFileSync(path.join(cwd, 'dist/client/assets/stale.js'), 'stale');
    expect(inspectAcceptedClientOutput(cwd).issues).toContain('dist/client/assets/stale.js: unexpected generated file');
    fs.rmSync(path.join(cwd, 'dist/client/.vite/manifest.json'));
    expect(inspectAcceptedClientOutput(cwd).issues).toContain('dist/client/.vite/manifest.json: missing generated file');
  });

  it('uses exactly two clean client generations and accepts stable output without a third build', () => {
    const cwd = committedFixture();
    fs.writeFileSync(path.join(cwd, 'dist/client/assets/leftover.js'), 'previous build');
    const result = runFixtureParity(cwd);
    expect(result.status).toBe('success');
    expect(result.failures).toEqual([]);
    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].firstPass.exitCode).toBe(0);
    expect(result.definitions[0].secondPass.exitCode).toBe(0);
    expect(result.definitions[0].idempotent).toBe(true);
    expect(result.definitions[0].clientOutput).toMatchObject({
      firstPassIssues: [],
      secondPassIssues: [],
      secondPassChangedFiles: [],
      fileCount: 2,
    });
    expect(fs.readFileSync(path.join(cwd, '.ci-diagnostics/generation-count'), 'utf8')).toBe('2');
    expect(fs.existsSync(path.join(cwd, 'dist/client/assets/leftover.js'))).toBe(false);
    expect(inspectAcceptedClientOutput(cwd).issues).toEqual([]);
  });

  it('fails when the first generation changes committed output, even if the second pass is stable', () => {
    const result = runFixtureParity(committedFixture(), { trackedOutput: 'stale' });
    expect(result.status).toBe('failure');
    expect(result.failures[0].firstChanged).toEqual(['src/generated/asset-manifest.json']);
    expect(result.failures[0].secondChanged).toEqual([]);
    expect(result.failures[0].clientIssues).toEqual([]);
    expect(result.definitions[0].idempotent).toBe(true);
  });

  it('fails when a generator emits a file outside its declared outputs', () => {
    const result = runFixtureParity(committedFixture(), { unexpectedOutput: true });
    expect(result.status).toBe('failure');
    expect(result.failures[0].firstChanged).toEqual([]);
    expect(result.failures[0].secondChanged).toEqual([]);
    expect(result.failures[0].unexpectedChangedFiles).toContain('src/generated/unexpected-generator-output.txt');
    expect(result.failures[0].clientIssues).toEqual([]);
  });

  it('fails when the second generation changes tracked output', () => {
    const result = runFixtureParity(committedFixture(), { trackedOutput: 'unstable' });
    expect(result.status).toBe('failure');
    expect(result.failures[0].firstChanged).toEqual([]);
    expect(result.failures[0].secondChanged).toEqual(['src/generated/asset-manifest.json']);
    expect(result.failures[0].clientIssues).toEqual([]);
    expect(result.definitions[0].idempotent).toBe(false);
  });

  it('cleans each pass and fails on non-idempotent ignored client bytes', () => {
    const result = runFixtureParity(committedFixture(), { unstableClient: true });
    expect(result.status).toBe('failure');
    expect(result.failures[0].firstChanged).toEqual([]);
    expect(result.failures[0].secondChanged).toEqual([]);
    expect(result.failures[0].clientIssues).toEqual([]);
    expect(result.failures[0].clientChangedFiles).toContain('dist/client/' + asset);
    expect(result.definitions[0].idempotent).toBe(false);
  });

});
