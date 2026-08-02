// security-baseline.test.ts — asserts the five-flag Electron webPreferences
// configuration in src/main/window.ts.
//
// Per D-11 + PITFALLS Integration Gotchas + BLOCKER 3:
//   - contextIsolation: true
//   - nodeIntegration: false
//   - sandbox: true
//   - webSecurity: true
//   - permissions: ['media']
//
// The test reads the source file (rather than loading it) because Electron's
// BrowserWindow cannot be constructed under vitest. This is the same approach
// the script-based check-security-baseline.cjs uses, but in a form that runs
// under the full test suite.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WINDOW_PATH = path.join(__dirname, '..', '..', 'src', 'main', 'window.ts');

const REQUIRED_LITERALS: Array<[label: string, literal: string]> = [
  ['contextIsolation: true', 'contextIsolation: true'],
  ['nodeIntegration: false', 'nodeIntegration: false'],
  ['sandbox: true', 'sandbox: true'],
  ['webSecurity: true', 'webSecurity: true'],
  ["permissions: ['media']", "permissions: ['media']"],
];

// Drift detectors — flags that would silently degrade the renderer and must
// NOT appear in the locked list.
const FORBIDDEN_LITERALS = [
  'nodeIntegration: true',
  'contextIsolation: false',
  'sandbox: false',
  'webSecurity: false',
];

describe('BrowserWindow security baseline (BLOCKER 3)', () => {
  it('src/main/window.ts exists', () => {
    expect(fs.existsSync(WINDOW_PATH)).toBe(true);
  });

  it.each(REQUIRED_LITERALS)('contains the %s literal in the webPreferences block', (_label, literal) => {
    const src = fs.readFileSync(WINDOW_PATH, 'utf8');
    expect(src).toContain(literal);
  });

  it.each(FORBIDDEN_LITERALS)('does NOT regress to %s', (literal) => {
    const src = fs.readFileSync(WINDOW_PATH, 'utf8');
    expect(src).not.toContain(literal);
  });

  it('wires session.setPermissionRequestHandler so the sandboxed renderer can call getUserMedia', () => {
    const src = fs.readFileSync(WINDOW_PATH, 'utf8');
    expect(src).toMatch(/setPermissionRequestHandler/);
    expect(src).toMatch(/permission\s*===\s*['"]media['"]/);
  });
});