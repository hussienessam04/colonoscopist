// Wrapper that runs vitest under Electron-as-Node so native modules
// (better-sqlite3) loaded by the test code use the same ABI as the
// Electron build of the app. Required because the prebuilt binaries are
// linked against Electron's NODE_MODULE_VERSION, not raw Node.

const { spawn } = require('node:child_process');
const path = require('node:path');

const electronBin = require(path.join(__dirname, '..', 'node_modules', 'electron'));
const cwd = path.join(__dirname, '..');

const args = [
  path.join(__dirname, '..', 'node_modules', 'vitest', 'vitest.mjs'),
  'run',
  '--reporter=basic',
  ...process.argv.slice(2),
];

const child = spawn(electronBin, args, {
  cwd,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code) => process.exit(code ?? 1));