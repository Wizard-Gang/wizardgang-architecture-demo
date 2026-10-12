import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const read = (file: string): string => fs.readFileSync(file, 'utf8');

describe('DEMO-312 repository release-history retirement', () => {
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
  });

  it('keeps the live Git lifecycle from recreating checked-in release prose', () => {
    const workflow = read('.github/workflows/git-demo.yml');

    expect(workflow).toContain('npm version "$VERSION" --no-git-tag-version');
    expect(read('scripts/git-demo-workflow.ts')).toContain("git(['add', 'package.json', 'package-lock.json'])");
  });
});
