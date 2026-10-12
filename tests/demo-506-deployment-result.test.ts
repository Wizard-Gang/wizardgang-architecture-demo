import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { callerReproduction } from '../platform/deploy/evidence.mjs';

const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
const vendor = JSON.parse(readFileSync('platform/vendor.lock.json', 'utf8'));
const job = (name: string) => {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z][a-z-]*:\n/);
  return workflow.slice(start + 1, next < 0 ? undefined : start + 1 + next);
};

// The record step's own shell, exactly as release.yml runs it.
function recordScript() {
  const lines = job('record').split('\n');
  const run = lines.findIndex((line) => /^\s+run: \|$/.test(line));
  const indent = lines[run + 1].match(/^ */)?.[0] ?? '';
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line && !line.startsWith(indent)) break;
    body.push(line.slice(indent.length));
  }
  return body.join('\n');
}

const commit = 'c'.repeat(40);
const github = {
  GITHUB_REPOSITORY: 'Wizard-Gang/wizardgang-architecture-demo', GITHUB_REF_NAME: 'v0.33.0', GITHUB_SHA: commit,
  GITHUB_RUN_ID: '4242', GITHUB_RUN_ATTEMPT: '1', GITHUB_SERVER_URL: 'https://github.com',
};
const result = {
  schema: 1, worker: 'demo', host: 'demo.wizardgang.ai', repository: github.GITHUB_REPOSITORY, run_id: 4242, run_attempt: 1,
  tag: 'v0.33.0', commit, observed_at: '2026-10-09T22:00:00.000Z', worker_version_id: '0123abcd-0123-4abc-8def-0123456789ab',
  traffic_percentage: 100, assets_checked: 4,
  checks: { reproduction: 'passed', traffic: 'passed', version: 'passed', health: 'passed', assets: 'passed' },
};
const line = (value: object) => JSON.stringify(value);

