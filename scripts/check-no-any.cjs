#!/usr/bin/env node
// Grep gate: no `any` type annotations in shared IPC types, preload typings, or renderer env.
// Exits 0 on pass, 2 on any match.

const fs = require('node:fs');
const path = require('node:path');

const ROOTS = [
  path.join(__dirname, '..', 'src', 'shared'),
  path.join(__dirname, '..', 'src', 'preload', 'api.d.ts'),
  path.join(__dirname, '..', 'src', 'renderer', 'src', 'env.d.ts'),
];

const re = /(?:\bas\s+any\b)|(?::\s*any\b)/g;

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    if (dir.endsWith('.ts') || dir.endsWith('.tsx')) out.push(dir);
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(path.join(dir, entry.name), out);
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(path.join(dir, entry.name));
  }
}

const files = [];
for (const r of ROOTS) walk(r, files);

let failed = false;
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      console.error(`no-any DRIFT: ${f}:${i + 1}: ${lines[i].trim()}`);
      failed = true;
    }
    re.lastIndex = 0;
  }
}

if (failed) process.exit(2);
console.log('no-any OK');
