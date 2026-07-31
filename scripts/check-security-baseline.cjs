#!/usr/bin/env node
// Grep gate: assert src/main/window.ts contains the locked security baseline literals.
// Exits 0 on pass, 2 on any missing literal or missing file.

const fs = require('node:fs');
const path = require('node:path');

const target = path.join(__dirname, '..', 'src', 'main', 'window.ts');
if (!fs.existsSync(target)) {
  console.error(`SECURITY BASELINE DRIFT: missing file ${target}`);
  process.exit(2);
}

const src = fs.readFileSync(target, 'utf8');
const required = [
  'contextIsolation: true',
  'nodeIntegration: false',
  'sandbox: true',
  'webSecurity: true',
];

const missing = required.filter((s) => !src.includes(s));
if (missing.length > 0) {
  for (const m of missing) console.error(`SECURITY BASELINE DRIFT: missing ${m}`);
  process.exit(2);
}

console.log('security baseline OK');
