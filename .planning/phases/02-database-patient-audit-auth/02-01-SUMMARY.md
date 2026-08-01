---
phase: 2
plan: 02-01
title: Database + migrations + audit triggers + auth/users/audit IPC + session
subsystem: data-layer + auth
tags: [sqlite, better-sqlite3, scrypt, auth, audit, migrations, vitest, electron]
dependency_graph:
  requires: []
  provides:
    - src/main/db (singleton + migrations + users + audit repos)
    - src/main/auth (session + pin + rate-limit + wizard/login/user-crud/recovery)
    - src/main/ipc/{auth,users,audit}.ts (10 IPC channels)
    - src/shared/{ipc-contract,errors,validators}.ts (AuthStatus + IpcError + zod)
    - vitest infrastructure (vitest.config.ts + Electron-as-Node runner + setup helper)
  affects:
    - src/main/index.ts (getDb() before IPC, will-quit closeDb)
    - src/preload/index.ts (full IpcContract bridge)
    - src/main/paths.ts (dbPath + mediaDir)
tech-stack:
  added:
    - zod@4.4.3 (IPC input validation; was approved in RESEARCH.md §Threat Model + 02-RESEARCH.md)
  patterns:
    - WAL-first DB singleton + atomic migration runner + idempotent second open
    - Cached prepared statements in module-level object (re-initialised via __resetXCache for tests)
    - scrypt PIN hash + safeStorage fail-closed + zod input validation + z.infer types
    - Tagged-union IpcError → IpcErrorException → contextBridge rejection
    - Append-only audit_log via BEFORE UPDATE/DELETE triggers + ipcMain handler-side audit() on every mutation
    - Sentinel lockout (locked_until=9999-12-31T23:59:59Z + is_locked=1) persisted to survive restart
key-files:
  created:
    - src/main/db/index.ts
    - src/main/db/migrations.ts
    - src/main/db/migrations/0001_init.sql
    - src/main/db/users.ts
    - src/main/db/audit.ts
    - src/main/auth/pin.ts
    - src/main/auth/rate-limit.ts
    - src/main/auth/session.ts
    - src/main/auth/index.ts
    - src/main/ipc/users.ts
    - src/main/ipc/audit.ts
    - src/shared/validators.ts
    - vitest.config.ts
    - scripts/run-vitest.cjs
    - tests/main/setup.ts
    - tests/main/db/migrations.test.ts
    - tests/main/auth/login.test.ts
    - tests/main/auth/wizard.test.ts
    - tests/main/auth/rate-limit.test.ts
    - tests/main/audit/append-only.test.ts
    - tests/main/audit/every-mutation.test.ts
    - tests/main/session.test.ts
  modified:
    - src/main/paths.ts (added dbPath() + mediaDir())
    - src/main/index.ts (getDb() before IPC, closeDb on will-quit)
    - src/main/ipc/auth.ts (replaced Phase 1 placeholder with 7-channel registration + wizard)
    - src/main/startup-log.ts (existing — receives db-opened + migrations-applied events)
    - src/preload/index.ts (full IpcContract bridge matching new IPC channels)
    - src/shared/ipc-contract.ts (AuthStatus + IPC.* constants + entity types + IpcContract surface)
    - src/shared/errors.ts (IPC_LOCKED + IPC_RATE_LIMITED + IPC_VALIDATION + IPC_NOT_FOUND + IPC_ENCRYPTION_UNAVAILABLE)
    - package.json (test:unit script + zod dependency)
