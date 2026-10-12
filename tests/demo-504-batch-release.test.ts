import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allocatePlanIdentities } from '../scripts/lib/controlled-identity-allocation.ts';
import { validateControlledPullRequestIdentity } from '../scripts/lib/controlled-pr-identity.ts';
import { renderControlledRecord } from '../scripts/lib/controlled-record.ts';
import { planExactTagRelease } from '../scripts/lib/exact-tag-release.ts';
import {
  batchReleaseReadiness, latestReleaseIntent, renderReadinessSummary, validateReleaseIntentChange,
} from '../scripts/lib/release-intent.ts';

const commit = 'a'.repeat(40);
const other = 'b'.repeat(40);
const emptyPlan = '# Implementation plan\n';
const task = (id: string) => `### ${id} — [BUILD] Queued work\n\n- Dependency: none.\n`;
const queuedPlan = `# Implementation plan\n\n## Open tasks\n\n${task('DEMO-520')}`;
const run = { name: 'CI', event: 'push', head_branch: 'main', head_sha: commit, status: 'completed', conclusion: 'success' };
const jobs = ['validate', 'browser'].map((name) => ({ name, head_sha: commit, status: 'completed', conclusion: 'success' }));
const facts = { run, jobs, mainSha: commit, version: '0.33.0', planMarkdown: emptyPlan, intent: '0.33.0', tag: null, release: null, releaseRuns: [] };
const tag = (sha: string) => ({ ref: 'refs/tags/v0.33.0', object: { type: 'tag', sha: other }, tagName: 'v0.33.0', commitSha: sha });

const pkg = (version: string, extra = {}) => JSON.stringify({ name: 'demo', version, ...extra });
const lock = (version: string) => JSON.stringify({ name: 'demo', version, packages: { '': { name: 'demo', version }, dep: { version: '1.0.0' } } });
const intentRecord = renderControlledRecord({
  id: 'DEMO-519', type: 'BUILD', summary: 'Plan the next batch', change: 'Queue work and authorize v0.33.0.', reason: 'Owner batch planning.',
  impact: 'Queue and version metadata.', risk: 'Medium', controls: '- Cutter waits for the empty queue.', validation: '- Pure fixtures.',
  evidence: '- implementation_plan.md', source: 'direct', release: 'v0.33.0 — authorized by Jacob', maintenance: true, releaseIntent: '0.33.0',
});
const versionChange = (overrides = {}) => ({
  body: intentRecord.body, beforePackage: pkg('0.32.0'), afterPackage: pkg('0.33.0'), beforeLock: lock('0.32.0'), afterLock: lock('0.33.0'), ...overrides,
});

