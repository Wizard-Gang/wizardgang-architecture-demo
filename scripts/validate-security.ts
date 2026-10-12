import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isForbiddenSecretPath, scanPublicHistory, secretKinds } from './lib/public-history-secrets.ts';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const failures: string[] = [];
const retiredBroadCredential = ['DEMO', 'API', 'TOKEN'].join('_');

for (const file of tracked) {
  if (isForbiddenSecretPath(file)) failures.push(`${file}: forbidden secret-file path`);
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  for (const kind of secretKinds(text, [file])) failures.push(`${file}: possible ${kind}`);
  if (text.includes(retiredBroadCredential)) failures.push(`${file}: retired broad operator credential name is not allowed`);
}

const history = scanPublicHistory(process.cwd());
failures.push(...history.findings);

if (failures.length) {
  console.error('Security validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Security validation passed: ${tracked.length} tracked files and ${history.blobs} unique blobs across ${history.revisions} reachable revisions checked for secret-like material.`);