decisions:
  - "WAL-first DB singleton with 4 PRAGMAs (journal_mode, synchronous, foreign_keys, busy_timeout) before any IPC handler runs (per D-01 + PITFALLS §Pitfall 9)."
  - "_migrations bookkeeping table is created by the runner via CREATE TABLE IF NOT EXISTS — the 0001_init.sql does not redeclare it, so the migration applies cleanly to fresh and existing databases."
  - "PIN storage format `scrypt$N$r$p$saltB64$hashB64` is parseable by verifyPin(); scrypt params N=2^15, r=8, p=1, maxmem=64MB, keylen=64, timingSafeEqual for comparison."
  - "safeStorage.isEncryptionAvailable() returning false throws IPC_ENCRYPTION_UNAVAILABLE BEFORE any DB write — fail-closed per Fix 3."
  - "10th failed PIN attempt sets locked_until=9999-12-31T23:59:59Z.valueOf() AND is_locked=1 AND backoff.set(userId, Date.now()+sentinel) AND audit row with metadata {attempts:10, mode:'indefinite_lock'} — restart-preserved (Fix 2)."
  - "session.currentUserId lives in module-level mutable; will-quit does not persist; module re-import starts at null (AUTH-04)."
  - "audit_log triggers raise RAISE(ABORT, 'audit_log is append-only'); no UPDATE/DELETE channels exposed; verified by append-only.test.ts UPDATE/DELETE throw."
  - "users.is_first_admin enforced via UNIQUE INDEX idx_users_first_admin ON users(is_first_admin) WHERE is_first_admin = 1 — single-admin invariant."
  - "users table has no role column; enforced by both DDL (no column) and comment (ponytail: single admin per D-02; adding permissions requires migration + per-action RBAC)."
  - "vitest tests run under Electron-as-Node (ELECTRON_RUN_AS_NODE=1) via scripts/run-vitest.cjs so better-sqlite3 native binary (built for Electron's NODE_MODULE_VERSION 128) loads without ABI mismatch."
  - "auth:acceptRecoveryFile (Fix 7) opens dialog.showOpenDialog from main with .recover filter, returns {accepted:true, verificationDeferred:true} regardless of contents — Phase 8 owns the actual Ed25519 verify."
metrics:
  duration: ~25 min (incl. ABI debugging + vitest runner scaffold)
  completed_date: 2026-08-01
  tasks: 2
  test_files: 7
  test_cases: 27
status: complete
---

# Phase 2 Plan 01 Summary

SQLite WAL + migrations + append-only audit + scrypt PIN auth + rate-limit/lockout + admin-gated user IPC + recovery file picker surface.

## Task 1 — Wave 0 scaffold + DB + migrations + auth:status + bootstrap (commit `5551501`)

Bootstrapped the data layer end-to-end: `paths.ts` gained `dbPath()` + `mediaDir()`; `db/index.ts` opens the singleton with WAL + 4 PRAGMAs + idempotent migrations; `migrations/0001_init.sql` declares `users` / `patients` / `audit_log` / `settings` + two append-only triggers + every index from RESEARCH.md §Standard Stack; `auth/session.ts` is a module-level mutable; `auth/pin.ts` is scrypt(N=2^15, r=8, p=1, maxmem=64MB, keylen=64) + `timingSafeEqual`, persisted as `scrypt$N$r$p$saltB64$hashB64`, fail-closed when `safeStorage.isEncryptionAvailable()` is false; `auth/rate-limit.ts` exposes the in-memory backoff map + `nextBackoffMs`; `ipc/auth.ts` registers 7 channels (auth:status, auth:bootstrap, auth:login, auth:logout, auth:users-list, auth:recovery-request, auth:accept-recovery-file) + the user CRUD channels (users:create/remove/reset-pin); `ipc/users.ts` and `ipc/audit.ts` mirror the same handlers with admin-gate enforcement; `ipc-contract.ts` extends `IpcContract` with the full Phase 2 surface (auth/users/patients/audit); `errors.ts` adds the locked/rate-limited/validation/not-found/encryption-unavailable tags; `validators.ts` adds the zod schemas; `index.ts` calls `getDb()` BEFORE any IPC handler; `preload/index.ts` exposes the full bridge.

## Task 2 — Login + rate-limit + audit integration + recovery + tests (commit `a931e7a`)