// A stand-in gh holding one Release's assets in a directory.
const fakeGh = `#!/bin/bash
set -euo pipefail
state="$FAKE_GH_STATE"
echo "$*" >> "$state/calls"
case "$1 $2" in
  "release view")
    [[ -e "$state/view-fails" ]] && exit 1
    draft=false; [[ -e "$state/draft" ]] && draft=true
    names="$(ls "$state/assets")"
    jq -n --argjson draft "$draft" --arg names "$names" '{isDraft: $draft, assets: ($names | split("\\n") | map(select(length > 0) | {name: .}))}' ;;
  "release download")
    cp "$state/assets/$5" "$7" ;;
  "release upload")
    [[ -e "$state/upload-fails" ]] && exit 1
    target="$state/assets/$(basename "$4")"
    [[ -e "$target" ]] && exit 1
    cp "$4" "$target" ;;
  *) exit 64 ;;
esac
`;

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function record(deployResult: string, { env = {}, assets = {}, flags = [] as string[] } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'deployment-record-'));
  roots.push(root);
  const bin = path.join(root, 'bin');
  const state = path.join(root, 'state');
  mkdirSync(bin);
  mkdirSync(path.join(state, 'assets'), { recursive: true });
  writeFileSync(path.join(bin, 'gh'), fakeGh);
  chmodSync(path.join(bin, 'gh'), 0o755);
  for (const [name, content] of Object.entries(assets)) writeFileSync(path.join(state, 'assets', name), content as string);
  for (const flag of flags) writeFileSync(path.join(state, flag), '');
  const summary = path.join(root, 'summary.md');
  const run = spawnSync('bash', ['-c', recordScript()], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`, TMPDIR: root, FAKE_GH_STATE: state, GITHUB_STEP_SUMMARY: summary,
      GH_TOKEN: 'unused', GH_REPO: github.GITHUB_REPOSITORY, ...github, DEPLOY_RESULT: deployResult, ...env,
    },
  });
  const asset = (name: string) => (existsSync(path.join(state, 'assets', name)) ? readFileSync(path.join(state, 'assets', name), 'utf8') : null);
  const calls = existsSync(path.join(state, 'calls')) ? readFileSync(path.join(state, 'calls'), 'utf8') : '';
  return { ...run, asset, calls, summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '' };
}

describe('DEMO-506 automatic verified deployment record', () => {
  it('owns the one deploy path: deploy-worker.yml at the vendored lock commit, passing its caller reproduction rule', () => {
    expect(vendor.source).toBe('Wizard-Gang/baseline');
    expect(vendor.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(workflow.match(/deploy-worker\.yml@/g)).toHaveLength(1);
    expect(existsSync('.github/workflows/deploy.yml')).toBe(false);
    expect(job('deploy')).toContain(`uses: Wizard-Gang/baseline/.github/workflows/deploy-worker.yml@${vendor.commit}`);
    expect(job('deploy')).toContain('needs: reproduce');
    expect(job('deploy')).toContain('permissions:\n      actions: read\n      contents: read\n');
    expect(callerReproduction(workflow, vendor.commit)).toEqual({ job: 'reproduce', failures: [] });
  });

  it('records from one lightweight job with bounded Release permission and no rebuild, credential or approval', () => {
    const recordJob = job('record');
    expect(recordJob).toContain('needs: deploy');
    expect(recordJob).toContain('permissions:\n      contents: write\n    steps:');
    expect(recordJob).toContain('DEPLOY_RESULT: ${{ needs.deploy.outputs.result }}');
    expect(recordJob).not.toMatch(/uses:|environment:|secrets|npm |node |wrangler|continue-on-error|\bif:/);
    expect(recordScript()).not.toContain('${{');
    expect(recordScript()).not.toContain('--clobber');
  });

  it('attaches the exact verified result to the published Release and renders the same result', () => {
    const run = record(line(result));
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.asset('deployment-4242-1.json')).toBe(`${line(result)}\n`);
    expect(run.summary).toContain('- Commit: `' + commit + '`');
    expect(run.summary).toContain('- Checks: reproduction passed, traffic passed, version passed, health passed, assets passed');
    expect(run.summary).toContain('/actions/runs/4242/attempts/1');
    expect(run.summary).toContain('- Record: `deployment-4242-1.json` on the v0.33.0 Release');
  });

  it('refuses missing, malformed, private, unperformed and forged or stale results without recording', () => {
    const { checks, ...withoutChecks } = result;
    const refused: [string, string][] = [
      ['missing', ''],
      ['not JSON', 'deployed'],
      ['multi-line', JSON.stringify(result, null, 2)],
      ['missing field', line(withoutChecks)],
      ['private field', line({ ...result, account_id: 'f'.repeat(32) })],
      ['duplicate field', line(result).replace('"schema":1', '"schema":1,"schema":1')],
      ['skipped check', line({ ...result, checks: { ...checks, health: 'skipped' } })],
      ['missing check', line({ ...result, checks: { reproduction: 'passed', traffic: 'passed', version: 'passed', health: 'passed' } })],
      ['partial traffic', line({ ...result, traffic_percentage: 50 })],
      ['too many assets', line({ ...result, assets_checked: 21 })],
      ['other Worker', line({ ...result, worker: 'hexframe', host: 'hexframe.wizardgang.ai' })],
      ['other repository', line({ ...result, repository: 'Wizard-Gang/hexframe' })],
      ['other run', line({ ...result, run_id: 4241 })],
      ['future attempt', line({ ...result, run_attempt: 2 })],
      ['other tag', line({ ...result, tag: 'v0.32.0' })],
      ['other commit', line({ ...result, commit: 'd'.repeat(40) })],
      ['malformed version ID', line({ ...result, worker_version_id: 'latest' })],
      ['malformed time', line({ ...result, observed_at: '2026-10-09' })],
    ];
    for (const [label, deployResult] of refused) {
      const run = record(deployResult);
      expect(run.status, label).toBe(1);
      expect(run.stdout, label).toMatch(/::error::Deploy result is (?:missing|malformed)/);
      expect(run.calls, label).toBe('');
    }
  });

  it('keeps the run red as verified but unrecorded when publication fails', () => {
    for (const flag of ['upload-fails', 'view-fails', 'draft']) {
      const run = record(line(result), { flags: [flag] });
      expect(run.status, flag).toBe(1);
      expect(run.stdout, flag).toContain('::error::Deployment verified, record incomplete:');
      expect(run.summary, flag).toContain('## Verified deployment');
      expect(run.summary, flag).toContain('- Record: incomplete');
      expect(run.asset('deployment-4242-1.json'), flag).toBeNull();
    }
  });

  it('retries record-only from the retained producing attempt, matching or refusing existing content', () => {
    const retry = { GITHUB_RUN_ATTEMPT: '2' };
    const published = record(line(result), { env: retry });
    expect(published.status, published.stderr).toBe(0);
    expect(published.asset('deployment-4242-1.json')).toBe(`${line(result)}\n`);

    const matching = record(line(result), { env: retry, assets: { 'deployment-4242-1.json': `${line(result)}\n` } });
    expect(matching.status, matching.stderr).toBe(0);
    expect(matching.calls).not.toContain('release upload');

    const conflicting = `${line({ ...result, assets_checked: 5 })}\n`;
    const conflict = record(line(result), { env: retry, assets: { 'deployment-4242-1.json': conflicting } });
    expect(conflict.status).toBe(1);
    expect(conflict.stdout).toContain('already holds a different deployment-4242-1.json; it is never replaced');
    expect(conflict.asset('deployment-4242-1.json')).toBe(conflicting);
    expect(conflict.calls).not.toContain('release upload');

    const redeployed = record(line({ ...result, run_attempt: 2 }), { env: retry, assets: { 'deployment-4242-1.json': `${line(result)}\n` } });
    expect(redeployed.status, redeployed.stderr).toBe(0);
    expect(redeployed.asset('deployment-4242-1.json')).toBe(`${line(result)}\n`);
    expect(redeployed.asset('deployment-4242-2.json')).toBe(`${line({ ...result, run_attempt: 2 })}\n`);
  });
});
