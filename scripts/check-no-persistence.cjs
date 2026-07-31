#!/usr/bin/env node
// Grep gate: no persistence references in src/**/*.{ts,tsx}.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'src');
const FORBIDDEN = [
  'localStorage',
  'sessionStorage',
  'electron-store',
  'document.cookie',
  'cookieStore',
  'chrome.cookies',
];

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
walk(ROOT, files);

for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const tok of FORBIDDEN) {
      if (lines[i].includes(tok)) {
        console.error(`no-persistence DRIFT: ${f}:${i + 1}: ${tok}`);
        process.exit(2);
      }
    }
  }
}

console.log('no-persistence OK');
