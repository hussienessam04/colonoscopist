#!/usr/bin/env node
// Aggregate verifier for Phase 1: tsc-node + tsc-web + 5 grep gates + vitest.

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const STEPS = [
  { name: 'tsc-node', cmd: 'npx', args: ['tsc', '--noEmit', '-p', 'tsconfig.node.json'] },
  { name: 'tsc-web', cmd: 'npx', args: ['tsc', '--noEmit', '-p', 'tsconfig.web.json'] },
  { name: 'gate:security', cmd: 'node', args: [path.join('scripts', 'check-security-baseline.cjs')] },
  { name: 'gate:no-any', cmd: 'node', args: [path.join('scripts', 'check-no-any.cjs')] },
  { name: 'gate:ipc-contract', cmd: 'node', args: [path.join('scripts', 'check-ipc-contract.cjs')] },
  { name: 'gate:set04-stub', cmd: 'node', args: [path.join('scripts', 'check-set04-stub.cjs')] },
  { name: 'gate:no-persistence', cmd: 'node', args: [path.join('scripts', 'check-no-persistence.cjs')] },
  { name: 'vitest', cmd: 'npx', args: ['vitest', 'run'] },
];

for (const step of STEPS) {
  // On Windows, npx and node resolve to .cmd shims. Use the shell only for
  // npx invocations (which need .cmd resolution); direct `node` calls go
  // through spawnSync without a shell to avoid cmd.exe splitting paths
  // containing spaces into separate argv entries.
  const useShell = process.platform === 'win32' && step.cmd === 'npx';
  const res = spawnSync(step.cmd, step.args, { stdio: 'inherit', shell: useShell });
  if (res.status !== 0) {
    console.error(`PHASE 1 VERIFY FAILED at step ${step.name}`);
    process.exit(res.status ?? 1);
  }
}

console.log('PHASE 1 VERIFY PASSED');
