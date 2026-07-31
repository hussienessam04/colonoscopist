---
status: complete
phase: 01-scaffold
source: [01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md]
started: 2026-07-31T18:30:00.000Z
updated: 2026-07-31T21:55:00.000Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold-start smoke test
expected: |
  From a fresh state, `npm run dev` starts the Electron app. The Colonoscopist window appears with the login placeholder visible, no crash dialog.
result: pass
notes: |
  Two issues surfaced and were fixed during the test:
  1. G-01-1a: electron binary postinstall skipped by `--ignore-scripts`.
     Fixed via scripts/fix-electron-path.cjs.
  2. G-01-1b: BrowserWindow was created but never given a URL. Added
     loadURL/loadFile in src/main/window.ts. After both fixes, the
     Electron window opens cleanly and the browser-at-localhost:5173
     also renders (with a hint banner when no preload is present).

### 2. Window title is "Colonoscopist"
expected: |
  The window title bar (top of the OS window) reads `Colonoscopist`. Not "Electron", not "Vite", not anything else.
result: pass

### 3. Window opens at 1280×800
expected: |
  The window appears at exactly 1280 pixels wide and 800 pixels tall (default). The OS does not show it smaller or larger.
result: pass

### 4. Window minimum size is 1280×800
expected: |
  Dragging the window edge inward does not let it shrink below 1280×800; the OS snaps the size.
result: pass

### 5. Window maximum size is 1920×1080
expected: |
  Dragging the window edge outward does not let it grow beyond 1920×1080; the OS caps the size.
result: pass

### 6. Clinic logo placeholder is visible
expected: |
  In the center of the login page, a gray 128×128 rounded box contains the literal text `Clinic Logo`.
result: pass

### 7. PIN input is disabled, masked, 4-char, numeric
expected: |
  Below the logo, an input field is visible. It is greyed out (disabled, cannot be focused/typed into), shows dots not plaintext (password-masked), accepts at most 4 characters, and the placeholder reads `Enter PIN`.
result: pass

### 8. Enter button is disabled
expected: |
  Below the input, a button labeled `Enter` is visible but greyed out. Clicking it does nothing.
result: pass

### 9. Banner copy is the exact literal text
expected: |
  Below the Enter button, a small grey line of text reads `Auth ships in Phase 2 — PIN input is disabled` (verbatim — including the em-dash `—`, not a hyphen).
result: pass

### 10. DevTools console: IPC round-trip returns scaffold payload
expected: |
  Open DevTools (Ctrl+Shift+I), in the console paste: `await window.api.auth.status()`. The promise resolves to the literal object `{ authenticated: false, reason: 'scaffold' }` (visible as `{authenticated: false, reason: "scaffold"}`).
result: pass

### 11. Terminal shows better-sqlite3 ABI log line
expected: |
  In the terminal where `npm run dev` is running, the stdout/stderr shows a line starting with `[boot] better-sqlite3 binding version: 11.10.0`.
result: pass

### 12. Terminal shows safeStorage availability log line
expected: |
  In the same terminal, a second line shows `[boot] safeStorage encryption available: true` (or `false` on a system without OS-level keychain).
result: pass

### 13. startup.log is written under userData
expected: |
  After running `npm run dev` for ~10 seconds, a file exists at `%APPDATA%\Colonoscopist\logs\startup.log` (Windows) with at least one entry containing the timestamp and the `better-sqlite3=11.10.0` token.
result: pass

## Summary

total: 13
passed: 13
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]
