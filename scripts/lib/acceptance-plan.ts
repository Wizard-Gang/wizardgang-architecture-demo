export function commandSequence(script) {
  if (typeof script !== 'string') throw new TypeError('Expected a package script string.');
  return script.split('&&').map((command) => command.trim()).filter(Boolean);
}

export function npmRunSequence(script) {
  return commandSequence(script).flatMap((command) => {
    const match = /^npm run ([A-Za-z0-9:_-]+)(?:\s|$)/.exec(command);
    return match ? [match[1]] : [];
  });
}

// Expand transitive npm-run ownership without executing checkout validators.
export function expandedNpmRunSequence(scripts, name, ancestors = []) {
  if (ancestors.includes(name)) throw new Error(`Cyclic npm script ownership: ${[...ancestors, name].join(' -> ')}`);
  const script = name === 'check' && scripts?.check === 'node scripts/check.ts'
    ? acceptanceStages.map(({ script }) => `npm run ${script}`).join(' && ')
    : scripts?.[name];
  if (typeof script !== 'string' || !script.trim()) throw new Error(`Missing npm script owner: ${name}`);
  const path = [...ancestors, name];
  return [name, ...npmRunSequence(script).flatMap((child) => expandedNpmRunSequence(scripts, child, path))];
}

export function npmRunName(command) {
  return command?.args?.[0] === 'run' && typeof command.args?.[1] === 'string'
    ? command.args[1]
    : null;
}

// One ordered credential-free plan for local, tagged and grouped CI acceptance.
export const acceptanceStages = Object.freeze([
  { script: 'validate:typescript-source-boundary', group: 'source' },
  { script: 'check:platform', group: 'source' },
  { script: 'test:plan-queue', group: 'source' },
  { script: 'validate:generated-artifacts', group: 'source' },
  { script: 'validate:migrations', group: 'browser' },
  { script: 'build:worker', group: 'source' },
  { script: 'validate:history', group: 'source' },
  { script: 'validate:implementation-plan', group: 'source' },
  { script: 'validate:worker-secrets', group: 'source' },
  { script: 'validate:repository-settings', group: 'source' },
  { script: 'test:github-settings', group: 'source' },
  { script: 'validate:repository-baseline', group: 'source' },
  { script: 'validate:react-presentation', group: 'source' },
  { script: 'validate:stylesheet-classes', group: 'source' },
  { script: 'lint', group: 'source' },
  { script: 'typecheck', group: 'source' },
  { script: 'test:site-accessibility', group: 'browser' },
  { script: 'test', group: 'source' },
  { script: 'validate:contracts', group: 'source' },
  { script: 'validate:locales', group: 'source' },
  { script: 'validate:security', group: 'source' },
]);

export function acceptanceCommands({ group = 'all', npmExecutable = 'npm', checkEnvironment } = {}) {
  if (!['all', 'source', 'browser'].includes(group)) throw new Error(`Unknown acceptance group: ${group}`);
  return acceptanceStages.filter((stage) => group === 'all' || stage.group === group)
    .map(({ script, group: owner }) => ({ id: script, group: owner, label: script, file: npmExecutable, args: ['run', script], env: checkEnvironment }));
}

export const acceptedBuildOutputPaths = Object.freeze({
  clientAssets: 'dist/client',
  workerEntry: 'src/worker-entry.mjs',
});

export function createCiValidationCommands({ nodeExecutable, npmExecutable, checkEnvironment, group = 'all', pullRequest = false }) {
  if (!nodeExecutable || !npmExecutable) throw new TypeError('CI command planning requires Node and npm executables.');
  const commands = [
    { id: 'toolchain', label: 'Validate pinned Node/npm toolchain', file: nodeExecutable, args: ['scripts/validate-toolchain.ts'] },
    { id: 'install', label: 'Install locked dependencies', file: npmExecutable, args: ['ci'], env: { npm_config_audit: 'false' } },
  ];
  if (group === 'source' && pullRequest) commands.push({ id: 'identity', label: 'Validate early PR identity', file: npmExecutable, args: ['run', 'validate:pull-request-identity'] });
  if (group === 'browser') commands.push({ id: 'prepared-inputs', label: 'Verify same-run/head prepared browser inputs', file: nodeExecutable, args: ['scripts/prepared-browser-inputs.ts', 'verify'] });
  commands.push(...acceptanceCommands({ group, npmExecutable, checkEnvironment }));
  if (group !== 'browser') {
    if (group === 'source') commands.push({ id: 'advisory', label: 'Query dependency advisories (network)', file: npmExecutable, args: ['run', 'security:dependency-advisories'] });
    commands.push({ id: 'patch-whitespace', label: 'Validate committed patch whitespace', file: npmExecutable, args: ['run', 'validate:patch-whitespace'] });
    if (group === 'source') commands.push({ id: 'prepare-browser', label: 'Prepare bounded browser inputs', file: nodeExecutable, args: ['scripts/prepared-browser-inputs.ts', 'prepare'] });
  }
  return commands;
}
