import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { boundedDiagnosticText } from './lib/ci-diagnostics.ts';

const root = process.cwd();
const diagnosticsDir = process.env.CI_DIAGNOSTICS_DIR || '.ci-diagnostics';

function listFiles(relativeDirectory, cwd = root) {
  const absolute = path.join(cwd, relativeDirectory);
  if (!fs.existsSync(absolute)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absoluteEntry = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absoluteEntry);
      else files.push(path.relative(cwd, absoluteEntry).split(path.sep).join('/'));
    }
  };
  visit(absolute);
  return files;
}

const definitions = [
  {
    id: 'assets',
    command: ['npm', ['run', 'generate:assets']],
    inputs: ['package-lock.json', 'vite.config.ts', ...listFiles('src/styles'), 'src/assets/og.png'],
    outputs: ['src/generated/asset-manifest.json'],
  },
  {
    id: 'routes',
    command: ['node', ['scripts/generate-route-manifest.ts']],
    inputs: listFiles('src/routing'),
    outputs: ['src/generated/route-manifest.json'],
  },
  {
    id: 'openapi',
    command: ['npm', ['run', 'generate:openapi']],
    inputs: ['contracts/openapi/openapi.json', 'src/api/rest-demo-openapi.ts'],
    outputs: ['contracts/openapi/openapi.json'],
  },
];

// The ignored client distribution is an acceptance input, not a tracked artifact.
// Verify it was freshly emitted, is complete, and has no leftover files.
export function inspectAcceptedClientOutput(cwd = root) {
  const issues = [];
  const expected = new Set(['.vite/manifest.json']);
  const readJson = (file) => {
    try { return JSON.parse(fs.readFileSync(path.join(cwd, file), 'utf8')); }
    catch { issues.push(file + ': missing or invalid JSON'); return null; }
  };
  const includeFile = (file, owner) => {
    if (
      typeof file !== 'string'
      || !file.startsWith('assets/')
      || file.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      issues.push(owner + ': invalid emitted asset path ' + JSON.stringify(file));
      return;
    }
    expected.add(file);
  };

  const assetManifest = readJson('src/generated/asset-manifest.json');
  if (assetManifest?.version !== 1 || !assetManifest.assets || Array.isArray(assetManifest.assets)
    || typeof assetManifest.assets !== 'object' || Object.keys(assetManifest.assets).length === 0) {
    issues.push('src/generated/asset-manifest.json: missing version 1 asset mapping');
  } else {
    for (const [name, file] of Object.entries(assetManifest.assets)) {
      if (typeof file !== 'string' || !file.startsWith('/assets/')) {
        issues.push('src/generated/asset-manifest.json: invalid asset ' + name);
      } else {
        includeFile(file.slice(1), 'src/generated/asset-manifest.json ' + name);
      }
    }
  }

  const viteManifest = readJson('dist/client/.vite/manifest.json');
  if (!viteManifest || typeof viteManifest !== 'object' || Array.isArray(viteManifest)
    || Object.keys(viteManifest).length === 0) {
    issues.push('dist/client/.vite/manifest.json: missing Vite asset inventory');
  } else {
    for (const [name, entry] of Object.entries(viteManifest)) {
      if (!entry || typeof entry !== 'object' || typeof entry.file !== 'string') {
        issues.push('dist/client/.vite/manifest.json: invalid entry ' + name);
        continue;
      }
      includeFile(entry.file, 'Vite entry ' + name);
      for (const field of ['css', 'assets']) {
        if (entry[field] === undefined) continue;
        if (!Array.isArray(entry[field])) {
          issues.push('Vite entry ' + name + ': invalid ' + field + ' file list');
          continue;
        }
        for (const file of entry[field]) includeFile(file, 'Vite entry ' + name + ' ' + field);
      }
    }
  }

  const built = listFiles('dist/client', cwd).map((file) => file.slice('dist/client/'.length));
  const actual = new Set(built);
  for (const file of expected) {
    if (!actual.has(file)) issues.push('dist/client/' + file + ': missing generated file');
  }
  for (const file of built) {
    if (!expected.has(file)) issues.push('dist/client/' + file + ': unexpected generated file');
    const absolute = path.join(cwd, 'dist/client', file);
    try {
      if (!fs.lstatSync(absolute).isFile() || fs.statSync(absolute).size === 0) {
        issues.push('dist/client/' + file + ': not a nonempty regular file');
      }
    } catch { issues.push('dist/client/' + file + ': unreadable generated file'); }
  }
  if (built.length === 0) issues.push('dist/client: empty client distribution');
  return { issues, hashes: snapshot(built.map((file) => 'dist/client/' + file), cwd) };
}

function sha256(file, cwd = root) {
  const absolute = path.join(cwd, file);
  return fs.existsSync(absolute) ? createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') : null;
}

function snapshot(files, cwd = root) {
  return Object.fromEntries([...new Set(files)].sort().map((file) => [file, sha256(file, cwd)]));
}

function statusPaths(cwd = root) {
  const result = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.trim().split('\n').filter(Boolean).map((line) => line.slice(3).replace(/ -> .+$/, ''));
}

