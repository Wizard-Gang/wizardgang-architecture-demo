import { spawnSync } from 'node:child_process';
import { extname } from 'node:path';
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const read = (file: string): string => fs.readFileSync(file, 'utf8');
const self = 'tests/demo-312-retire-checked-in-release-history.test.ts';
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.txt', '.yaml', '.yml']);

describe('DEMO-312 repository release-history retirement', () => {
  it('keeps per-version release history and references out of the current source tree', () => {
    expect(fs.existsSync('docs/releases')).toBe(false);

    const tracked = spawnSync('git', ['ls-files'], { encoding: 'utf8' });
    expect(tracked.status, tracked.stderr).toBe(0);
    const stale = tracked.stdout
      .split('\n')
      .filter(Boolean)
      .filter((file) => fs.existsSync(file))
      .filter((file) => file !== self && textExtensions.has(extname(file)))
      .filter((file) => read(file).includes('docs/releases'));

    expect(stale).toEqual([]);
  });

  it('publishes GitHub Releases from annotated tag identity and GitHub history', () => {
    const workflow = read('.github/workflows/release.yml');

    expect(workflow).toContain('Verify annotated semantic release identity');
    expect(workflow).toContain('git cat-file -t "$tag_ref"');
    expect(workflow).toContain('tag_commit="$(git rev-list -n 1 "$GITHUB_REF_NAME")"');
    expect(workflow).toContain('checkout_commit="$(git rev-parse HEAD)"');
    expect(workflow).toContain('package_version="$(node scripts/release-workflow.ts package-version < package.json)"');
    expect(workflow).toContain('--generate-notes');
    expect(workflow).toContain('--notes-start-tag "$PREVIOUS_TAG"');
    expect(workflow).toContain('--verify-tag');
    expect(workflow).not.toContain('docs/releases');
  });

  it('keeps the live Git lifecycle from recreating checked-in release prose', () => {
    const workflow = read('.github/workflows/git-demo.yml');

    expect(workflow).toContain('npm version "$VERSION" --no-git-tag-version');
    expect(read('scripts/git-demo-workflow.ts')).toContain("git(['add', 'package.json', 'package-lock.json'])");
    expect(workflow).not.toContain('docs/releases');
  });

  it('documents GitHub Releases and annotated tags as release-history authority', () => {
    const releaseManagement = read('docs/RELEASE-MANAGEMENT.md');

    expect(releaseManagement).toContain('The annotated tag and GitHub Release are the historical release authority.');
    expect(releaseManagement).toContain('The repository does not maintain a parallel per-version Markdown release archive or root changelog.');
    expect(releaseManagement).not.toContain('docs/releases');
    expect(releaseManagement).not.toMatch(/\bv0\.\d+\.\d+\b/);
  });
});
