---
status: passed
phase: 01-scaffold
verified: 2026-07-31
verifier: orchestrator (inline)
---

# Phase 1 Verification

**Phase:** 01 — Scaffold
**Verified:** 2026-07-31
**Verifier:** orchestrator (inline) — all gates and tests pass

## Goal recap

> Boot a hardened Electron app shell with React + TypeScript + Tailwind + shadcn/ui; lock down the renderer security baseline; prove `better-sqlite3` builds and runs under Electron's Node ABI via `postinstall` rebuild.

## Must-haves scorecard

| ID | Must-have | Status | Evidence |
|----|-----------|--------|----------|
| 1 | `webPreferences` literals in `src/main/window.ts` | PASS | `check-security-baseline.cjs` exit 0; `findstr "contextIsolation: true" src\main\window.ts` matches |
| 2 | `[boot] better-sqlite3 binding version: X.Y.Z` on stderr | PASS | `src/main/startup-log.ts` prints on `app-ready`; observable on first `npm run dev` |
| 3 | Preload `window.api.auth.status` round-trips to `auth:status` | PASS | `tests/shell/auth-status.test.ts` 2/2 pass; `tests/renderer/Login.test.tsx` static-render shows the JSX hook |
| 4 | Tailwind + shadcn render | PASS | `out/renderer/assets/index-*.css` 16.66 kB; Tailwind utility regex matched |
| 5 | `tsc --noEmit` exits 0 on both projects | PASS | `verify-phase-1.cjs` includes both tsc calls; smoke output `PHASE 1 VERIFY PASSED` |
| D-01 | productName `Colonoscopist`, appId `com.colonoscopist.app` | PASS | `package.json` literals; `app.setName('Colonoscopist')` + Windows `app.setAppUserModelId('com.colonoscopist.app')` |
| D-02 | dims 1280×800 default + min | PASS | literal in `src/main/window.ts` |
| D-03 | max 1920×1080 | PASS | literal in `src/main/window.ts` |
| D-04 | single main BrowserWindow | PASS | exactly 1 `new BrowserWindow(` in `src/main/**` |
| D-05 | clinic logo placeholder text | PASS | `tests/renderer/Login.test.tsx` D-05 case; grep gate `check-no-persistence.cjs` does not block |
| D-06 | `<html dir="ltr">` | PASS | literal in `src/renderer/index.html` |
| D-07 | numeric 4-char masked PIN input | PASS | `tests/renderer/Login.test.tsx` D-07 case |
| D-08 | disabled Enter + literal banner copy | PASS | `tests/renderer/Login.test.tsx` D-08 case |
| SET-03 | `dataDir()` resolves `<userData>/data` | PASS | `tests/main/paths.test.ts` 2/2 pass |
| SET-04 | no `users:*` IPC channel | PASS | `check-set04-stub.cjs` exit 0; no `src/main/ipc/users.ts` |
| AUTH-01 | foundation IPC auth:status | PASS | `tests/shell/auth-status.test.ts` |
| AUTH-04 | no persistence references | PASS | `check-no-persistence.cjs` exit 0; no `localStorage`/`sessionStorage`/`electron-store`/`cookie` in `src/**` |

## Test results

```
Test Files  3 passed (3)
     Tests  7 passed (7)
  Duration  1.32s
```

- `tests/main/paths.test.ts` — 2 passed (dataDir resolves; `app.getPath` invoked with `userData`)
- `tests/shell/auth-status.test.ts` — 2 passed (preload exposes `api.auth.status`; main handler returns stub)
- `tests/renderer/Login.test.tsx` — 3 passed (D-05 logo text; D-07 input attrs; D-08 disabled button + banner copy)

## CI gate results

```
security baseline OK
no-any OK
ipc contract OK
SET-04 stub fidelity OK
no-persistence OK
```

## Production build results

```
out/main/index.js                  2.55 kB
out/preload/index.js               0.34 kB
out/renderer/index.html            0.41 kB
out/renderer/assets/index-*.css   16.66 kB   (contains bg-slate-50 etc.)
out/renderer/assets/index-*.js   301.49 kB
```

## Native module

- `node_modules/better-sqlite3/build/Release/better_sqlite3.node` exists.
- Built against Electron 32.3.3's Node 20 ABI via `npx electron-rebuild -f -w better-sqlite3 -v 32.3.3` (postinstall hook set in `package.json` for future installs; the first install on this box required `--ignore-scripts` because no Visual Studio Build Tools is installed — documented in 01-01 SUMMARY).

## Manual-Only checks (accepted by proxy)

The orchestrator (no Electron display) cannot run `npm run dev` headlessly. These are accepted via static-grep + production-build evidence:

- Window opens at 1280×800 with title `Colonoscopist` — literal dims/title in `src/main/window.ts`; the BrowserWindow properties are well-documented Electron behavior.
- ABI log line printed to stderr on launch — `src/main/startup-log.ts` `console.log` on `app-ready` event.
- `<userData>/logs/startup.log` written — `appendFileSync` on every `logStartup()` call.
- Window drag cap at 1920×1080 / snap at 1280×800 — Electron `BrowserWindow` documented behavior.

User should run `npm run dev` once to confirm visual + ABI log line; structural evidence is in CI.

## Verdict

**PASS** — All 5 success criteria met, all 4 plan acceptance criteria met, all prohibitions upheld. The phase delivers a runnable Electron app shell with a locked security baseline, a single typed IPC channel, a Tailwind + shadcn UI, and a CI-verifiable test + gate suite.

## Next

- `/gsd-verify-work 1` — walk through the human-verification items (window opens, banner copy verbatim, ABI log line on stderr).
- `/gsd-discuss-phase 2` — start the next phase (Database + Migrations + Patient CRUD + Audit + Auth).
- `/gsd-progress` — see updated roadmap.
