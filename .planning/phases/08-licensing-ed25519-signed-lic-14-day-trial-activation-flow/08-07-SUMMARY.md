---
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
plan: 07
subsystem: license
tags: [fix, esm-cjs-interop, gap-closure]
gap_closure: true
gap_ids: [G-08-1]
requires: [08-01, 08-03]
provides: [ERR_REQUIRE_ESM-fix, boot-clean]
status: complete
---

# Phase 8 Plan 7: ERR_REQUIRE_ESM fix (boot crash on @noble/ed25519)

Convert `src/main/license/verify.ts`'s static ESM imports of `@noble/ed25519` + `@noble/hashes/sha2.js` to dynamic `await import()` so the bundled CJS main process no longer emits `require("@noble/ed25519")` and crashes at boot with `ERR_REQUIRE_ESM`. Closes gap **G-08-1** (Phase 8 blocker).

## What shipped

3 source files modified + 2 test files modified (~30 lines changed):

| File | Change |
|------|--------|
| `src/main/license/verify.ts` | Deleted static imports (was 19-20) + module-level `ed.hashes.sha512` hookup; marked `_verifyLicense` async and added dynamic `await import()` for both noble packages as the first statement so the sha512 hookup still runs before `ed.verify()` (required by v3). |
| `src/main/license/load-license.ts` | Added `await` before `verifyLicense({...})` at line 89. |
| `src/main/license/status.ts` | Added `await` before `verifyLicense({...})` at line 43. |
| `tests/main/license/verify.test.ts` | Added `await` to all 7 `verifyLicense({...})` calls; marked the malformed-JSON `it` callback `async`. |
| `tests/integration/license-verify-roundtrip.test.ts` | Rule 2 deviation — added `await` to the 2 `verifyLicense({...})` calls (plan missed this caller; typecheck would have caught it). |

**Public surface unchanged**: `verifyLicense` is still the only verifier export, still `Object.freeze`'d at module export (works on async function references too), signature change is `VerifyResult → Promise<VerifyResult>`. The dynamic-import pattern mirrors the existing `src/main/backup/index.ts:52` precedent used for `archiver v8`.

## Verification results

All 4 plan verification commands pass on the touched files:

1. **`npm run typecheck`** — pre-existing project errors only (`Report.findings`, `ReportUpdatePatch.esophagus`, etc. from the unmerged `260812-redesign-report-procedure-type` quick plan). **Zero errors** on the license files — `findstr /i "license|verify|noble"` against the typecheck output returns no matches. The async propagation to `load-license.ts` + `status.ts` + integration test compiles clean.
2. **`npm run test:unit -- tests/main/license/verify.test.ts tests/main/license/load-license.test.ts tests/main/license/pick-and-activate.test.ts`** — **16/16 tests pass** (8 verify + 4 load-license + 4 pick-and-activate). `Object.isFrozen(verifyLicense) === true` still holds.
3. **`npm run build`** — `electron-vite build` succeeds; `out/main/index.js` produced (296.07 kB).
4. **`grep` for `require\(.*@noble` in `out/main/index.js`** — **0 matches**. The CJS require is gone; root cause is eliminated.

## Deviations from plan

### Rule 2 — Auto-added missing critical functionality

**1. `tests/integration/license-verify-roundtrip.test.ts` needed `await` propagation (plan missed it)**

- **Found during:** pre-commit verification (typecheck scan)
- **Issue:** Plan 08-07 listed only `src/main/license/verify.ts` + `tests/main/license/verify.test.ts` in `files_modified`, with explicit `await` propagation to `src/main/license/load-license.ts:89` + `src/main/license/status.ts:43`. The plan did NOT mention the integration test at `tests/integration/license-verify-roundtrip.test.ts:93,138`, which also calls `verifyLicense({...})` synchronously. After the verify signature became `Promise<VerifyResult>`, those calls would fail typecheck.
- **Fix:** Added `await` to both `verifyLicense({...})` calls in the integration test. The outer `it` callbacks were already `async`.
- **Files modified:** `tests/integration/license-verify-roundtrip.test.ts` (+2/-2 lines)
- **Commit:** `23ced22`

### Pre-existing project condition (not introduced by this plan)

The project typecheck reports ~9 pre-existing errors in `src/main/db/reports-repo.ts`, `src/main/ipc/reports.ts`, `src/main/pdf/render-report-pdf.ts` — `Report.findings`, `ReportUpdatePatch.esophagus`, `setProcedureType`, etc. all reference fields not yet declared on the `Report` type. These come from the unmerged `260812-redesign-report-procedure-type` quick plan in the dirty working tree and are out of scope for G-08-1. No typecheck error was introduced by this plan; the license path itself typechecks clean.

## Root cause recap (for future readers)

`@noble/ed25519@^3` and `@noble/hashes` are pure-ESM packages. `electron-vite`'s `externalizeDepsPlugin` correctly leaves them external in the bundle, which means the compiled `out/main/index.js` (CJS) emitted `require("@noble/ed25519")` at module load time. Node 24's CJS loader rejects the synchronous `require()` of an ESM-only module with `ERR_REQUIRE_ESM`, crashing the Electron main process before it could boot. The fix replaces the static top-level `import` (which compiles to `require()`) with a function-scoped `await import()` inside `_verifyLicense`. The dynamic-import form is interop-clean in both the bundled CJS main module and the vitest test environment. The same pattern was already used for `archiver v8` in `src/main/backup/index.ts:52` (Plan 07-01).

Two non-negotiable constraints drove the shape of the fix:

1. **Do not downgrade `@noble/ed25519`** — Phase 8 research explicitly rejected v2; v3's `sha512` hookup is required by the library's design (`ed.hashes.sha512 = sha512` must run before `ed.verify()`).
2. **Do not touch `electron.vite.config.ts`** — `externalizeDepsPlugin` is correct; the bug was in the import shape, not the externalization. Fixing the build config (e.g., switching to `noExternal`) would create a heavier dependency-tree embedding with no upside.

## Commit graph

```
bcdcb83 fix(08-07): convert @noble/ed25519 + @noble/hashes static imports to dynamic await import()
23ced22 test(08-07): propagate await to verifyLicense calls in verify + roundtrip tests
[3rd]    docs(08-07): complete Plan 7 - ERR_REQUIRE_ESM fix + SUMMARY  ← this commit
```
