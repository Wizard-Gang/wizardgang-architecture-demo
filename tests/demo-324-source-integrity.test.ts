import fs from 'node:fs';
import path from 'node:path';
import { parseSync, Visitor } from 'oxc-parser';
import { describe, expect, it, vi } from 'vitest';
import { accessibilitySection } from '../src/demos/accessibility-page';
import { safeError } from '../src/lib/http';
import { applicationRouteRegistry } from '../src/routing/application-routes';
import type { Env } from '../src/types';
import { loadHomePageData, renderHome } from '../src/ui/home';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const sourceModuleImports = import.meta.glob('../src/**/*.{ts,tsx}');
const toolingOnlyModules = new Set([
  'src/routing/artifacts.ts',
]);

const environment: Env = {
  WG_DB: {
    prepare() {
      throw new Error('source-integrity rendering must not depend on application storage');
    },
  },
  GITHUB_REPO_URL: 'https://github.com/Wizard-Gang/wizardgang-architecture-demo',
  GITHUB_BRANCH: 'main',
};

function sourceModules(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceModules(filePath);
    if (entry.name.endsWith('.d.ts')) return [];
    return /\.(?:[cm]?[jt]sx?)$/.test(entry.name) ? [filePath] : [];
  });
}

function importedSpecifiers(filePath: string): string[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const { program } = parseSync(filePath, source);
  const specifiers: string[] = [];

  new Visitor({
    ImportDeclaration(node) {
      if (typeof node.source.value === 'string') specifiers.push(node.source.value);
    },
    ExportNamedDeclaration(node) {
      if (typeof node.source?.value === 'string') specifiers.push(node.source.value);
    },
    ExportAllDeclaration(node) {
      if (typeof node.source.value === 'string') specifiers.push(node.source.value);
    },
    ImportExpression(node) {
      if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
        specifiers.push(node.source.value);
      }
    },
  }).visit(program);

  return specifiers;
}

function resolveSourceModule(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
  const base = path.resolve(path.dirname(importer), cleanSpecifier);
  const extension = path.extname(base);
  const candidates = [
    base,
    ...(!extension ? ['.ts', '.tsx', '.js', '.mjs', '.cjs'].map((suffix) => `${base}${suffix}`) : []),
    ...(extension === '.js' ? [`${base.slice(0, -3)}.ts`] : []),
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function reachableSourceModules(): Set<string> {
  const reachable = new Set<string>();
  const pending = [
    path.join(srcRoot, 'index.ts'),
    path.join(srcRoot, 'local-worker.ts'),
    ...(fs.existsSync(path.join(srcRoot, 'worker-entry.mjs')) ? [path.join(srcRoot, 'worker-entry.mjs')] : []),
    path.join(srcRoot, 'browser', 'shell.ts'),
    path.join(srcRoot, 'browser', 'demos.ts'),
    path.join(srcRoot, 'browser', 'd1.ts'),
    path.join(srcRoot, 'browser', 'r2.ts'),
    path.join(srcRoot, 'browser', 'rest.ts'),
    path.join(srcRoot, 'browser', 'graphql.ts'),
    path.join(srcRoot, 'browser', 'graphiql.ts'),
    path.join(srcRoot, 'browser', 'webhooks.ts'),
    path.join(srcRoot, 'browser', 'identity.ts'),
    path.join(srcRoot, 'browser', 'mcp.ts'),
    path.join(srcRoot, 'browser', 'edge.ts'),
    path.join(srcRoot, 'browser', 'workers.ts'),
    path.join(srcRoot, 'browser', 'durable-objects.ts'),
    path.join(srcRoot, 'browser', 'accessibility.ts'),
    path.join(srcRoot, 'browser', 'accessibility-lab.ts'),
    path.join(srcRoot, 'browser', 'i18n.ts'),
  ];
  while (pending.length > 0) {
    const filePath = pending.pop();
    if (!filePath || reachable.has(filePath)) continue;
    reachable.add(filePath);
    for (const specifier of importedSpecifiers(filePath)) {
      const dependency = resolveSourceModule(filePath, specifier);
      if (dependency?.startsWith(`${srcRoot}${path.sep}`) && !dependency.endsWith('.d.ts')) {
        pending.push(dependency);
      }
    }
  }
  return reachable;
}

describe('DEMO-324 source integrity', () => {
  const pageRoutes = applicationRouteRegistry.declarations.filter((route) => route.kind === 'page');

  it.each(pageRoutes.map((route) => [route.id, route.source.module, route.source.exportName] as const))(
    'loads the declared source export for page route %s',
    async (_routeId, sourceModule, sourceExport) => {
      expect(sourceExport).toBeTruthy();
      const loadModule = sourceModuleImports[`../${sourceModule}`];
      expect(loadModule, sourceModule).toBeTypeOf('function');
      const moduleExports = await loadModule();
      expect(moduleExports, `${sourceModule} must export ${sourceExport}`).toHaveProperty(sourceExport!);
      expect(moduleExports[sourceExport!], `${sourceModule}#${sourceExport} must be callable`).toBeTypeOf('function');
    },
  );

  it('keeps every source module reachable from the Worker entry or explicitly tooling-only', () => {
    const reachable = reachableSourceModules();
    const unreachable = sourceModules(srcRoot)
      .map((filePath) => path.relative(root, filePath))
      .filter((filePath) => !reachable.has(path.join(root, filePath)) && !toolingOnlyModules.has(filePath))
      .sort();
    expect(unreachable, 'Unreachable src modules must be deleted or listed as tooling-only.').toEqual([]);
    expect([...toolingOnlyModules].filter((filePath) => !fs.existsSync(path.join(root, filePath)))).toEqual([]);
  });

  it('links the dependency-free safe error page only to registered pages', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = safeError(new Request('https://demo.wizardgang.ai/failure', {
        headers: { accept: 'text/html' },
      }), new Error('synthetic failure'));
      const html = await response.text();
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
      const registeredPagePaths = new Set(pageRoutes.map((route) => route.pattern));
      expect(hrefs).toEqual(['/']);
      for (const href of hrefs) expect(registeredPagePaths.has(href), href).toBe(true);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('names the live homepage renderer in the homepage footer route source', async () => {
    const response = renderHome(environment, await loadHomePageData(environment));
    const html = await response.text();
    expect(html).toContain('Route source<span class="sr-only">: src/ui/home.tsx</span>');
    expect(html).not.toContain('Route source<span class="sr-only">: src/ui/page.ts</span>');
  });

  it('names the accessibility renderer in its demonstration route source', () => {
    const content = accessibilitySection(new Request('https://demo.wizardgang.ai/demos#accessibility'), environment);
    expect(content.body).toContain('/blob/main/src/demos/accessibility-page.ts');
  });
});
