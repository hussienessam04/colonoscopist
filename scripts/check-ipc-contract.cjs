#!/usr/bin/env node
// Grep gate: assert the IPC contract is single-channel, single-source, and
// imported by both main and preload.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const contractPath = path.join(ROOT, 'src', 'shared', 'ipc-contract.ts');
const mainAuthPath = path.join(ROOT, 'src', 'main', 'ipc', 'auth.ts');
const preloadPath = path.join(ROOT, 'src', 'preload', 'index.ts');

function readOrFail(p) {
  if (!fs.existsSync(p)) {
    console.error(`IPC CONTRACT DRIFT: missing file ${p}`);
    process.exit(2);
  }
  return fs.readFileSync(p, 'utf8');
}

const contract = readOrFail(contractPath);

// 1. AUTH_STATUS literal present, exactly once ideally
if (!contract.includes("AUTH_STATUS: 'auth:status'")) {
  console.error("IPC CONTRACT DRIFT: IPC.AUTH_STATUS = 'auth:status' missing in shared/ipc-contract.ts");
  process.exit(2);
}

// 2. IpcContract interface exported
if (!/export\s+(interface|type)\s+IpcContract\b/.test(contract)) {
  console.error('IPC CONTRACT DRIFT: IpcContract interface/type not exported from shared/ipc-contract.ts');
  process.exit(2);
}

// 3. main + preload both import from shared/ipc-contract
const mainAuth = readOrFail(mainAuthPath);
if (!mainAuth.includes("from '@shared/ipc-contract'") && !mainAuth.includes("from '../shared/ipc-contract'")) {
  console.error(`IPC CONTRACT DRIFT: ${mainAuthPath} does not import from @shared/ipc-contract`);
  process.exit(2);
}
if (!mainAuth.includes('IPC.AUTH_STATUS')) {
  console.error(`IPC CONTRACT DRIFT: ${mainAuthPath} does not reference IPC.AUTH_STATUS`);
  process.exit(2);
}

const preload = readOrFail(preloadPath);
if (!preload.includes("from '@shared/ipc-contract'") && !preload.includes("from '../shared/ipc-contract'")) {
  console.error(`IPC CONTRACT DRIFT: ${preloadPath} does not import from @shared/ipc-contract`);
  process.exit(2);
}
if (!preload.includes('IPC.AUTH_STATUS')) {
  console.error(`IPC CONTRACT DRIFT: ${preloadPath} does not reference IPC.AUTH_STATUS`);
  process.exit(2);
}

console.log('ipc contract OK');