describe('DEMO-504 authorized batch release intent', () => {
  it('selects the target version explicitly during batch planning, never from an empty queue alone', () => {
    const reservations = { subjects: ['[DEMO-518] [BUILD] Accepted'], planMarkdown: emptyPlan, openPullRequests: [] };
    const tasks = [{ type: 'BUILD', title: 'First' }];
    expect(allocatePlanIdentities(reservations, tasks, { version: '0.33.0', authorizedBy: 'Jacob', currentVersion: '0.32.0' }))
      .toEqual({ maintenanceId: 'DEMO-519', releaseIntent: '0.33.0', authorizedBy: 'Jacob', tasks: [{ ...tasks[0], id: 'DEMO-520' }] });
    expect(allocatePlanIdentities(reservations, tasks)).not.toHaveProperty('releaseIntent');
    expect(() => allocatePlanIdentities(reservations, [])).toThrow('authorized release intent');
    expect(() => allocatePlanIdentities(reservations, tasks, { version: '0.33.0', authorizedBy: ' ', currentVersion: '0.32.0' })).toThrow('authorizedBy');
    expect(() => allocatePlanIdentities(reservations, tasks, { version: '0.32.0', authorizedBy: 'Jacob', currentVersion: '0.32.0' })).toThrow('must advance');
  });

  it('changes package/lock versions only in the matching plan-maintenance intent record', () => {
    expect(validateReleaseIntentChange(versionChange())).toEqual([]);
    expect(validateReleaseIntentChange(versionChange({ body: intentRecord.body.replace('Release-Intent: v0.33.0', '') }))).toContain('Package version may change only through an authorized batch Release-Intent.');
    expect(validateReleaseIntentChange(versionChange({ afterPackage: pkg('0.34.0'), afterLock: lock('0.34.0') }))).toContain('Package and lockfile versions must equal Release-Intent v0.33.0.');
    expect(validateReleaseIntentChange(versionChange({ afterPackage: pkg('0.33.0', { scripts: { check: 'exit 0' } }) }))).toContain('package.json may change only version metadata in a release-intent change.');
    expect(validateReleaseIntentChange(versionChange({ afterLock: lock('0.32.0') }))).toContain('Package and lockfile versions must equal Release-Intent v0.33.0.');
    expect(validateReleaseIntentChange(versionChange({ beforePackage: pkg('0.33.0'), afterPackage: pkg('0.33.0'), beforeLock: lock('0.33.0'), afterLock: lock('0.33.0') }))).toContain('Release-Intent v0.33.0 must set the package and lockfile version.');
    expect(validateReleaseIntentChange(versionChange({ body: intentRecord.body.replace('Portfolio-Plan-Maintenance: true', '') }))).toContain('Release-Intent belongs to a plan-maintenance record.');
    expect(validateReleaseIntentChange(versionChange({ body: `${intentRecord.body}\nRelease-Intent: v0.34.0` }))).toContain('A controlled record may carry only one Release-Intent.');
  });

  it('feeds release-intent errors into PR identity validation without a separate live route', () => {
    const errors = validateControlledPullRequestIdentity({
      branchName: 'demo-519-plan-next-batch', title: intentRecord.subject, headSubject: intentRecord.subject, headBody: intentRecord.body,
      rangeSubjects: [intentRecord.subject], basePlanMarkdown: emptyPlan, headPlanMarkdown: queuedPlan,
      baseAcceptedIds: new Set(['DEMO-518']), releaseIntentErrors: validateReleaseIntentChange(versionChange()),
    });
    expect(errors).toEqual([]);
  });

  it('finds the newest authorized intent among package.json-changing records', () => {
    expect(latestReleaseIntent([{ sha: commit, message: '[DEMO-521] [BUILD] Dependency update' }, { sha: other, message: intentRecord.commit }])).toEqual({ sha: other, version: '0.33.0' });
    expect(latestReleaseIntent([{ sha: commit, message: '[DEMO-521] [BUILD] Dependency update' }])).toBeNull();
  });
});

