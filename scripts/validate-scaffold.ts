import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

export function validateScaffold(root = process.cwd()) {
  const failures: string[] = [];
  const exists = (file: string) => fs.existsSync(path.join(root, file));
  const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

  for (const requiredFile of [
    'src/generated/asset-manifest.json',
    'src/generated/route-manifest.json',
    'vite.config.ts',
    'src/styles/shell.css',
    'src/styles/demos.css',
    'src/router.ts',
    'src/routing/registry.ts',
    'src/routing/application-routes.ts',
    'src/routing/navigation.ts',
    'src/routing/artifacts.ts',
    'src/routing/operational-routes.ts',
    'src/routing/platform-laboratory-routes.ts',
    'src/routing/interface-identity-routes.ts',
    'src/platform/route-capability.ts',
    'src/interfaces/route-capability.ts',
    'src/interfaces/route-capabilities/index.ts',
    'tests/route-registry.test.ts',
    'tests/application-route-registry.test.ts',
    'tests/route-artifacts.test.ts',
  ]) {
    if (!exists(requiredFile)) failures.push(`missing required file: ${requiredFile}`);
  }

  let manifest: any = [];
  try {
    manifest = JSON.parse(read('src/generated/route-manifest.json'));
  } catch (error) {
    failures.push(`route manifest is not valid JSON: ${String(error)}`);
  }
  if (!Array.isArray(manifest) || manifest.length === 0) failures.push('route manifest must contain registered routes');
  const ids = new Set();
  const patterns = new Set();
  for (const entry of manifest) {
    if (!entry || typeof entry !== 'object') {
      failures.push('route manifest contains a non-object entry');
      continue;
    }
    for (const field of ['id', 'route', 'kind', 'visibility', 'title', 'description', 'source']) {
      if (!(field in entry)) failures.push(`route manifest entry missing ${field}: ${JSON.stringify(entry)}`);
    }
    if (ids.has(entry.id)) failures.push(`route manifest contains duplicate ID: ${entry.id}`);
    if (patterns.has(entry.route)) failures.push(`route manifest contains duplicate pattern: ${entry.route}`);
    ids.add(entry.id);
    patterns.add(entry.route);
    if (!Array.isArray(entry.methods) || entry.methods.length === 0) failures.push(`route manifest missing methods: ${entry.id}`);
    const sourceModule = entry.source?.module;
    if (!sourceModule || !exists(sourceModule)) failures.push(`route manifest source does not exist: ${entry.id} -> ${sourceModule}`);
  }

  const router = read('src/router.ts');
  for (const token of ['applicationRouteRegistry', 'matchRoute', 'normalizeRoutePath', 'safeError', 'route.handler']) {
    if (!router.includes(token)) failures.push(`router missing final declarative invariant: ${token}`);
  }
  for (const removedToken of [
    'API_PREFIXES',
    'routeOperationalRequest',
    'routePlatformLaboratoryRequest',
    'routeInterfaceIdentityRequest',
    'interfaceIdentityWantsHtml',
    'isInterfaceIdentityApiLike',
    'demosByRoute',
    'LEGACY_OFFLINE_AVAILABLE_PATHS',
  ]) {
    if (router.includes(removedToken)) failures.push(`router still contains removed dispatch logic: ${removedToken}`);
  }
  if (/\bpath\s*===/.test(router) || /\bpath\.startsWith\(/.test(router)) {
    failures.push('router still contains application path dispatch or prefix detection');
  }

  const applicationRoutes = read('src/routing/application-routes.ts');
  for (const token of [
    'operationalRouteRegistry',
    'interfaceIdentityRouteRegistry',
    'platformLaboratoryRouteRegistry',
    'createApplicationRouteRegistry',
    'validateApplicationDeclaration',
    'routeUrlFromRegistry',
    'configureRegisteredRoutes',
  ]) {
    if (!applicationRoutes.includes(token)) failures.push(`application registry missing invariant: ${token}`);
  }

  const generator = read('scripts/generate-route-manifest.ts');
  const slash = '/';
  for (const removedToken of ['const machine =', 'requiredRoutes =', `${slash}__api${slash}`, `${slash}v1${slash}`]) {
    if (generator.includes(removedToken)) failures.push(`route generator still contains a hardcoded route inventory: ${removedToken}`);
  }

  if (exists('src/demos/registry.ts')) failures.push('retired demo query-view registry must not remain');


  function walk(directory: string): void {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.name === 'node_modules' || item.name === '.git') continue;
      const full = path.join(directory, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.name.toLowerCase().endsWith('.pdf')) failures.push(`PDF is not allowed in this package: ${path.relative(root, full)}`);
    }
  }
  walk(root);

  return { failures, routeCount: manifest.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateScaffold();
  if (result.failures.length) { for (const failure of result.failures) console.error(failure); process.exitCode = 1; }
  else console.log(`Scaffold validation passed for ${result.routeCount} registry-generated routes.`);
}
