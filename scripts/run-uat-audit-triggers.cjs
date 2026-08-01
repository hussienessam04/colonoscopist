// Wrapper that runs uat-audit-triggers.cjs under Electron-as-Node so
// better-sqlite3 (linked against Electron's NODE_MODULE_VERSION) loads.

const { spawn } = require('node:child_process');
const path = require('node:path');

const electronBin = require(path.join(__dirname, '..', 'node_modules', 'electron'));
const cwd = path.join(__dirname, '..');

const args = [path.join(__dirname, 'uat-audit-triggers.cjs'), ...process.argv.slice(2)];

const child = spawn(electronBin, args, {
  cwd,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code) => process.exit(code ?? 1));
