/** WG-ARCH-001 §27: copy this file to scripts/ in another product repository.
 * Universal process checks are capability-neutral. Product repositories declare
 * their profile in config/repository-capabilities.json; the reference-stack
 * profile adds the TypeScript/React/Vite/Vitest/Worker/release contract.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScaffold } from './validate-scaffold.ts';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
type Reader = (name: string) => string;

const REFERENCE_CAPABILITIES = ['typescript', 'react', 'vite', 'vitest', 'browser', 'cloudflareWorker', 'release'];

function createReader(root: string, failures: string[]): Reader {
  return (name) => {
    const file = path.join(root, name);
    if (!existsSync(file)) {
      failures.push(`missing ${name}`);
      return '';
    }
    return readFileSync(file, 'utf8');
  };
}

function parseJson(read: Reader, name: string, failures: string[]): any {
  const source = read(name);
  if (!source) return {};
  try {
    return JSON.parse(source);
  } catch {
    failures.push(`${name} must be JSON`);
    return {};
  }
}

function loadCapabilityDeclaration(read: Reader, failures: string[]): any {
  const declaration = parseJson(read, 'config/repository-capabilities.json', failures);
  if (declaration.schemaVersion !== 1) failures.push('repository capability declaration must use schemaVersion 1');
  if (!['universal', 'reference-stack'].includes(declaration.profile)) failures.push('repository capability profile must be universal or reference-stack');
  if (!declaration.capabilities || Array.isArray(declaration.capabilities) || typeof declaration.capabilities !== 'object') {
    failures.push('repository capability declaration must define a capabilities object');
    return declaration;
  }
  for (const capability of REFERENCE_CAPABILITIES) {
    if (typeof declaration.capabilities[capability] !== 'boolean') failures.push(`repository capability ${capability} must be boolean`);
  }
  return declaration;
}

export function validateUniversalRepositoryBaseline(root: string = DEFAULT_ROOT): string[] {
  const failures: string[] = [];
  const read = createReader(root, failures);
  for (const file of ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE', '.gitignore', '.node-version', '.npmrc', 'package.json', 'package-lock.json', '.github/workflows/ci.yml']) read(file);
  for (const retired of ['CHANGELOG.md']) if (existsSync(path.join(root, retired))) failures.push(`retire ${retired}; tags and GitHub Releases hold release history`);

  const pkg = parseJson(read, 'package.json', failures);
  const lock = parseJson(read, 'package-lock.json', failures);
  loadCapabilityDeclaration(read, failures);
  const node = read('.node-version').trim();
  if (!/^26\.\d+\.\d+$/.test(node) || pkg.engines?.node !== '26.x') failures.push('pin exact Node 26 in .node-version and engines.node 26.x');
  if (!/^npm@12\.\d+\.\d+$/.test(pkg.packageManager ?? '') || pkg.engines?.npm !== '12.x') failures.push('pin exact npm 12 in packageManager and engines.npm 12.x');
  const npmrc = read('.npmrc');
  if (!/^engine-strict=true\s*$/m.test(npmrc)) failures.push('.npmrc must set engine-strict=true');
  if (!/^strict-allow-scripts=true\s*$/m.test(npmrc)) failures.push('.npmrc must set strict-allow-scripts=true');
  if (!pkg.allowScripts || Array.isArray(pkg.allowScripts) || typeof pkg.allowScripts !== 'object') failures.push('package.json must declare approved dependency install scripts in allowScripts');
  if (pkg.type !== 'module') failures.push('package.json must use type: module');
  if (lock.lockfileVersion < 3 || lock.packages?.['']?.version !== pkg.version) failures.push('package-lock.json must be a current npm lockfile for the package');

  const scripts = pkg.scripts ?? {};
  if (!scripts.check) failures.push('missing npm run check');
  const checkPlan = scripts.check === 'node scripts/check.ts' ? read('scripts/lib/acceptance-plan.ts') : scripts.check ?? '';
  if (!/\bvalidate:repository-baseline\b/.test(checkPlan)) failures.push('check must invoke validate:repository-baseline');
  if (!/\bvalidate:history\b/.test(checkPlan)) failures.push('check must validate sequential controlled history');

  const ci = read('.github/workflows/ci.yml');
  if (!/pull_request:/.test(ci) || !/branches:\s*\[main\]/.test(ci)) failures.push('CI must run on pull requests and main');
  if (!/node-version-file:\s*\.node-version/.test(ci)) failures.push('CI must use the pinned Node version');
  const readLocalModuleGraph = (entry: string, seen: Set<string> = new Set()): string => {
    if (seen.has(entry)) return '';
    seen.add(entry);
    const source = read(entry);
    const directory = path.posix.dirname(entry);
    const imports = [...source.matchAll(/\bfrom\s+['"]((?:\.\.?\/)[^'"]+)['"]/g)]
      .map(([, specifier]) => path.posix.normalize(path.posix.join(directory, specifier)));
    return [source, ...imports.map((specifier) => readLocalModuleGraph(specifier, seen))].join('\n');
  };
  const ciCommand = /npm run validate:ci/.test(ci) ? readLocalModuleGraph('scripts/ci-validation.ts') : ci;
  if (!/npm\s+ci|args:\s*\['ci'\]/.test(ciCommand) || !/npm run check|\['run', 'check'\]|acceptanceCommands/.test(ciCommand)) failures.push('CI must install with npm ci and run check');
  return failures;
}

export function validateReferenceStackBaseline(root: string = DEFAULT_ROOT, declaredCapabilities: any = null): string[] {
  const failures: string[] = [];
  const read = createReader(root, failures);
  const declaration = declaredCapabilities ?? loadCapabilityDeclaration(read, failures);
  for (const capability of REFERENCE_CAPABILITIES) {
    if (declaration.capabilities?.[capability] !== true) failures.push(`reference-stack profile requires capability ${capability}`);
  }
  for (const file of ['tsconfig.json', 'wrangler.jsonc', 'vite.config.ts', '.github/workflows/release.yml']) read(file);

  const pkg = parseJson(read, 'package.json', failures);
  const tsconfig = parseJson(read, 'tsconfig.json', failures);
  const major = (name: string) => Number(String(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? '').match(/\d+/)?.[0]);
  for (const [name, version] of [['typescript', 7], ['wrangler', 4], ['vite', 8], ['vitest', 5], ['react', 19], ['react-dom', 19]] as const) {
    if (major(name) !== version) failures.push(`pin ${name} major ${version}`);
  }
  if (tsconfig.compilerOptions?.strict !== true) failures.push('TypeScript strict mode required');

  const scripts = pkg.scripts ?? {};
  for (const name of ['dev', 'build', 'typecheck', 'test']) if (!scripts[name]) failures.push(`missing npm run ${name}`);
  if (!/\btsc\b/.test(scripts.typecheck ?? '')) failures.push('typecheck must invoke tsc');
  if (!/\bvitest\b/.test(scripts.test ?? '')) failures.push('test must invoke Vitest');
  if (/\b(?:deploy|publish)\b|--env\s+production/.test(`${scripts.dev ?? ''} ${scripts.build ?? ''}`)) failures.push('dev and build cannot deploy');

  const wrangler = read('wrangler.jsonc');
  if (!/"main"\s*:\s*"src\//.test(wrangler) || !/"assets"\s*:\s*\{/.test(wrangler)) failures.push('Wrangler must configure a Worker with Static Assets');
  const vite = read('vite.config.ts');
  if (!vite.includes('assets/[name]-[hash]')) failures.push('Vite must emit content-hashed browser assets');
  const release = read('.github/workflows/release.yml');
  if (!/tags:\s*\['v\*'\]/.test(release) || !/npm ci/.test(release) || !/npm run check/.test(release)) failures.push('release workflow must reproduce tagged releases with npm ci and check');
  return failures;
}

export function validateRepositoryBaseline(root: string = DEFAULT_ROOT): string[] {
  const failures = validateUniversalRepositoryBaseline(root);
  const capabilityFailures: string[] = [];
  const declaration = loadCapabilityDeclaration(createReader(root, capabilityFailures), capabilityFailures);
  if (declaration.profile === 'reference-stack') {
    failures.push(...validateReferenceStackBaseline(root, declaration));
    // The product scaffold shares this owner on the canonical current checkout;
    // minimal external profile fixtures still exercise just the universal contract.
    if (existsSync(path.join(root, 'src/router.ts')) && existsSync(path.join(root, 'src/generated/route-manifest.json'))) {
      failures.push(...validateScaffold(root).failures);
    }
  }
  return failures;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = validateRepositoryBaseline();
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
  } else console.log('WG-ARCH-001 repository baseline OK.');
}
