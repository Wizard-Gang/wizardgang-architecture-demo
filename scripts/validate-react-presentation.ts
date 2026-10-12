import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync, Visitor } from 'oxc-parser';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PRODUCERS = new Map([
  ['src/ui/page.ts', 'renderDocument('],
  ['src/ui/graphiql-response.ts', 'localGraphiqlDocument('],
  ['src/ui/graphiql-document.tsx', 'renderToStaticMarkup('],
  ['src/ui/document.tsx', 'renderToStaticMarkup('],
  ['src/ui/accessibility-lab.tsx', 'renderToStaticMarkup('],
  ['src/demos/demo-presentations.ts', 'renderToStaticMarkup('],
]);
const AUDITED_RAW_HTML_COMPONENT = 'src/ui/audited-raw-html.tsx';

function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(name) : [name];
  });
}

export function validateReactPresentation(root: string = ROOT): string[] {
  const failures: string[] = [];
  const report = (file: string, detail: string) => failures.push(`${file}: ${detail}`);
  const sourceFiles = filesUnder(path.join(root, 'src')).filter((file) => /\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.d.ts'));
  for (const absolute of sourceFiles) {
    const file = path.relative(root, absolute).replaceAll(path.sep, '/');
    const source = readFileSync(absolute, 'utf8');
    const { program, errors } = parseSync(file, source);
    if (errors.length) { report(file, 'cannot parse source'); continue; }
    const browser = file.startsWith('src/browser/');
    const htmlResponse = /['"]content-type['"]\s*:\s*['"]text\/html|headers\.set\(['"]content-type['"],\s*['"]text\/html/.test(source);
    if (htmlResponse && file !== 'src/lib/http.ts' && !HTML_PRODUCERS.has(file)) report(file, 'HTML response must come from a declared React document/fragment');
    if (htmlResponse && HTML_PRODUCERS.has(file) && !source.includes(HTML_PRODUCERS.get(file)!)) report(file, 'declared HTML producer no longer calls its React renderer');
    if (browser && /(?:react-router|@remix-run\/router|react-dom\/client|\bcreateBrowserRouter\b|\bhydrateRoot\b|\bcreateRoot\b)/.test(source)) report(file, 'client router or React root API in browser source');
    if (file !== AUDITED_RAW_HTML_COMPONENT && source.includes('dangerouslySetInnerHTML')) report(file, 'raw HTML insertion outside the audited component');
    if (file === 'src/lib/http.ts' && !/function safeError\(/.test(source)) report(file, 'safe HTML error exception moved');
    new Visitor({
      TemplateLiteral(node) {
        const literal = node.quasis.map((quasi) => quasi.value.raw).join('');
        // These two modules serialize SAML and sitemap XML, never browser HTML.
        if (file === 'src/api/identity.ts' || file === 'src/api/sitemap.ts') return;
        if (file !== 'src/lib/http.ts' && /<\s*(?:!doctype|\/?[a-z][\w-]*)(?:\s|\/?>)/i.test(literal)) report(file, 'HTML constructed with a template string');
      },
      NewExpression(node: any) {
        if (node.callee?.name !== 'Response') return;
        const body = node.arguments?.[0];
        if (body?.type === 'Literal' && typeof body.value === 'string' && /<\s*[a-z]/i.test(body.value) && file !== 'src/lib/http.ts') report(file, 'HTML response body is a raw literal');
      },
      ImportDeclaration(node) {
        const imported = node.source?.value ?? '';
        if (browser && /^(react-dom\/client|react-router(?:-dom)?|@remix-run\/router)$/.test(imported)) report(file, `forbidden browser dependency ${imported}`);
        if (imported.endsWith('.css') && !file.startsWith('src/styles/')) report(file, 'stylesheet imported outside src/styles/');
      },
    }).visit(program);
  }
  const cssFiles = filesUnder(path.join(root, 'src')).filter((file) => file.endsWith('.css'));
  for (const file of cssFiles) {
    if (!path.relative(path.join(root, 'src/styles'), file).startsWith('..')) continue;
    report(path.relative(root, file), 'stylesheet outside src/styles/');
  }
  const http = readFileSync(path.join(root, 'src/lib/http.ts'), 'utf8');
  const sharedPolicy = http.match(/'content-security-policy':\s*`([^`]+)`/)?.[1];
  if (!sharedPolicy || sharedPolicy.includes("'unsafe-inline'")) report('src/lib/http.ts', 'shared CSP missing or permits unsafe-inline');
  const manifest = JSON.parse(readFileSync(path.join(root, 'docs/asset-manifest.json'), 'utf8'));
  for (const [key, asset] of Object.entries<string>(manifest.assets)) {
    if (!/^\/assets\/[a-z0-9][a-z0-9.-]*-[a-zA-Z0-9_-]{8,}\.(?:js|css|png)$/.test(asset)) report('docs/asset-manifest.json', `unhashed browser asset ${key}: ${asset}`);
    const built = path.join(root, 'dist/client', asset.slice(1));
    if (existsSync(path.join(root, 'dist/client')) && !existsSync(built)) report('dist/client', `manifest asset missing from Static Assets: ${asset}`);
    if ((key.startsWith('vendor.') && key !== 'vendor.graphiql.styles' || key === 'social.card') && existsSync(built)) {
      const fingerprint = createHash('sha256').update(readFileSync(built)).digest('hex').slice(0, 16);
      if (!asset.includes(`-${fingerprint}.`)) report('dist/client', `vendored asset fingerprint does not match bytes: ${asset}`);
    }
    // GraphiQL is an independently mounted third-party client application; do not
    // confuse its internal React runtime with first-party page hydration.
    if (key.startsWith('scripts.') && existsSync(built) && /\b(?:hydrateRoot|createRoot|createBrowserRouter|react-router)\b/.test(readFileSync(built, 'utf8'))) report('dist/client', `first-party browser module contains a React root or client router: ${asset}`);
  }
  for (const file of filesUnder(path.join(root, 'dist/client/assets'))) {
    const asset = `/assets/${path.basename(file)}`;
    if (!Object.values(manifest.assets).includes(asset)) report('dist/client', `unregistered browser asset: ${asset}`);
  }
  const config = readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8');
  if (!/"binding"\s*:\s*"ASSETS"/.test(config) || !/"directory"\s*:\s*"\.\/dist\/client"/.test(config)) report('wrangler.jsonc', 'browser files must be served through Workers Static Assets');
  const assetHandler = readFileSync(path.join(root, 'src/ui/assets.ts'), 'utf8');
  if (!assetHandler.includes('env.ASSETS.fetch(') || !assetHandler.includes('max-age=31536000, immutable')) report('src/ui/assets.ts', 'registered assets must use static binding and immutable caching');
  const vite = readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  if (!vite.includes("resolve(ROOT, 'src/styles/graphiql.css')") || !vite.includes("resolve(ROOT, 'src/styles/shell.css')") || !vite.includes('assets/[name]-[hash]')) report('vite.config.ts', 'stylesheets must build from src/styles/ into hashed assets');
  if (!vite.includes('createHash(') || !vite.includes('vendorAsset(')) report('vite.config.ts', 'vendored browser assets must be content hashed');
  return failures;
}

export function validateWorkerBundle(root: string = ROOT): string[] {
  const failures: string[] = [];
  const workerDir = path.join(root, 'dist/worker');
  const bundles = filesUnder(workerDir).filter((file) => file.endsWith('.js'));
  if (bundles.length !== 1) return [`dist/worker: expected exactly one Worker JavaScript bundle after npm run build:worker; found ${bundles.length}`];
  const bundlePath = bundles[0];
  const bundleLabel = path.relative(root, bundlePath).replaceAll(path.sep, '/');
  const bundle = readFileSync(bundlePath);
  const manifest = JSON.parse(readFileSync(path.join(root, 'docs/asset-manifest.json'), 'utf8'));
  for (const [key, asset] of Object.entries<string>(manifest.assets)) {
    if (!key.startsWith('vendor.') && key !== 'social.card') continue;
    const browserAsset = path.join(root, 'dist/client', asset.slice(1));
    if (!existsSync(browserAsset)) { failures.push(`${asset}: missing browser asset`); continue; }
    const bytes = readFileSync(browserAsset);
    if (bundle.includes(bytes.subarray(0, Math.min(bytes.length, 256)))) failures.push(`${bundleLabel}: browser-only vendored payload bundled: ${asset}`);
  }
  return failures;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = process.argv.includes('--worker-bundle') ? validateWorkerBundle() : validateReactPresentation();
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
  } else console.log('React presentation, shared CSP, and static asset source boundaries OK.');
}
