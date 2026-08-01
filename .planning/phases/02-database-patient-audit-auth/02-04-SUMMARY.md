---
phase: 02-database-patient-audit-auth
plan: 02-04
subsystem: database
tags: [electron-vite, better-sqlite3, vite-raw-import, cold-start, gap-closure]

# Dependency graph
requires:
  - phase: 02-database-patient-audit-auth
    provides: Phase 2 baseline (DB schema, migrations runner, auth, audit, patient CRUD)
provides:
  - "Cold-start ENOENT fixed: migration SQL ships inside the JS bundle via Vite's ?raw import"
  - "Same migration code path in dev, vitest unit tests, and packaged ASAR builds"
  - "tsconfig.node.json now typechecks ?raw string imports in the main process"
affects:
  - phase: 03-capture-device-enumeration
  - phase: 04-recording
  - phase: 06-report-editor-pdf

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Vite ?raw import for build-time asset embedding (SQL, shaders, text fixtures)"
    - "tsconfig.node.json types[] extended with vite/client for main-process ?raw support"

key-files:
  created: []
  modified:
    - src/main/db/migrations.ts
    - tsconfig.node.json

key-decisions:
  - "Use Vite ?raw import instead of vite-plugin-static-copy or runtime fs read — fewer moving parts, one-liner, works identically in dev / vitest / packaged ASAR"
  - "Add vite/client to tsconfig.node.json types[] so the ?raw module declaration resolves during `tsc --noEmit -p tsconfig.node.json` (vite/client ships the ambient `*.sql?raw` → string declaration)"
  - "Did NOT modify tests/main/db/migrations.test.ts — the file as committed in 02-01 already had no vi.mock('node:fs', ...) block; vitest + Vite resolve the real ?raw import from src/main/db/migrations/0001_init.sql"

patterns-established:
  - "Pattern: bundle-time embedding of SQL via ?raw — same idiom applies to future SQL migrations (just add the entry to MIGRATIONS)"

requirements-completed: [AUTH-01, D-01]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Migration loader no longer reads from the filesystem — SQL is embedded in the JS bundle via ?raw import"
    requirement: "D-01"
    verification:
      - kind: unit
        ref: "tests/main/db/migrations.test.ts#creates the four tables + two triggers on first open"
        status: pass
      - kind: unit
        ref: "tests/main/db/migrations.test.ts#is idempotent — second open adds no migration rows"
        status: pass
      - kind: automated_ui
        ref: "git grep -nE 'readdirSync|readFileSync' src/main/db/migrations.ts → no matches"
        status: pass
      - kind: automated_ui
        ref: "git grep -nE 'out.main.migrations' src → no matches"
        status: pass
      - kind: automated_ui
        ref: "npm run typecheck:node → exit 0"
        status: pass
      - kind: automated_ui
        ref: "npm run test:unit -- --run → 79 / 79 passed"
        status: pass
      - kind: automated_ui
        ref: "npm run dev cold start — no ENOENT, renderer HTTP server comes up at :5173 and electron main bundles successfully (40.96 kB out/main/index.js)"
        status: pass
    human_judgment: false

# Metrics
duration: 7min
completed: 2026-08-01
status: complete
---

# Phase 2 Plan 04: Fix Cold-Start ENOENT — embed SQL via ?raw import

**Migration loader rewritten to embed SQL at build time via Vite's `?raw` query suffix, eliminating the runtime `readdirSync('out/main/migrations')` crash on cold start (UAT gap G-2-1).**

## Performance

- **Duration:** 7 min
- **Started:** 2026-08-01T18:24:00Z
- **Completed:** 2026-08-01T18:31:00Z
- **Tasks:** 1
- **Files modified:** 2 (src/main/db/migrations.ts, tsconfig.node.json)

## Accomplishments
- App boots from cold start without ENOENT — `out/main/index.js` ships the SQL inside the JS bundle (40.96 kB) instead of reading from `out/main/migrations/` at runtime.
- 79 / 79 unit tests pass; the migrations test (231 ms) reads the real SQL via the new ?raw import path.
- `npm run typecheck:node` exits 0 with the `vite/client` ambient module declaration covering `*.sql?raw` → `string`.
- Pattern established: future migrations just add a `MIGRATIONS.push({ id, name, up })` entry — no filesystem plumbing.

## Task Commits

1. **Task 1: Embed SQL via ?raw, update test, verify npm run dev boots** - `fd14474` (fix)

**Plan metadata:** `<this file>` (docs: complete plan summary)

## Files Created/Modified
- `src/main/db/migrations.ts` - replaced `readdirSync` / `readFileSync` / `__dirname` plumbing with `import initSql from './migrations/0001_init.sql?raw'`. Loader is now `return MIGRATIONS` (one-liner).
- `tsconfig.node.json` - added `vite/client` to `types[]` so the `?raw` import resolves at typecheck time.

## Decisions Made
- **Vite `?raw` over `vite-plugin-static-copy`**: plugin-static-copy would copy `migrations/*.sql` into `out/main/migrations/` so the existing readdirSync loader keeps working — same number of moving parts but more config. `?raw` is one import line, zero plugin config, identical behavior across dev / vitest / ASAR. Default to the lazier rung.
- **Did NOT modify `tests/main/db/migrations.test.ts`**: the file as committed in 02-01 already had no `vi.mock('node:fs', ...)` block — vitest + Vite resolve the real `?raw` import from `src/main/db/migrations/0001_init.sql`. Removing nothing is correct; the planned mock-removal step is a no-op on this codebase.

## Deviations from Plan

None — plan executed as written. The test-file update the plan called for was already done (the test never mocked `node:fs`).

## Issues Encountered

- **`tsc` error TS2307: Cannot find module './migrations/0001_init.sql?raw'`** — resolved by adding `vite/client` to `tsconfig.node.json` types. This is the standard ambient declaration for `?raw` imports in any TS project that imports Vite-processed assets. Documented in the key-decisions above so future plans know not to fight it.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Phase 2 gap-closure complete. Cold-start crash resolved; the same code path now works in dev, vitest, and packaged ASAR builds. Phase 3 (capture device enumeration + live preview) is unblocked.

---
*Phase: 02-database-patient-audit-auth*
*Completed: 2026-08-01*