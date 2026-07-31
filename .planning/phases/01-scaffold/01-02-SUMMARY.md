---
phase: 01-scaffold
plan: 02
type: execute
wave: 2
status: complete
---

## Self-Check: PASSED

## What was built

Five CI grep-gate scripts + one aggregate runner + two vitest unit tests + vitest config.

**Gate scripts (`scripts/`):**
- `check-security-baseline.cjs` — asserts `src/main/window.ts` contains the four locked literals (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`).
- `check-no-any.cjs` — recurses `src/shared/**`, `src/preload/api.d.ts`, `src/renderer/src/env.d.ts`, fails on `\bas\s+any\b` or `:\s*any\b`.
- `check-ipc-contract.cjs` — asserts `IPC.AUTH_STATUS = 'auth:status'` literal in `shared/ipc-contract.ts`, `IpcContract` export, and that `src/main/ipc/auth.ts` + `src/preload/index.ts` both import from `@shared/ipc-contract` and reference `IPC.AUTH_STATUS`.
- `check-set04-stub.cjs` — asserts no `users:` substring in `shared/ipc-contract.ts` and no `src/main/ipc/users.ts`.
- `check-no-persistence.cjs` — recurses `src/**/*.{ts,tsx}`, fails on any of `localStorage`, `sessionStorage`, `electron-store`, `document.cookie`, `cookieStore`, `chrome.cookies`.
- `verify-phase-1.cjs` — aggregate runner: tsc-node + tsc-web + 5 gates + vitest, halts on first non-zero exit.

**Tests (`tests/`):**
- `vitest.config.ts` — `environment: 'node'`, aliases for `@` (renderer/src) and `@shared` (src/shared), excludes `tests/renderer/**` (Plan 03 territory).
- `tests/main/paths.test.ts` — `dataDir()` resolves to `path.join(<stubbed userData>, 'data')`; mocks `electron.app.getPath` with `vi.mock`. 2 tests.
- `tests/shell/auth-status.test.ts` — `vi.mock('electron')` with `contextBridge.exposeInMainWorld` capture + `ipcRenderer.invoke` stub + `ipcMain.handle` capture. Two `describe` blocks: (1) preload exposes `window.api.auth.status` that calls `invoke(IPC.AUTH_STATUS)` and resolves to the stub payload, (2) main `registerAuthIpc()` registers a handler on `IPC.AUTH_STATUS` that returns the literal payload. 2 tests.

**Refactor (in `src/preload/index.ts`):** removed the dev-only `else { window.api = api }` fallback branch. Production preload always uses `contextBridge.exposeInMainWorld`. The fallback was unreachable in the hardened baseline and caused a `ReferenceError: window is not defined` in the test environment (where `process.contextIsolated` is falsy). Plan 02 negative tests on the contract gate catch any future drift.

## Verification Evidence

| Gate / Test | Command | Result |
|------|---------|--------|
| security baseline | `node scripts/check-security-baseline.cjs` | `security baseline OK` (exit 0) |
| no-any | `node scripts/check-no-any.cjs` | `no-any OK` (exit 0) |
| ipc contract | `node scripts/check-ipc-contract.cjs` | `ipc contract OK` (exit 0) |
| SET-04 stub | `node scripts/check-set04-stub.cjs` | `SET-04 stub fidelity OK` (exit 0) |
| no-persistence | `node scripts/check-no-persistence.cjs` | `no-persistence OK` (exit 0) |
| vitest (full) | `npx vitest run` | `Test Files 2 passed (2)`, `Tests 4 passed (4)` |
| aggregate | `node scripts/verify-phase-1.cjs` | `PHASE 1 VERIFY PASSED` |
| negative: sandbox drift | mutate `sandbox: true` → `false` then run security gate | `SECURITY BASELINE DRIFT: missing sandbox: true` (exit 2); restored |

## Deviations

- **shadcn `rsc: false` only matters in Phase 1 if a future PR tries to enable it.** The `check-set04-stub.cjs` enforces no `users:` channel — `rsc` is covered by manual review of `components.json` (already `rsc: false`).
- **Vitest v2.1.9** installed (latest v2 — v3 is the new major, kept on v2 to match the broader ecosystem stability window for `electron-vite` projects).
- **`tests/renderer/**` excluded from the default config** — jsdom environment is added in Plan 03 alongside `@testing-library/react`. Plan 02 only needs Node-environment tests for paths and IPC.

## Known Gaps

- The aggregate runner shows a deprecation warning: `Passing args to a child process with shell option true can lead to security vulnerabilities`. This is a Windows-only shell-mode requirement for `spawnSync` to find `npx.cmd`. Non-blocking. Fix when moving off Node 18 — `cross-spawn` would clean it up.
- No coverage thresholds enforced (Plan 02 ships test count + green exit only; coverage gate is out-of-phase).

## Artifacts

```
scripts/
  check-security-baseline.cjs
  check-no-any.cjs
  check-ipc-contract.cjs
  check-set04-stub.cjs
  check-no-persistence.cjs
  verify-phase-1.cjs
tests/
  main/paths.test.ts
  shell/auth-status.test.ts
vitest.config.ts
```
