import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(file, 'utf8');
const pkg = JSON.parse(read('package.json'));
const releaseWorkflow = read('.github/workflows/release.yml');

describe('DEMO-366 published immutable release deployment boundary', () => {
  it('fails closed instead of exposing raw npm Wrangler production deployment', () => {
    expect(pkg.scripts.deploy).toBe('node scripts/refuse-production-deploy.ts');
    expect(pkg.scripts.deploy).not.toContain('wrangler');
    const result = spawnSync(process.execPath, ['scripts/refuse-production-deploy.ts'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Production deployment is release-workflow only.');
  });

  it('publishes the immutable GitHub Release before invoking the shared deploy workflow', () => {
    const publish = releaseWorkflow.indexOf('Publish GitHub Release from tag and GitHub history');
    const deploy = releaseWorkflow.indexOf('\n  deploy:\n');
    expect(publish).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(publish);
    expect(releaseWorkflow.slice(deploy)).toContain('needs: reproduce');
  });

  it('passes exact release identity to the shared deploy workflow', () => {
    expect(releaseWorkflow).toContain('worker: demo');
    expect(releaseWorkflow).toContain('tag: ${{ github.ref_name }}');
    expect(releaseWorkflow).toContain('expected_sha: ${{ github.sha }}');
    expect(releaseWorkflow).toContain('secrets: inherit');
  });

  it('keeps tagged-source reproduction before publication and deployment', () => {
    const reproduce = releaseWorkflow.indexOf('Reproduce the tagged state');
    const publish = releaseWorkflow.indexOf('Publish GitHub Release from tag and GitHub history');
    expect(reproduce).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(reproduce);
    expect(releaseWorkflow.slice(reproduce, publish)).toContain('npm run check');
    expect(releaseWorkflow.slice(reproduce, publish)).toContain('npm run security:dependency-advisories');
  });
});
