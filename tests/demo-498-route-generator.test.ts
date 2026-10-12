import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generatedArtifactDefinitions } from '../scripts/validate-generated-artifacts.ts';

describe('direct route manifest generation', () => {
  it('uses the canonical serializer directly, with parity as the single tracked freshness owner', () => {
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    const scripts = JSON.parse(read('package.json')).scripts;
    expect(scripts['generate:routes']).toBe('node scripts/generate-route-manifest.ts');
    expect(scripts['validate:routes']).toBe('vitest run tests/route-artifacts.test.ts');
    const routes = generatedArtifactDefinitions.find((definition) => definition.id === 'routes');
    expect(routes?.command).toEqual(['node', ['scripts/generate-route-manifest.ts']]);
    expect(routes?.outputs).toEqual(['src/generated/route-manifest.json']);

    const generator = read('scripts/generate-route-manifest.ts');
    expect(generator).toContain("vite.ssrLoadModule('/src/routing/application-routes.ts')");
    expect(generator).toContain("vite.ssrLoadModule('/src/routing/artifacts.ts')");
    expect(generator).toContain('artifacts.serializeRouteManifest(registry.applicationRouteRegistry.declarations)');
    expect(generator).toContain("writeFileSync(path.join(cwd, 'src/generated/route-manifest.json'), serialized)");
    expect(generator).not.toContain('ROUTE_ARTIFACTS_WRITE');
    expect(generator).not.toContain("process.argv.includes('--check')");

    // Route policy, serializer determinism, and invalid-route cases belong to domain tests.
    const tests = read('tests/route-artifacts.test.ts');
    expect(tests).toContain('serializeRouteManifest(declarations)');
    expect(tests).toContain('buildRouteManifest(declarations)');
    expect(tests).not.toContain('ROUTE_ARTIFACTS_WRITE');
    expect(tests).not.toContain('writeFileSync');
    expect(tests).not.toContain('src/generated/route-manifest.json');
  });
});