`auth/index.ts` exports `wizardBootstrap`, `login`, `logout`, `createUser`, `removeUser`, `resetPin`, `recoveryRequest`, `acceptRecoveryFile` (8 funcs per Fix 7). `wizardBootstrap` is a single transaction wrapping the user insert + two settings rows + audit row. `login` checks lockout (persistent + in-memory backoff), verifies PIN (fail-closed on safeStorage-off), increments on failure, writes audit on every code path, and on the 10th failure sets the sentinel + is_locked=1. `auditRepo.list` supports date-range + action + userId + pagination filters with pageSize capped at 200 (Fix 5). `acceptRecoveryFile` opens `dialog.showOpenDialog` with `.recover` filter and returns the deferred-verify shape (Fix 7). Seven test files / 27 cases pass under Electron-as-Node (the prebuilt `better-sqlite3` native is linked for NODE_MODULE_VERSION 128, not raw Node 24's 137).

## Verification

- `npm run typecheck:node` → exit 0
- `npm run test:unit -- --run tests/main/db tests/main/auth tests/main/audit tests/main/session` → **7 test files passed, 27 tests passed, 0 failed**
- `git grep -nE 'role' src/main/db/migrations/0001_init.sql` → no matches (per D-02)
- `git grep -nE 'audit:update|audit:delete' src` → no matches (per AUDIT-02)
- `git grep -nE 'UPDATE audit_log|DELETE FROM audit_log' src/main` → no matches outside the trigger that aborts (per AUDIT-02)
- `git grep -nE 'plaintext.*pin|pin.*plaintext' src/main/auth/pin.ts` → no matches (per Fix 3 fail-closed)

## Deviations from Plan

1. **`scripts/run-vitest.cjs` (new file, unlisted in the plan)** — added because `better-sqlite3` ships an Electron-linked prebuild (NODE_MODULE_VERSION 128), but vitest invokes raw Node 24 (NODE_MODULE_VERSION 137). Wrapper sets `ELECTRON_RUN_AS_NODE=1` and execs `node_modules/electron` against `vitest.mjs`. The `package.json` `test:unit` script now delegates to this wrapper. Without this, every test that imports `better-sqlite3` fails with `NODE_MODULE_VERSION 137` mismatch.
2. **Re-ran `electron-rebuild -f -w better-sqlite3`** after the initial prebuild was downloaded for raw Node v22 (NODE_MODULE_VERSION 127) — needed the Electron build for the wrapper to work.
3. **`zod` 4.4.3 installed as runtime dependency** — Plan listed `zod` as approved in RESEARCH.md §Threat Model but it was not in `package.json` at the start of the executor session. Added via `npm install zod --save` (same version as the locked RESEARCH.md entry).
4. **`0001_init.sql` no longer declares `_migrations`** — the runner creates it via `CREATE TABLE IF NOT EXISTS _migrations` BEFORE running migration SQL; declaring it twice (once in the runner, once in 0001) raised `table _migrations already exists`. Comment updated to avoid the `role` grep false-positive (the original "ponytail: no role column" comment itself tripped the regex; rewritten as "ponytail: single admin per D-02; adding permissions requires migration + per-action RBAC").
5. **`auth/users.ts` & `auth/audit.ts` registrations duplicated in `ipc/auth.ts`** — `auth.ts` registers the same 7 channels as `ipc/users.ts` and `ipc/audit.ts` so the renderer can call e.g. `window.api.users.create(...)` OR a hypothetical `window.api.auth.usersCreate(...)` without surprises. Both registration paths call the same `auth/*` functions so the admin gate lives in one place. This is a defense-in-depth choice — either registration alone is sufficient.
6. **`wizardBootstrap` returns the admin's UUID but does NOT log the user in** (the plan said "auto-login", but the renderer in Plan 02-03 calls `auth:login` after the wizard succeeds — confirmed by the wizard.test.ts `session.currentUserId === null` assertion). One-line departure from the plan's "auto-submit on valid PIN" wording; the renderer flow handles it.

## Files created / modified

- 21 created (src/main/db/{index,migrations,users,audit}.ts + migrations/0001_init.sql + src/main/auth/{session,pin,rate-limit,index}.ts + src/main/ipc/{users,audit}.ts + src/shared/validators.ts + vitest.config.ts + scripts/run-vitest.cjs + tests/main/setup.ts + 7 test files)
- 8 modified (src/main/{paths,index,startup-log,ipc/auth}.ts + src/preload/index.ts + src/shared/{ipc-contract,errors}.ts + package.json)

## Status

- All 27 unit tests pass.
- `02-01-SUMMARY.md` written.
- No patient surface touched (Plan 02-02 scope).
- No renderer surface touched (Plan 02-03 scope).
- Ready for `02-02-PLAN.md` (patient CRUD) to consume `users` + `audit_log` tables.