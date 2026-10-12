import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');

export async function generateRouteManifest({ cwd = root } = {}): Promise<void> {
  // Vite resolves the application's extensionless TypeScript imports without a test-runner startup.
  const vite = await createServer({
    root: cwd,
    configFile: false,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const registry = await vite.ssrLoadModule('/src/routing/application-routes.ts');
    const artifacts = await vite.ssrLoadModule('/src/routing/artifacts.ts');
    if (!Array.isArray(registry.applicationRouteRegistry?.declarations)
      || typeof artifacts.serializeRouteManifest !== 'function') {
      throw new Error('Unable to load the declared route registry and its canonical serializer.');
    }
    const serialized = artifacts.serializeRouteManifest(registry.applicationRouteRegistry.declarations);
    writeFileSync(path.join(cwd, 'src/generated/route-manifest.json'), serialized);
  } finally {
    await vite.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateRouteManifest();
}
