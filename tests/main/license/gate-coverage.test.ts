// @vitest-environment node
// Phase 8 / Plan 06 — gate-coverage.test.ts (LIC-04).
//
// Runtime mirror of scripts/check-license-gate.cjs. Where the grep gate
// is a one-shot shell command, this test runs in vitest alongside the
// other unit tests and asserts the SAME coverage guarantee:
//   - Every `ipcMain.handle(` line in src/main/ipc/*.ts is wrapped with
//     licenseGated(IPC.X, ...).
//   - OR the channel name appears in EXEMPT_CHANNELS (imported from
//     src/main/license/gate.ts as the source of truth).
//
// The script-level gate is defense-in-depth: CI runs the script on
// every commit; this test catches the same drift in the test suite so a
// regression surfaces as a `npm run test:unit` failure instead of a
// script-exit failure.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EXEMPT_CHANNELS } from '../../../src/main/license/gate';
import { IPC } from '../../../src/shared/ipc-contract';

describe('IPC gate coverage (LIC-04)', () => {
  // Resolve the IPC dir relative to this test file. `__dirname` is the
  // test file's directory (tests/main/license/), so 3 hops up lands on
  // the repo root where src/main/ipc/ lives.
  const IPC_DIR = path.join(__dirname, '..', '..', '..', 'src', 'main', 'ipc');
  const ipcFiles = fs.readdirSync(IPC_DIR).filter((f) => f.endsWith('.ts'));

  it('every ipcMain.handle() is wrapped or appears in EXEMPT_CHANNELS', () => {
    const drift: string[] = [];
    for (const file of ipcFiles) {
      const src = fs.readFileSync(path.join(IPC_DIR, file), 'utf8');
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const handleMatch = line.match(
          /ipcMain\.handle\(\s*(IPC\.[A-Z_]+|'([a-z:-]+)')/,
        );
        if (!handleMatch) continue;
        const channel = handleMatch[1] ? IPC[handleMatch[1].slice(4) as keyof typeof IPC] : handleMatch[2];

        // Exempt check: the EXEMPT_CHANNELS set holds the WIRE form
        // (e.g. 'auth:status'). The script parses it from
        // gate.ts's array literal; here we IMPORT the exported set
        // directly so the source-of-truth invariant is enforced.
        const isExempt = [...EXEMPT_CHANNELS].some((c) => c === channel);

        // Wrap check: licenseGated( on the same line as ipcMain.handle(.
        const isWrapped = /licenseGated\(/.test(line);

        if (isExempt) continue;
        if (isWrapped) continue;
        drift.push(`${file}:${i + 1}  ipcMain.handle(${channel})`);
      }
    }
    expect(drift).toEqual([]);
  });
});