function runGenerator(definition, cwd = root) {
  const [file, args] = definition.command;
  const started = Date.now();
  const result = spawnSync(file, args, { cwd, encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  return {
    command: [file, ...args].join(' '),
    exitCode: result.status ?? 1,
    signal: result.signal,
    durationMs: Date.now() - started,
    output: boundedDiagnosticText(output),
  };
}

function diffFor(outputs, cwd = root) {
  const result = spawnSync('git', ['diff', '--no-ext-diff', '--unified=3', '--', ...outputs], { cwd, encoding: 'utf8' });
  return boundedDiagnosticText(result.status === 0 ? result.stdout : `${result.stdout || ''}\n${result.stderr || ''}`);
}

export function runGeneratedArtifactParity({ definitions: selected = definitions, diagnosticsDirectory = diagnosticsDir, cwd = root } = {}) {
  const absoluteDiagnostics = path.resolve(cwd, diagnosticsDirectory);
  fs.mkdirSync(absoluteDiagnostics, { recursive: true });
  const baselineStatus = new Set(statusPaths(cwd));
  const records = [];
  const failures = [];
  let aggregateDiff = '';

  for (const definition of selected) {
    const allFiles = [...definition.inputs, ...definition.outputs];
    const before = snapshot(allFiles, cwd);
    if (definition.id === 'assets') fs.rmSync(path.join(cwd, 'dist/client'), { recursive: true, force: true });
    const first = runGenerator(definition, cwd);
    const afterFirst = snapshot(allFiles, cwd);
    const firstChanged = definition.outputs.filter((file) => before[file] !== afterFirst[file]);
    const firstStatus = statusPaths(cwd);
    const firstClient = definition.id === 'assets' ? inspectAcceptedClientOutput(cwd) : null;
    if (definition.id === 'assets') fs.rmSync(path.join(cwd, 'dist/client'), { recursive: true, force: true });
    const second = runGenerator(definition, cwd);
    const afterSecond = snapshot(allFiles, cwd);
    const secondChanged = definition.outputs.filter((file) => afterFirst[file] !== afterSecond[file]);
    const secondStatus = statusPaths(cwd);
    const secondClient = definition.id === 'assets' ? inspectAcceptedClientOutput(cwd) : null;
    const clientChangedFiles = firstClient && secondClient
      ? [...new Set([...Object.keys(firstClient.hashes), ...Object.keys(secondClient.hashes)])]
        .filter((file) => firstClient.hashes[file] !== secondClient.hashes[file]).sort()
      : [];
    const clientIssues = [
      ...(firstClient?.issues ?? []).map((issue) => 'first pass: ' + issue),
      ...(secondClient?.issues ?? []).map((issue) => 'second pass: ' + issue),
    ];
    const introducedStatus = [...firstStatus, ...secondStatus].filter((file) => !baselineStatus.has(file) && !definition.outputs.includes(file));
    const record = {
      id: definition.id,
      command: first.command,
      inputs: [...definition.inputs].sort(),
      outputs: [...definition.outputs].sort(),
      firstPass: { ...first, changedOutputs: firstChanged },
      secondPass: { ...second, changedOutputs: secondChanged },
      idempotent: secondChanged.length === 0 && clientChangedFiles.length === 0,
      ...(firstClient ? { clientOutput: {
        firstPassIssues: firstClient.issues,
        secondPassIssues: secondClient.issues,
        secondPassChangedFiles: clientChangedFiles,
        fileCount: Object.keys(secondClient.hashes).length,
      } } : {}),
      unexpectedChangedFiles: [...new Set(introducedStatus)].sort(),
      outputHashes: Object.fromEntries(definition.outputs.map((file) => [file, afterSecond[file]])),
    };
    records.push(record);
    if (firstChanged.length || secondChanged.length || first.exitCode !== 0 || second.exitCode !== 0 || record.unexpectedChangedFiles.length || clientIssues.length || clientChangedFiles.length) {
      failures.push({
        id: definition.id,
        firstChanged,
        secondChanged,
        unexpectedChangedFiles: record.unexpectedChangedFiles,
        clientIssues,
        clientChangedFiles,
        firstExitCode: first.exitCode,
        secondExitCode: second.exitCode,
      });
      aggregateDiff += `\n===== ${definition.id} =====\n${diffFor(definition.outputs, cwd)}\n`;
    }
  }

  const report = {
    schemaVersion: 1,
    status: failures.length ? 'failure' : 'success',
    generatedAt: new Date().toISOString(),
    definitions: records,
    failures,
  };
  fs.writeFileSync(path.join(absoluteDiagnostics, 'generated-artifacts.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(absoluteDiagnostics, 'generated-artifact.diff'), boundedDiagnosticText(aggregateDiff));
  if (failures.length) {
    console.error('Generated-artifact parity failed; inspect .ci-diagnostics/generated-artifacts.json and generated-artifact.diff.');
    for (const failure of failures) console.error(`- ${failure.id}: first-pass drift=${failure.firstChanged.length}, second-pass drift=${failure.secondChanged.length}, client-issues=${failure.clientIssues.length}, client-drift=${failure.clientChangedFiles.length}, exit=${failure.firstExitCode}/${failure.secondExitCode}`);
    return report;
  }
  console.log(`Generated-artifact parity passed for ${records.length} generator definitions; all second passes were idempotent.`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runGeneratedArtifactParity();
  process.exitCode = report.status === 'failure' ? 1 : 0;
}

export { definitions as generatedArtifactDefinitions };