describe('DEMO-504 cutter readiness', () => {
  it('cuts only the authorized batch on an empty queue at exact current main', () => {
    expect(planExactTagRelease(facts)).toMatchObject({ action: 'create-and-dispatch', tag: 'v0.33.0', commit });
  });

  it('lets normal unpublished intent wait for the queue instead of releasing early', () => {
    const queued = planExactTagRelease({ ...facts, planMarkdown: queuedPlan });
    expect(queued).toMatchObject({ action: 'skip', reason: 'authorized v0.33.0 waits for the queue to empty (DEMO-520)' });
    expect(planExactTagRelease({ ...facts, planMarkdown: null })).toMatchObject({ action: 'skip', reason: 'implementation_plan.md is missing' });
  });

  it('skips absent or wrong-version intent and stale or incomplete CI', () => {
    expect(planExactTagRelease({ ...facts, intent: null })).toMatchObject({ action: 'skip', reason: 'no authorized Release-Intent for v0.33.0' });
    expect(planExactTagRelease({ ...facts, intent: '0.32.1' })).toMatchObject({ action: 'skip', reason: 'no authorized Release-Intent for v0.33.0' });
    expect(planExactTagRelease({ ...facts, mainSha: other })).toMatchObject({ action: 'skip', reason: 'CI is stale against current main' });
    expect(planExactTagRelease({ ...facts, jobs: jobs.slice(1) })).toMatchObject({ action: 'skip', reason: 'required main CI jobs are incomplete' });
  });

  it('never moves a conflicting immutable tag and leaves an already-published version alone', () => {
    expect(() => planExactTagRelease({ ...facts, tag: tag(other) })).toThrow('never be moved');
    const published = { tag_name: 'v0.33.0', draft: false, published_at: '2026-10-09T00:00:00Z' };
    expect(planExactTagRelease({ ...facts, planMarkdown: queuedPlan, intent: null, tag: tag(other), release: published })).toMatchObject({ action: 'skip', reason: 'v0.33.0 is already published' });
    expect(() => planExactTagRelease({ ...facts, release: published })).toThrow('no matching annotated semantic tag');
  });

  it('retries a missed dispatch for the exact tag but refuses a duplicate active dispatch', () => {
    expect(planExactTagRelease({ ...facts, tag: tag(commit) })).toMatchObject({ action: 'dispatch' });
    const active = [{ event: 'workflow_dispatch', head_sha: commit, head_branch: 'v0.33.0', status: 'in_progress', conclusion: null }];
    expect(planExactTagRelease({ ...facts, tag: tag(commit), releaseRuns: active })).toMatchObject({ action: 'skip', reason: 'v0.33.0 release is already dispatched' });
  });

  it('renders one shared readiness summary for the cutter and live controller', () => {
    const summary = renderReadinessSummary(batchReleaseReadiness({ version: '0.33.0', planMarkdown: queuedPlan, intent: '0.33.0' }), ['CI run: 7']);
    expect(summary).toContain('- Open queue: DEMO-520');
    expect(summary).toContain('- Decision: not ready — authorized v0.33.0 waits for the queue to empty (DEMO-520)');
    expect(() => batchReleaseReadiness({ version: '0.33', planMarkdown: emptyPlan, intent: null })).toThrow('not semantic');
  });
});

describe('DEMO-504 current workflow configuration', () => {
  const read = (path: string) => readFileSync(path, 'utf8');

  it('keeps the cutter a separate serialized workflow after completed successful main CI', () => {
    const cutter = read('.github/workflows/release-cutter.yml');
    expect(cutter).toMatch(/on:\n {2}workflow_run:\n {4}workflows: \[CI\]\n {4}types: \[completed\]\n {4}branches: \[main\]/);
    expect(cutter).toContain('group: exact-tag-release-cutter\n  cancel-in-progress: false');
    expect(cutter).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(read('.github/workflows/ci.yml')).not.toContain('cut-main-release');
    const script = read('scripts/cut-main-release.ts');
    expect(script).toContain('implementation_plan.md');
    expect(script).toContain('latestReleaseIntent');
    expect(script).toContain('moved before release-tag creation or dispatch');
  });

  it('enforces the same readiness at the Release dispatch boundary', () => {
    expect(read('scripts/release-workflow.ts')).toContain('latestReleaseIntent');
    expect(read('.github/workflows/release.yml')).toContain('fetch-depth: 0');
  });

  it('retires the routine version-only PR route and its legacy identity', () => {
    for (const path of ['scripts/lib/live-release-identity.ts', 'scripts/lib/live-controlled-record.ts', 'tests/demo-391-live-release.test.ts']) expect(existsSync(path)).toBe(false);
    for (const file of ['src/lib/git-demo.ts', 'scripts/lib/git-demo-workflow.ts', 'scripts/lib/controlled-record.ts']) {
      expect(read(file)).not.toMatch(/Live-Release|Demonstrate v|-live-v|version-only/);
    }
    const live = read('.github/workflows/git-demo.yml');
    expect(live).toContain('release-v[0-9]+');
    expect(live).not.toContain('live-v');
  });
});
