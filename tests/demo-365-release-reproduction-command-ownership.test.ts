import { acceptanceStages } from '../scripts/lib/acceptance-plan.ts';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expandedNpmRunSequence } from '../scripts/lib/acceptance-plan.ts';

const read = (file: string) => fs.readFileSync(file, 'utf8');
const pkg = JSON.parse(read('package.json'));
const releaseWorkflow = read('.github/workflows/release.yml');
const canonicalAdvisory = 'security:dependency-advisories';
const staleAdvisory = ['security', 'dependencies'].join(':');

function namedStep(workflow: string, name: string) {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  if (start < 0) return '';
  const next = workflow.indexOf('\n      - name:', start + marker.length);
  return workflow.slice(start, next < 0 ? workflow.length : next);
}

describe('DEMO-365 exact release reproduction command ownership', () => {
  it('keeps every tagged reproduction npm command executable from package.json', () => {
    const reproduce = namedStep(releaseWorkflow, 'Reproduce the tagged state');
    expect(reproduce).not.toBe('');
    const commands = [...reproduce.matchAll(/^\s+npm run ([A-Za-z0-9:_-]+)\s*$/gm)].map((match) => match[1]);

    expect(commands.filter((command) => command === 'check')).toHaveLength(1);
    expect(commands.filter((command) => command === canonicalAdvisory)).toHaveLength(1);
    expect(commands).toHaveLength(2);
    expect(commands.indexOf('check')).toBeLessThan(commands.indexOf(canonicalAdvisory));
    for (const command of commands) {
      expect(pkg.scripts?.[command], `missing package.json script: ${command}`).toEqual(expect.any(String));
      expect(pkg.scripts[command].trim()).not.toBe('');
    }
    expect(commands.filter((command) => command === canonicalAdvisory)).toHaveLength(1);
    expect(commands).not.toContain('validate:migrations');
    const expanded = expandedNpmRunSequence(pkg.scripts, 'check');
    for (const run of ['validate:generated-artifacts', 'validate:migrations', 'build:worker', 'validate:worker-bundle', 'test:site-accessibility']) {
      expect(expanded.filter((candidate) => candidate === run), run).toHaveLength(1);
    }
    expect(expanded).not.toContain('build');
    expect(expanded).not.toContain('build:client');
    expect(acceptanceStages.map(({ script }) => `npm run ${script}`).join(' && ').indexOf('npm run validate:generated-artifacts')).toBeLessThan(
      acceptanceStages.map(({ script }) => `npm run ${script}`).join(' && ').indexOf('npm run build:worker'),
    );
    expect(acceptanceStages.map(({ script }) => `npm run ${script}`).join(' && ').indexOf('npm run validate:migrations')).toBeLessThan(
      acceptanceStages.map(({ script }) => `npm run ${script}`).join(' && ').indexOf('npm run test:site-accessibility'),
    );
  });

  it('keeps accepted client parity and Worker bundle check-owned, leaving production build to the pinned deploy workflow', () => {
    const reproduce = namedStep(releaseWorkflow, 'Reproduce the tagged state');
    expect(reproduce.split('\n').map((line) => line.trim())).not.toContain('npm run build');
    const accepted = expandedNpmRunSequence(pkg.scripts, 'check');
    expect(accepted.filter((run) => run === 'validate:generated-artifacts')).toHaveLength(1);
    expect(accepted.filter((run) => run === 'build:worker')).toHaveLength(1);
    expect(accepted.filter((run) => run === 'validate:worker-bundle')).toHaveLength(1);
    expect(accepted).not.toContain('build');
    expect(accepted).not.toContain('build:client');
    expect(pkg.scripts.build).toBe('npm run build:client && npm run build:worker');
    expect(pkg.scripts['build:client']).toBe('npm run generate:assets');
    expect(pkg.scripts['build:worker']).toContain('wrangler deploy --dry-run --outdir dist/worker');
    expect(pkg.scripts['build:worker']).toContain('npm run validate:worker-bundle');
    expect(releaseWorkflow).toContain('expected_sha: ${{ github.sha }}');
  });

  it('shares one fresh migrated local D1 store with browser audits and cleans it up after check', () => {
    const reproduce = namedStep(releaseWorkflow, 'Reproduce the tagged state');
    const ordered = [
      'local_d1_dir="$(mktemp -d)"',
      'trap \'rm -rf -- "$local_d1_dir"\' EXIT',
      'export WG_LOCAL_D1_PERSIST_TO="$local_d1_dir"',
      'npm run check',
      'unset WG_LOCAL_D1_PERSIST_TO',
      'npm run security:dependency-advisories',
    ];
    let position = -1;
    for (const part of ordered) {
      const next = reproduce.indexOf(part, position + 1);
      expect(next, `${part} must follow the preceding release reproduction step`).toBeGreaterThan(position);
      position = next;
    }
    expect(reproduce).not.toContain('npm run validate:migrations');
  });

  it('starts generated notes at the closest published release when an intervening tag did not publish', () => {
    expect(releaseWorkflow).toContain('candidate="$(git describe --tags --abbrev=0 "$search_commit"');
    expect(releaseWorkflow).toContain('repos/$GITHUB_REPOSITORY/releases/tags/$candidate');
    expect(releaseWorkflow).toContain('previous_tag="$candidate"');
    expect(releaseWorkflow).toContain('search_commit="$(git rev-list -n 1 "$candidate")^"');
  });

  it('retains locked installation, exact release identity, publication, and deploy ordering', () => {
    expect(releaseWorkflow).toContain('- name: Install locked dependencies\n        run: npm ci');
    expect(releaseWorkflow).toContain('Verify annotated semantic release identity');
    expect(releaseWorkflow).toContain('git cat-file -t "$tag_ref"');
    expect(releaseWorkflow).toContain('checkout_commit="$(git rev-parse HEAD)"');
    expect(releaseWorkflow).toContain('package_version="$(node scripts/release-workflow.ts package-version < package.json)"');
    expect(releaseWorkflow).toContain('Publish GitHub Release from tag and GitHub history');
    expect(releaseWorkflow).toContain('gh release create "${release_args[@]}"');

    const publication = releaseWorkflow.indexOf('Publish GitHub Release from tag and GitHub history');
    const deployJob = releaseWorkflow.indexOf('\n  deploy:\n');
    expect(publication).toBeGreaterThan(-1);
    expect(deployJob).toBeGreaterThan(publication);
    expect(releaseWorkflow.slice(deployJob)).toContain('needs: reproduce');
  });

  it('uses the canonical advisory name in release policy and leaves no stale command name tracked', () => {
    expect(releaseWorkflow).not.toContain(staleAdvisory);

    const grep = spawnSync('git', ['grep', '-n', '-F', staleAdvisory, '--'], { encoding: 'utf8' });
    expect(grep.status, grep.stdout || grep.stderr).toBe(1);
    expect(grep.stdout).toBe('');
  });
});
