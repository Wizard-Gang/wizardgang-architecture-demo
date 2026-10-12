import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanPublicHistory, secretKinds } from '../scripts/lib/public-history-secrets.ts';

const roots = [];

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'demo-368-history-'));
  roots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Security Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  return root;
}

function commit(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  git(root, 'add', path);
  git(root, 'commit', '-qm', 'Fixture change');
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('reachable public-history secret scanning', () => {
  it('finds a secret-like blob even after its file was deleted', () => {
    const root = fixture();
    commit(root, 'README.md', 'fixture\n');
    const fake = ['sk', '-'].join('') + 'A'.repeat(28);
    commit(root, 'notes.txt', `temporary ${fake}\n`);
    unlinkSync(join(root, 'notes.txt'));
    git(root, 'add', '-u');
    git(root, 'commit', '-qm', 'Remove fixture');

    const result = scanPublicHistory(root);
    expect(result.revisions).toBe(3);
    expect(result.findings).toEqual(expect.arrayContaining([expect.stringContaining('possible OpenAI-style secret')]));
    expect(result.findings.join('\n')).not.toContain(fake);
  });

  it('finds a forbidden credential path from an earlier tree without printing its name', () => {
    const root = fixture();
    commit(root, 'README.md', 'fixture\n');
    commit(root, 'nested/.env.production', 'fixture\n');
    unlinkSync(join(root, 'nested/.env.production'));
    git(root, 'add', '-u');
    git(root, 'commit', '-qm', 'Remove fixture');

    const result = scanPublicHistory(root);
    expect(result.findings).toEqual(expect.arrayContaining([expect.stringContaining('forbidden secret-file path')]));
    expect(result.findings.join('\n')).not.toContain('.env.production');
  });

  it('detects credential assignments and credential-bearing URLs', () => {
    const root = fixture();
    const fake = 'faux-' + 'credential'.repeat(2);
    commit(root, 'config.txt', `access_token: "${fake}"\n`);
    commit(root, 'link.txt', 'https://' + 'example.invalid/path?' + `token=${fake}\n`);
    const findings = scanPublicHistory(root).findings.join('\n');
    expect(findings).toContain('possible assigned credential');
    expect(findings).toContain('possible credential-bearing URL');
    expect(findings).not.toContain(fake);
  });

  it('limits the known-safe exception to the exact fixture value and test path', () => {
    const source = readFileSync(new URL('./identity.test.ts', import.meta.url), 'utf8');
    const match = /\baccess_token\s*:\s*(["'])([^"'\n]{8,})\1/.exec(source);
    expect(match).not.toBeNull();
    const sample = 'access_token' + `: "${match[2]}"`;
    expect(secretKinds(sample, ['tests/identity.test.ts'])).not.toContain('assigned credential');
    expect(secretKinds(sample, ['src/worker/config.ts'])).toContain('assigned credential');
    expect(secretKinds('access_token' + ': "new-fixture-value"', ['tests/identity.test.ts'])).toContain('assigned credential');
  });

  it('fails closed for a blob beyond the bounded scan size', () => {
    const root = fixture();
    commit(root, 'oversized.txt', 'a'.repeat(2 * 1024 * 1024 + 1));
    expect(scanPublicHistory(root).findings).toEqual(expect.arrayContaining([
      expect.stringContaining('blob exceeds the bounded secret-scan size'),
    ]));
  });
});
