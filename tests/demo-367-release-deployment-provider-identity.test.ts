import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(file, 'utf8');
const releaseWorkflow = read('.github/workflows/release.yml');
const wrangler = read('wrangler.jsonc');
const worker = read('src/index.ts');
const generator = read('scripts/generate-worker-entry.ts');

describe('DEMO-367 release-to-deployment identity after baseline cut-over', () => {
  it('keeps publication ahead of the shared production deployment', () => {
    const publication = releaseWorkflow.indexOf('Publish GitHub Release from tag and GitHub history');
    const deployJob = releaseWorkflow.indexOf('\n  deploy:\n');
    expect(publication).toBeGreaterThan(-1);
    expect(deployJob).toBeGreaterThan(publication);
    const deploy = releaseWorkflow.slice(deployJob);
    expect(deploy).toContain('needs: reproduce');
    expect(deploy).toContain('tag: ${{ github.ref_name }}');
    expect(deploy).toContain('expected_sha: ${{ github.sha }}');
  });

  it('bakes the exact tag version and commit into the shared shell release identity', () => {
    expect(generator).toContain('WG_VERSION and WG_COMMIT must be set together');
    expect(generator).toContain('WG_COMMIT must equal the checked-out commit');
    expect(generator).toContain('does not match package.json version');
    expect(worker).toContain('DEPLOYED_VERSION: release.version');
    expect(worker).toContain('DEPLOYED_SHA: release.commit');
    expect(wrangler).toContain('"main": "src/worker-entry.mjs"');
  });

  it('uses the baseline Worker identity and shared resources without a second provider verifier', () => {
    expect(wrangler).toContain('"name": "demo"');
    expect(wrangler).toContain('"WG_APP": "demo"');
    expect(wrangler).toContain('"pattern": "demo.wizardgang.ai"');
    expect(wrangler).toContain('"database_name": "wizardgang"');
    expect(wrangler).toContain('"bucket_name": "wizardgang"');
    expect(fs.existsSync('scripts/verify-cloudflare-deployment.ts')).toBe(false);
  });
});
