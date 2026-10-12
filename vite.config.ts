import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const ROOT = import.meta.dirname;
const ASSET_MANIFEST_PATH = resolve(ROOT, 'src/generated/asset-manifest.json');

const vendorAssets = [
  ['assets/graphiql.js', 'node_modules/@graphql-yoga/graphiql/dist/yoga-graphiql.umd.js'],
  ['assets/editor.worker.js', 'node_modules/@graphql-yoga/graphiql/dist/monacoeditorwork/editor.worker.bundle.js'],
  ['assets/json.worker.js', 'node_modules/@graphql-yoga/graphiql/dist/monacoeditorwork/json.worker.bundle.js'],
  ['assets/graphql.worker.js', 'node_modules/@graphql-yoga/graphiql/dist/monacoeditorwork/graphql.worker..bundle.js'],
  ['assets/axe.min.js', 'node_modules/axe-core/axe.min.js'],
  ['assets/og.png', 'src/assets/og.png'],
] as const;

const emittedAssets = vendorAssets.map(([assetPath, sourcePath]) => {
  const source = readFileSync(resolve(ROOT, sourcePath));
  const fingerprint = createHash('sha256').update(source).digest('hex').slice(0, 16);
  const extension = assetPath.slice(assetPath.lastIndexOf('.'));
  return { assetPath, fileName: `${assetPath.slice(0, -extension.length)}-${fingerprint}${extension}`, source };
});

function vendorAsset(assetPath: string): string {
  const asset = emittedAssets.find((entry) => entry.assetPath === assetPath);
  if (!asset) throw new Error(`Unknown vendored browser asset: ${assetPath}`);
  return `/${asset.fileName}`;
}

function browserAssets(): Plugin {
  return {
    name: 'browser-assets',
    buildStart() {
      for (const { fileName, source } of emittedAssets) {
        this.emitFile({
          type: 'asset',
          fileName,
          source,
        });
      }
    },
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).sort();
      const stylesheet = (name: string) => {
        const matches = files.filter((file) => new RegExp(`^assets/${name}-[A-Za-z0-9_-]+\\.css$`).test(file));
        if (matches.length !== 1) this.error(`Expected one hashed ${name} stylesheet, found: ${matches.join(', ') || 'none'}`);
        return `/${matches[0]}`;
      };
      const browserModule = (name: string) => {
        const matches = files.filter((file) => new RegExp(`^assets/${name}-[A-Za-z0-9_-]+\\.js$`).test(file));
        if (matches.length !== 1) this.error(`Expected one hashed ${name} browser module, found: ${matches.join(', ') || 'none'}`);
        return `/${matches[0]}`;
      };
      for (const { fileName } of emittedAssets) {
        if (!files.includes(fileName)) this.error(`Missing emitted browser asset ${fileName}`);
      }

      const manifest = {
        version: 1,
        assets: {
          'styles.shell': stylesheet('shell'),
          'styles.demos': stylesheet('demos'),
          'scripts.shell': browserModule('shell-browser'),
          'scripts.admin': browserModule('admin-browser'),
          'scripts.demos': browserModule('demos-browser'),
          'scripts.d1': browserModule('d1-browser'),
          'scripts.r2': browserModule('r2-browser'),
          'scripts.rest': browserModule('rest-browser'),
          'scripts.graphql': browserModule('graphql-browser'),
          'scripts.graphiql': browserModule('graphiql-browser'),
          'scripts.webhooks': browserModule('webhooks-browser'),
          'scripts.identity': browserModule('identity-browser'),
          'scripts.mcp': browserModule('mcp-browser'),
          'scripts.edge': browserModule('edge-browser'),
          'scripts.workers': browserModule('workers-browser'),
          'scripts.durableObjects': browserModule('durable-objects-browser'),
          'scripts.accessibility': browserModule('accessibility-browser'),
          'scripts.accessibilityLab': browserModule('accessibility-lab-browser'),
          'scripts.i18n': browserModule('i18n-browser'),
          'vendor.graphiql.script': vendorAsset('assets/graphiql.js'),
          'vendor.graphiql.styles': stylesheet('graphiql'),
          'vendor.monaco.editor': vendorAsset('assets/editor.worker.js'),
          'vendor.monaco.json': vendorAsset('assets/json.worker.js'),
          'vendor.monaco.graphql': vendorAsset('assets/graphql.worker.js'),
          'vendor.axe': vendorAsset('assets/axe.min.js'),
          'social.card': vendorAsset('assets/og.png'),
        },
      } as const;
      const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
      if (process.env.ASSET_MANIFEST_WRITE === '1') {
        writeFileSync(ASSET_MANIFEST_PATH, serialized);
        return;
      }
      let committed = '';
      try {
        committed = readFileSync(ASSET_MANIFEST_PATH, 'utf8');
      } catch {
        this.error('Missing src/generated/asset-manifest.json; run npm run generate:assets.');
      }
      if (committed !== serialized) this.error('src/generated/asset-manifest.json is stale; run npm run generate:assets.');
    },
  };
}

export default defineConfig({
  plugins: [browserAssets()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      preserveEntrySignatures: 'strict',
      input: {
        shell: resolve(ROOT, 'src/styles/shell.css'),
        demos: resolve(ROOT, 'src/styles/demos.css'),
        graphiql: resolve(ROOT, 'src/styles/graphiql.css'),
        'shell-browser': resolve(ROOT, 'src/browser/shell.ts'),
        'admin-browser': resolve(ROOT, 'src/browser/admin.ts'),
        'demos-browser': resolve(ROOT, 'src/browser/demos.ts'),
        'd1-browser': resolve(ROOT, 'src/browser/d1.ts'),
        'r2-browser': resolve(ROOT, 'src/browser/r2.ts'),
        'rest-browser': resolve(ROOT, 'src/browser/rest.ts'),
        'graphql-browser': resolve(ROOT, 'src/browser/graphql.ts'),
        'graphiql-browser': resolve(ROOT, 'src/browser/graphiql.ts'),
        'webhooks-browser': resolve(ROOT, 'src/browser/webhooks.ts'),
        'identity-browser': resolve(ROOT, 'src/browser/identity.ts'),
        'mcp-browser': resolve(ROOT, 'src/browser/mcp.ts'),
        'edge-browser': resolve(ROOT, 'src/browser/edge.ts'),
        'workers-browser': resolve(ROOT, 'src/browser/workers.ts'),
        'durable-objects-browser': resolve(ROOT, 'src/browser/durable-objects.ts'),
        'accessibility-browser': resolve(ROOT, 'src/browser/accessibility.ts'),
        'accessibility-lab-browser': resolve(ROOT, 'src/browser/accessibility-lab.ts'),
        'i18n-browser': resolve(ROOT, 'src/browser/i18n.ts'),
      },
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
});
