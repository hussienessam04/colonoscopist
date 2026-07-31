#!/usr/bin/env node
// Grep gate: SET-04 stub fidelity. No users:* IPC channel, no users.ts.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const contractPath = path.join(ROOT, 'src', 'shared', 'ipc-contract.ts');
const usersIpcPath = path.join(ROOT, 'src', 'main', 'ipc', 'users.ts');

if (!fs.existsSync(contractPath)) {
  console.error(`SET-04 stub regression: missing file ${contractPath}`);
  process.exit(2);
}

const contract = fs.readFileSync(contractPath, 'utf8');
if (contract.includes('users:')) {
  console.error('SET-04 stub regression: users channel leaked in shared/ipc-contract.ts');
  process.exit(2);
}

if (fs.existsSync(usersIpcPath)) {
  console.error(`SET-04 stub regression: ${usersIpcPath} exists`);
  process.exit(2);
}

console.log('SET-04 stub fidelity OK');
