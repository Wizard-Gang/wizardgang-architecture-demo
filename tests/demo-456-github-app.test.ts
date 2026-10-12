import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseJsonc } from '../platform/conformance/jsonc.mjs';

const RETIRED = ['GITHUB_DEMO_TOKEN', 'GITHUB_READ_TOKEN', 'GITHUB_REPORTING_WRITE_TOKEN', 'GIT_DEMO_PR_TOKEN'];
// Everything that configures, runs or documents the demo; tests and the plan may name retired credentials.
const SURFACES = ['.github', '.dev.vars.example', 'SECURITY.md', 'README.md', 'config', 'docs', 'scripts', 'src', 'wrangler.jsonc'];

function workflowJob(workflow: string, job: string): string {
  const start = workflow.indexOf(`\n  ${job}:\n`);
  expect(start, job).toBeGreaterThan(-1);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z][a-z-]*:\n/);
  return next === -1 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
}

describe('DEMO-456 GitHub App adoption', () => {
  it('leaves no personal GitHub token name in tracked configuration, source or documentation', () => {
    const files = execFileSync('git', ['ls-files', '-z', '--', ...SURFACES], { encoding: 'utf8' }).split('\0').filter(Boolean);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const name of RETIRED) expect(text.includes(name), `${file} names ${name}`).toBe(false);
    }
  });

  it('declares the App key as the Worker secret and its public identity as committed vars', () => {
    const inventory = JSON.parse(fs.readFileSync('config/worker-secrets.json', 'utf8')) as { secrets: Array<{ name: string; required: boolean }> };
    expect(inventory.secrets.find((entry) => entry.name === 'GITHUB_APP_PRIVATE_KEY')).toMatchObject({ required: true });
    const { vars } = parseJsonc(fs.readFileSync('wrangler.jsonc', 'utf8')) as { vars: Record<string, string> };
    expect(vars.GITHUB_APP_ID).toMatch(/^[1-9]\d*$/);
    expect(vars.GITHUB_APP_INSTALLATION_ID).toMatch(/^[1-9]\d*$/);
    expect(vars).not.toHaveProperty('GITHUB_APP_PRIVATE_KEY');
  });

  it('mints a job-scoped App token in the git-demo environment with only the permissions each job needs', () => {
    const workflow = fs.readFileSync('.github/workflows/git-demo.yml', 'utf8');
    expect(workflow).toMatch(/\npermissions:\n {2}contents: read\n\n/);
    const expected: Record<string, string[]> = {
      start: ['contents: write', 'pull-requests: write'],
      release: ['contents: write', 'pull-requests: write', 'actions: read', 'checks: read', 'statuses: read'],
    };
    for (const [job, permissions] of Object.entries(expected)) {
      const body = workflowJob(workflow, job);
      expect(body).toContain('    environment: git-demo\n');
      expect(body).toContain('uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0');
      expect(body).toContain('app-id: ${{ vars.APP_ID }}');
      expect(body).toContain('private-key: ${{ secrets.APP_PRIVATE_KEY }}');
      expect([...body.matchAll(/^ {10}permission-([a-z-]+: (?:read|write))$/gm)].map((match) => match[1])).toEqual(permissions);
      expect(body.indexOf('id: app')).toBeLessThan(body.indexOf('name: Check out main'));
      const tokens = [...body.matchAll(/(?:GH_TOKEN|token): \$\{\{ ([^}]+) \}\}/g)].map((match) => match[1].trim());
      expect(tokens.length).toBeGreaterThan(0);
      expect(new Set(tokens)).toEqual(new Set(['steps.app.outputs.token']));
    }
    expect(workflow).not.toMatch(/secrets\.GITHUB_/);
  });
});
