#!/usr/bin/env node
// Phase 8 / Plan 06 — license IPC gate grep drift detector (LIC-04 + D-07).
//
// Mirrors the shape of scripts/check-ipc-contract.cjs:
//   1. Read src/main/license/gate.ts + extract EXEMPT_CHANNELS as a Set.
//   2. Scan every src/main/ipc/*.ts file for `ipcMain.handle(` lines.
//   3. Assert every match is wrapped with `licenseGated(IPC.X, ...)` OR
//      the channel name appears in EXEMPT_CHANNELS.
//   4. Exit 2 on drift; console.log success on pass.
//
// The grep is intentionally line-scoped — a single `ipcMain.handle(...)`
// invocation that spans multiple lines will match on the OPENING line
// only (the line that contains `ipcMain.handle(`). The wrap check is
// also line-scoped (`/licenseGated\(/` on the SAME line) — multi-line
// wrappers DO appear on the same line in the codebase (Plan 03 + 04
// unified the shape; the wrapper is always inline).
//
// If a future refactor moves the wrapper to its own line, this script
// becomes the canary — the next drift entry will surface it as a
// regression on `npm run test:unit` (when wired into CI by the
// orchestrator) or as a pre-commit hook.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const IPC_DIR = path.join(ROOT, 'src', 'main', 'ipc');
const GATE_PATH = path.join(ROOT, 'src', 'main', 'license', 'gate.ts');

function readOrFail(p) {
  if (!fs.existsSync(p)) {
    console.error(`LICENSE GATE DRIFT: missing file ${p}`);
    process.exit(2);
  }
  return fs.readFileSync(p, 'utf8');
}

// 1. Parse EXEMPT_CHANNELS from gate.ts. The shape is:
//      export const EXEMPT_CHANNELS: ReadonlySet<string> = new Set<string>([
//        IPC.AUTH_STATUS,
//        ...
//        IPC.AUDIT_LOG,
//      ]);
//    We extract the contents between `[` and `]` then strip the IPC. prefix.
const gateSrc = readOrFail(GATE_PATH);
const exemptMatch = gateSrc.match(
  /EXEMPT_CHANNELS[^=]*=\s*new Set<string>\(\[([\s\S]*?)\]\)/,
);
if (!exemptMatch) {
  console.error(
    `LICENSE GATE DRIFT: could not parse EXEMPT_CHANNELS from ${GATE_PATH}`,
  );
  process.exit(2);
}

// ponytail: strip comment lines BEFORE splitting on commas — comments and
// entries live on separate lines inside the array literal, but the first
// comment line and first IPC.X entry end up concatenated by the split
// (no comma between them). Pre-filtering on the per-line shape is cleaner
// than trying to peel comments off each split element.
const exemptChannels = new Set(
  exemptMatch[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('IPC.'))
    .map((s) => s.replace(/,$/, '').slice(4)), // strip "IPC." + trailing comma
);

// 2. Scan every src/main/ipc/*.ts file for ipcMain.handle( occurrences.
if (!fs.existsSync(IPC_DIR)) {
  console.error(`LICENSE GATE DRIFT: missing directory ${IPC_DIR}`);
  process.exit(2);
}

const ipcFiles = fs
  .readdirSync(IPC_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));

let drift = false;
for (const file of ipcFiles) {
  const src = readOrFail(path.join(IPC_DIR, file));
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match either the IPC.X form or the raw 'a:b' literal form. Plan 03
    // + 04 standardized on IPC.X for every channel.
    const handleMatch = line.match(
      /ipcMain\.handle\(\s*(IPC\.[A-Z_]+|'([a-z:-]+)')/,
    );
    if (!handleMatch) continue;
    const channel = handleMatch[1] ? handleMatch[1].slice(4) : handleMatch[2];
    const isExempt = exemptChannels.has(channel);
    const isWrapped = /licenseGated\(/.test(line);
    if (isExempt) continue;
    if (isWrapped) continue;
    console.error(
      `LICENSE GATE DRIFT: ${file}:${i + 1}  ipcMain.handle(${channel}) is not wrapped with licenseGated(IPC.${channel}, ...)`,
    );
    drift = true;
  }
}

if (drift) {
  console.error(
    'LICENSE GATE DRIFT: unwrapped ipcMain.handle() calls found. Wrap each call with licenseGated(IPC.X, handler) per src/main/license/gate.ts.',
  );
  process.exit(2);
}
console.log(
  'license gate OK (' + ipcFiles.length + ' IPC files scanned, ' + exemptChannels.size + ' exempt channels)',
);