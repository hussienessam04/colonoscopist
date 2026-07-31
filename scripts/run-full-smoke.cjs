#!/usr/bin/env node
// Full smoke runner for Phase 1: aggregate verifier + production build +
// Tailwind utility presence in the built CSS. Used by /gsd-verify-work and
// by the closeout task in Plan 01-03.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function run(name, cmd, args) {
  // Only npx invocations need the Windows shell (for .cmd shim resolution).
  // Direct node + script-path calls must avoid the shell so paths with
  // spaces do not get split at the first space by cmd.exe.
  const useShell = process.platform === 'win32' && cmd === 'npx';
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: useShell });
  if (res.status !== 0) {
    console.error(`PHASE 1 SMOKE FAILED at step ${name}`);
    process.exit(res.status ?? 1);
  }
}

// Step 1: aggregate verifier (tsc + 5 gates + vitest)
run('verify-phase-1', 'node', [path.join(ROOT, 'scripts', 'verify-phase-1.cjs')]);

// Step 2: production build
run('electron-vite build', 'npx', ['electron-vite', 'build']);

// Step 3: assert built bundle + Tailwind utility class present in emitted CSS
const rendererHtml = path.join(ROOT, 'out', 'renderer', 'index.html');
if (!fs.existsSync(rendererHtml)) {
  console.error(`PHASE 1 SMOKE FAILED: missing ${rendererHtml}`);
  process.exit(1);
}

const assetsDir = path.join(ROOT, 'out', 'renderer', 'assets');
if (!fs.existsSync(assetsDir)) {
  console.error(`PHASE 1 SMOKE FAILED: missing ${assetsDir}`);
  process.exit(1);
}

const cssFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.css'));
if (cssFiles.length === 0) {
  console.error(`PHASE 1 SMOKE FAILED: no .css emitted in ${assetsDir}`);
  process.exit(1);
}

let foundTailwindUtility = false;
for (const css of cssFiles) {
  const text = fs.readFileSync(path.join(assetsDir, css), 'utf8');
  // Tailwind utility classes used in Login.tsx: bg-slate-50, min-h-screen,
  // grid place-items-center, rounded-md, text-slate-500. Any one of these
  // proves Tailwind + PostCSS ran on the renderer source.
  if (/bg-slate-50|min-h-screen|grid|rounded-md|text-slate-500/.test(text)) {
    foundTailwindUtility = true;
    break;
  }
}
if (!foundTailwindUtility) {
  console.error('PHASE 1 SMOKE FAILED: no Tailwind utility class found in emitted CSS — Tailwind pipeline did not run');
  process.exit(1);
}

console.log('PHASE 1 SMOKE PASSED');
