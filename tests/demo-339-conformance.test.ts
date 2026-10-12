import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import manifest from '../src/generated/asset-manifest.json';
import { validateReactPresentation, validateWorkerBundle } from '../scripts/validate-react-presentation.ts';
import { validateRepositoryBaseline } from '../scripts/validate-repository-baseline.ts';

function fixture(files: string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'demo-339-'));
  for (const file of files) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(file, target, { recursive: true });
  }
  return root;
}

function violation(root: string, relative: string, edit: (value: string) => string, validate: () => string[], expected: RegExp) {
  const file = path.join(root, relative);
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, edit(before ?? ''));
  try { expect(validate().join('\n')).toMatch(expected); }
  finally { if (before === null) rmSync(file); else writeFileSync(file, before); }
  expect(validate()).toEqual([]);
}

describe('DEMO-339 deliberate-regression proofs', () => {
  it('rejects each React, browser, stylesheet, CSP, and static-asset boundary regression', () => {
    const root = fixture(['src', 'src/generated/asset-manifest.json', 'vite.config.ts', 'wrangler.jsonc']);
    try {
      const validate = () => validateReactPresentation(root);
      expect(validate()).toEqual([]);
      violation(root, 'src/ui/unreviewed.ts', () => "export const response = new Response('<p>Unreviewed</p>', { headers: { 'content-type': 'text/html' } });", validate, /HTML response must come from a declared React document/);
      violation(root, 'src/ui/unreviewed.ts', () => 'export const html = `<main>Unreviewed</main>`;', validate, /HTML constructed with a template string/);
      violation(root, 'src/ui/unreviewed.tsx', () => 'export const view = <div dangerouslySetInnerHTML={{ __html: "raw" }} />;', validate, /raw HTML insertion outside the audited component/);
      violation(root, 'src/browser/regression.ts', () => "import { hydrateRoot, createRoot } from 'react-dom/client'; hydrateRoot(document.body, null);", validate, /React root API in browser source/);
      violation(root, 'src/browser/regression.ts', () => "import { createBrowserRouter } from 'react-router-dom';", validate, /client router/);
      violation(root, 'src/ui/regression.css', () => '.regression { color: red; }', validate, /stylesheet outside src\/styles/);
      violation(root, 'src/lib/http.ts', (value) => value.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"), validate, /shared CSP missing or permits unsafe-inline/);
      violation(root, 'src/generated/asset-manifest.json', (value) => value.replace(manifest.assets['vendor.axe'], '/assets/axe.min.js'), validate, /unhashed browser asset/);
      violation(root, 'wrangler.jsonc', (value) => value.replace('"binding": "ASSETS"', '"binding": "OTHER"'), validate, /Workers Static Assets/);
      violation(root, 'src/ui/assets.ts', (value) => value.replace('max-age=31536000, immutable', 'max-age=60'), validate, /immutable caching/);
      violation(root, 'vite.config.ts', (value) => value.replace("resolve(ROOT, 'src/styles/graphiql.css')", "resolve(ROOT, 'node_modules/graphiql.css')"), validate, /stylesheets must build from src\/styles/);
      const generated = path.join(root, 'dist/client');
      const fixtureManifest = structuredClone(manifest) as { version: number; assets: Record<string, string> };
      for (const [key, initial] of Object.entries(fixtureManifest.assets)) {
        if ((key.startsWith('vendor.') && key !== 'vendor.graphiql.styles') || key === 'social.card') {
          const digest = createHash('sha256').update('first-party asset').digest('hex').slice(0, 16);
          fixtureManifest.assets[key] = initial.replace(/-[a-zA-Z0-9_-]+(\.[^.]+)$/, `-${digest}$1`);
        }
      }
      writeFileSync(path.join(root, 'src/generated/asset-manifest.json'), `${JSON.stringify(fixtureManifest)}\n`);
      for (const asset of Object.values(fixtureManifest.assets)) {
        const file = path.join(generated, asset.slice(1));
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, 'first-party asset');
      }
      expect(validate()).toEqual([]);
      violation(root, fixtureManifest.assets['scripts.shell'].slice(1).replace(/^/, 'dist/client/'), () => 'createRoot(document.body);', validate, /first-party browser module contains a React root/);
      const worker = path.join(root, 'dist/worker/index.js');
      mkdirSync(path.dirname(worker), { recursive: true });
      writeFileSync(worker, '// Worker code');
      expect(validateWorkerBundle(root)).toEqual([]);
      violation(root, 'dist/worker/index.js', () => 'first-party asset', () => validateWorkerBundle(root), /browser-only vendored payload bundled/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 15_000);

  it('reads CSS and TSX class reachability, and rejects a retired selector', () => {
    const root = fixture(['src', 'scripts/validate-stylesheet-classes.ts']);
    try {
      const stylesheet = path.join(root, 'src/styles/proof.css');
      const component = path.join(root, 'src/ui/proof.tsx');
      writeFileSync(stylesheet, '.demo-339-proof { color: red; }\n');
      writeFileSync(component, 'export const proof = <div className="demo-339-proof" />;\n');
      const check = () => spawnSync(process.execPath, [path.join(root, 'scripts/validate-stylesheet-classes.ts')], { encoding: 'utf8' });
      expect(check().status).toBe(0);
      rmSync(component);
      const failure = check();
      expect(failure.status).toBe(1);
      expect(failure.stderr).toContain('.demo-339-proof');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('rejects toolchain, command, root-file, and workflow baseline violations', () => {
    const root = fixture(['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE', '.gitignore', '.node-version', '.npmrc', 'package.json', 'package-lock.json', 'config/repository-capabilities.json', 'tsconfig.json', 'wrangler.jsonc', 'vite.config.ts', '.github/workflows/ci.yml', '.github/workflows/release.yml', 'scripts/ci-validation.ts', 'scripts/lib/acceptance-plan.ts', 'scripts/lib/ci-diagnostics.ts']);
    try {
      const validate = () => validateRepositoryBaseline(root);
      expect(validate()).toEqual([]);
      violation(root, '.node-version', () => '24.0.0\n', validate, /pin exact Node 26/);
      violation(root, 'package.json', (value) => value.replace(/"packageManager": "npm@12\.\d+\.\d+"/, '"packageManager": "npm@10.0.0"'), validate, /pin exact npm 12/);
      violation(root, 'tsconfig.json', (value) => value.replace('"strict": true', '"strict": false'), validate, /TypeScript strict mode/);
      violation(root, 'scripts/lib/acceptance-plan.ts', (value) => value.replace("  { script: 'validate:repository-baseline', group: 'source' },", ''), validate, /check must invoke validate:repository-baseline/);
      violation(root, '.github/workflows/ci.yml', (value) => value.replace('pull_request:', 'workflow_dispatch:'), validate, /CI must run on pull requests/);
      violation(root, 'scripts/lib/acceptance-plan.ts', (value) => value.replace("args: ['ci']", "args: ['install']"), validate, /CI must install with npm ci/);
      violation(root, '.github/workflows/release.yml', (value) => value.replace("tags: ['v*']", "tags: ['other*']"), validate, /release workflow must reproduce tagged releases/);
      const file = path.join(root, 'LICENSE');
      const original = readFileSync(file);
      rmSync(file);
      expect(validate().join('\n')).toContain('missing LICENSE');
      writeFileSync(file, original);
      expect(validate()).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
