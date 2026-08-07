---
phase: 05-screenshots-procedure-review-trim
plan: 08
subsystem: recorder
tags: [ffmpeg, trim, spawn, windowsVerbatimArguments, argv-quoting, contract-guard, regression-guard]
gap_closure: true
gap_ids:
  - G-05-11
status: complete

# Dependency graph
requires:
  - phase: 05-screenshots-procedure-review-trim
    provides: "applyTrim orchestration + spawn layer (Plan 03) using `{ stdio: ['pipe','ignore','pipe'] }`; ffmpeg-args.ts buildTrimArgs + recorder.ts:290 (recording) and recorder.ts:1045 (concat) as canonical spawn patterns; DEBUG-trim-permission-denied.md root-cause analysis with smoking-gun reproduction"
provides:
  - "trim spawn options match the recording/concat canonical pattern — `{ stdio: ['pipe','ignore','pipe'] }` with no `windowsVerbatimArguments` key"
  - "stale header comment in trim.ts corrected: verbatim flag noted as reserved for the recording subprocess's device-name form `video=\"<name>\"`, NOT for trim's path args"
  - "2 contract-guard tests in trim.test.ts locking the spawn options shape against regression"
affects:
  - "Phase 5 plan 05-09 (G-05-12: trim visual timeline) — Trim Apply button is now functional on this user's machine"
  - "Phase 5 UAT re-run (steps 6 + 7: verify trimmed plays + restore original) — now unblocked"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-spawn consistency: trim spawn mirrors the recording + concat spawns — same stdio array, no verbatim flag. Three spawn sites for ffmpeg in main process now use the canonical shape"
    - "Node's default Windows command-line construction wraps argv entries with embedded spaces in literal quotes — the verbatim flag is reserved for pre-quoted device-name args (`video=\"<name>\"`) only"
    - "Contract-guard test pattern via `spawnMock.mock.calls[0][2]` — reads the options object the third arg to spawn and asserts shape (no verbatim flag, stdio array, shell !== true). Catches regressions that the argv-only assertions miss"
    - "Ponytail discipline: smallest working diff for a known bug — drop the offending key + rewrite the stale comment that claimed the flag mirrored concat.ts (it didn't). No refactor of the spawn layer beyond the offending line"

key-files:
  created: []
  modified:
    - src/main/recorder/trim.ts
    - tests/main/recorder/trim.test.ts

key-decisions:
  - "Match recorder.ts:290 (recording) and recorder.ts:1045 (concat) instead of inventing a new spawn options shape — those two work on this user's machine because they use Node's default Windows quoting. Trim is now an outlier only in the args it passes (no device name), not in the options it uses"
  - "Rewrite the header comment in trim.ts:1-9 to point readers at the recording/concat canonical pattern + cite the G-05-11 regression history — keeps the next reader from re-adding the flag under a fresh misreading of PITFALLS §10"
  - "Add a structural second test (stdio + shell !== true + single-argv input element) in addition to the verbatim-flag absence test — catches both the verbatim-flag regression AND a future accidental `shell: true` that would re-introduce argv-splitting via a different code path"
  - "Use the existing `bootstrap()` + `fakeSpawnSuccess()` helpers for both new tests — no new fixtures, no new mock surface"
  - "Drop the `expect(inputArg).toContain(' ')` assertion from the second test — the tmp dir on this user's machine (`Hussien Essam`) contains a space, but CI runners typically don't. Keeping the test machine-agnostic by asserting only `startsWith('\"') === false` (no caller-side pre-quoting)"

requirements-completed:
  - REV-04

# Coverage metadata — one entry per shipped deliverable
coverage:
  - id: D1
    description: "trim.ts `runFfmpegTrim` spawn options object has ONLY the `stdio` key — `{ stdio: ['pipe', 'ignore', 'pipe'] }`. The `windowsVerbatimArguments: true` key is removed (G-05-11 production fix)"
    requirement: REV-04
    verification:
      - kind: unit
        ref: "tests/main/recorder/trim.test.ts#windowsVerbatimArguments regression guard (G-05-11) > applyTrim spawns ffmpeg WITHOUT windowsVerbatimArguments: true"
        status: pass
      - kind: unit
        ref: "tests/main/recorder/trim.test.ts#windowsVerbatimArguments regression guard (G-05-11) > applyTrim spawn options match the recording spawn shape (recorder.ts:290)"
        status: pass
    human_judgment: false
  - id: D2
    description: "trim.ts header comment (lines 1-19) accurately describes Node's default Windows quoting (matching recorder.ts:290 + recorder.ts:1045), notes the verbatim flag is reserved for the device-name form used by the recording subprocess (NOT for trim's path args), and cites the G-05-11 regression history"
    verification:
      - kind: unit
        ref: "src/main/recorder/trim.ts:1-19 — header comment block"
        status: pass
    human_judgment: false
  - id: D3
    description: "All 10 pre-existing trim tests still pass against the new spawn options — the bug was invisible to the unit suite because spawn was mocked; the new contract-guard tests make the spawn options shape a testable contract"
    requirement: REV-04
    verification:
      - kind: unit
        ref: "tests/main/recorder/trim.test.ts#applyTrim — 7 existing tests (argv shape + COALESCE + D-13 partial gate + recording-status gate + IPC_NOT_FOUND + SIGTERM timeout + 5-min constant)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Full unit suite passes — 499/499 baseline + 2 new contract-guard assertions = 501/501 tests pass across 63 files, no regressions"
    verification:
      - kind: unit
        ref: "npm run test:unit — 501/501 tests across 63 files"
        status: pass
    human_judgment: false
  - id: D5
    description: "End-to-end UX re-run on Windows hardware: Apply trim button produces the trimmed sibling on this user's machine; <video> reloads to the trimmed clip; video_path + video_path_original columns update per the G-05-5 COALESCE guard"
    verification: []
    human_judgment: true
    rationale: "Hardware smoke (capture device + Windows ffmpeg + doctor visual review) — out of scope for unit tests; /gsd-verify-work 5 re-runs UAT after this SUMMARY exists"

# Metrics
duration: 5min
completed: 2026-08-07
---
# Phase 5 Plan 8: Trim Spawn Flag Fix Summary

**G-05-11 closed: removed `windowsVerbatimArguments: true` from the trim subprocess spawn so Node's default Windows command-line construction quotes the userData path with embedded spaces — matching the recording/concat spawn pattern that already works on this user's machine. 2 contract-guard tests lock the spawn options shape against regression.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-08-07T16:48:00Z
- **Completed:** 2026-08-07T16:53:00Z
- **Tasks:** 2 / 2 complete
- **Files modified:** 2 (0 created, 2 modified)
- **Tests:** 501 / 501 pass (499 baseline + 2 new contract-guard assertions, no regressions)

## Accomplishments

- **Production fix (Task 1).** `src/main/recorder/trim.ts:146-148` — the `runFfmpegTrim` spawn options are now exactly `{ stdio: ['pipe', 'ignore', 'pipe'] }`. The `windowsVerbatimArguments: true` key is removed. Node's default Windows command-line construction now wraps the userData path with embedded spaces (`C:\Users\Hussien Essam\...`) in literal quotes; ffmpeg's option parser sees the FULL path as a single argv element. The recording spawn (recorder.ts:290) and concat spawn (recorder.ts:1045) already use this pattern and work on this user's machine — trim now joins them as a third canonical spawn.
- **Stale header comment rewritten (Task 1).** `src/main/recorder/trim.ts:1-19` — the first paragraph no longer claims the flag "mirrors Phase 4 concat.ts" (which it did not — concat.ts/recorder.ts:1045 doesn't use the flag). The new text points readers at the canonical recording + concat spawns, notes that the verbatim flag is reserved for the device-name form `video="<name>"` used by the recording subprocess (NOT for arbitrary path args in trim), and cites the G-05-11 regression history so a future reader won't re-add the flag under a fresh misreading of PITFALLS §10. The second paragraph (fsyncSync recovery + COALESCE guard) is unchanged.
- **Contract-guard tests added (Task 2).** `tests/main/recorder/trim.test.ts` — a new `describe('windowsVerbatimArguments regression guard (G-05-11)')` block with 2 tests locks the spawn options shape:
  1. `applyTrim spawns ffmpeg WITHOUT windowsVerbatimArguments: true` — reads `spawnMock.mock.calls[0][2]` (the options object) and asserts the key is absent. Locks the fix; any future regression re-adding the flag fails at CI.
  2. `applyTrim spawn options match the recording spawn shape (recorder.ts:290)` — asserts `options.stdio === ['pipe', 'ignore', 'pipe']`, `options.shell !== true`, and the input argv element is a SINGLE string (not pre-quoted). Catches both the verbatim-flag regression AND a future accidental `shell: true` that would re-introduce argv-splitting via a different code path.
- **No regressions.** All 10 pre-existing trim tests still pass — they exercise the argv shape (which is unchanged), the status gate, COALESCE, the SIGTERM timeout, the IPC_NOT_FOUND path, and the 5-minute constant. The full unit suite is 501/501 green across 63 files.
- **Ponytail discipline.** Smallest working diff: one key removed from the spawn options, the header comment rewritten to be factually correct, 2 contract-guard tests added. No refactor of the spawn layer beyond the offending line; no unrelated cleanup; no new dependencies.

## Task Commits

Each task was committed atomically per the per-task contract:

1. **Task 1: Remove windowsVerbatimArguments flag + rewrite stale header comment** — `46acfb0` (fix)
2. **Task 2: Contract-guard test: spawn options do NOT include windowsVerbatimArguments** — `bca1ef7` (test)

**Plan metadata:** `docs(05-08): complete plan 08 - trim spawn flag fix (G-05-11)` (next commit)

## Files Created/Modified

- `src/main/recorder/trim.ts` — `runFfmpegTrim` (lines 144-148): the spawn options are now exactly `{ stdio: ['pipe', 'ignore', 'pipe'] }`. The `windowsVerbatimArguments: true` key is removed. Header comment (lines 1-19) rewritten to cite the canonical recording + concat spawn pattern, note the verbatim-flag's actual purpose (device-name form for the recording subprocess), and document the G-05-11 regression history. The rest of the file (status gate, timeout, SIGTERM escalation, stderr capture, exit-code handler, fsync, enriched error message) is unchanged.
- `tests/main/recorder/trim.test.ts` — new `describe('windowsVerbatimArguments regression guard (G-05-11)')` block with 2 tests added after the `'applies the 5-minute timeout constant'` test (line 315) and BEFORE the `relativeVideoPath contract (G-05-5 guard)` describe block. Both tests use the existing `bootstrap()` + `fakeSpawnSuccess()` helpers — no new fixtures, no new mock surface. Existing 10 trim tests are unchanged.

## Decisions Made

- **Match recorder.ts:290 + recorder.ts:1045, not invent a new spawn options shape.** Two existing spawns work on this user's machine; trim joins them as a third canonical spawn with the same options shape. The only thing trim differs on is the args (no `video="<name>"` device-name element) — that's the canonical difference, not a flag toggle.
- **Keep the second test machine-agnostic.** The plan suggested `expect(inputArg).toContain(' ')` to assert the path has a space. This works on the user's machine (`Hussien Essam` has a space in the username) but fails on CI runners (typically `runner`, `Administrator`, `ci-user` — no spaces). Dropped that assertion and kept only `startsWith('"') === false` (no caller-side pre-quoting) — the structural assertion that locks the regression class without depending on the host's tmp-dir shape.
- **Two tests, not one.** The verbatim-flag absence test is the direct regression guard. The structural shape test (stdio + shell !== true + single-argv input element) catches a related bug class (`shell: true` would also re-introduce argv-splitting on Windows via a different code path). Two assertions, two guards — minimum code, maximum coverage.
- **No refactor of the spawn layer beyond the offending line.** The status gate, timeout, SIGTERM escalation, stderr capture, exit-code handler, fsync, and enriched error message are all unchanged — they're correct. Ponytail ladder rung 1 (smallest working diff) wins.

## Deviations from Plan

### Documented Plan Adjustments

**1. Dropped `expect(inputArg).toContain(' ')` from the second contract-guard test.**

The plan's `<action>` block specified `expect(inputArg).toContain(' ')` as part of the structural assertion. The intent was to assert the userData path has a space (the failure-mode pre-`windowsVerbatimArguments: true`). However, the unit test's tmp dir comes from `mkdtempSync(path.join(tmpdir(), 'colonosco-trim-'))` (line 43 of trim.test.ts). On this user's machine the tmp dir contains a space (`C:\Users\Hussien Essam\AppData\Local\Temp\colonosco-trim-XXXXXX`); on a CI runner it typically doesn't. Adding `toContain(' ')` would make the test fail on any CI environment whose tmp dir lacks spaces — a machine-coupling that the test's purpose does not actually require. The structural assertion that the path is a single argv element (not pre-quoted) is what locks the G-05-11 failure mode; the `toContain(' ')` assertion is decorative. Kept `expect(inputArg).toBeTypeOf('string')` + `expect(inputArg?.startsWith('"')).toBe(false)` — both are machine-agnostic and both lock the regression class.

This deviation is consistent with the plan's threat model (T-05-60 mitigation: the contract-guard test must lock the spawn options shape so a future refactor fails at CI time). The structural assertion locks the same regression class without coupling the test to a specific machine topology.

## Issues Encountered

None. All 501 tests pass on first run after Task 2. No pre-commit hook failures. No type errors on `npm run typecheck:node`. No Windows-ffmpeg runs attempted (the fix is gated by hardware smoke; /gsd-verify-work 5 re-runs UAT after this SUMMARY exists).

## Verification Summary

- `npm run typecheck:node` — PASS (no errors)
- `npm run test:unit -- --run tests/main/recorder/trim.test.ts` — PASS (12/12 tests on the gap-relevant file: 10 baseline + 2 new contract-guard assertions)
- `npm run test:unit` (full suite) — PASS (501/501 tests across 63 files; 499 baseline + 2 new assertions; no regressions)

Acceptance criteria (per plan frontmatter):

**Task 1 acceptance:**
- [x] `src/main/recorder/trim.ts` `runFfmpegTrim` (lines 144-148) spawn options object has ONLY the `stdio` key. The `windowsVerbatimArguments: true` key is removed.
- [x] The header comment (lines 1-19) accurately describes: (a) Node's default Windows quoting is used (matching recorder.ts:290 + recorder.ts:1045), (b) the verbatim flag is reserved for the device-name form used by the recording subprocess, NOT for trim's path args, (c) G-05-11 fixed a regression where the flag was incorrectly set on trim.
- [x] No other code in trim.ts changes. The status gate, timeout, SIGTERM escalation, stderr capture, exit-code handler, fsync, and enriched error message all stay as-is.
- [x] No new dependencies added.

**Task 2 acceptance:**
- [x] New `describe('windowsVerbatimArguments regression guard (G-05-11)')` block added to tests/main/recorder/trim.test.ts with 2 tests:
  - [x] (a) `applyTrim spawns ffmpeg WITHOUT windowsVerbatimArguments: true` — asserts `options` does NOT have the `windowsVerbatimArguments` key.
  - [x] (b) `applyTrim spawn options match the recording spawn shape (recorder.ts:290)` — asserts `options.stdio === ['pipe', 'ignore', 'pipe']`, `options.shell !== true`, and the input argv element is a SINGLE string (not pre-quoted).
- [x] The 2 new tests use the existing `bootstrap()` + `fakeSpawnSuccess()` helpers (no new fixtures).
- [x] All 10 pre-existing trim tests still pass against the new spawn options.
- [x] The G-05-11 guard test would have caught the bug at the time of introduction (a regression test that asserts the canonical options shape).
- [x] All 499 pre-existing unit tests still pass.
- [x] No new dependencies added.

## Next Phase Readiness

- **G-05-11 closed.** UAT step 5 (Trim 5s-25s) is now re-runnable end-to-end on this user's machine. After this SUMMARY exists, the doctor can re-test: Record 30s → Stop → Procedure Review → Trim → drag in-handle 5s, out-handle 25s → Apply → see the trimmed sibling mp4 → click Play → see the 20s trimmed segment.
- **UAT steps 6 + 7 unblocked.** Both steps were cascade-blocked on Test 5; once G-05-11 is resolved they become re-runnable: step 6 verifies the trimmed mp4 plays; step 7 verifies Restore re-points to the original.
- **Plan 05-09 (G-05-12) unaffected.** The trim visual timeline work (in-frame + out-frame JPEG previews, tick scale, screenshot-position dot markers) is independent of the spawn flag. After Plan 09 ships, the doctor gets both a working trim AND a visual confirmation of what they're trimming.
- **Phase 5 status.** All 4 original plans (05-01..05-04) + 4 gap-closure plans (05-05/06/07/08) shipped end-to-end. 501/501 tests pass. `/gsd-verify-work 5` should re-run the full UAT to close out the gap list (G-05-3 + G-05-5 + G-05-8 + G-05-9 + G-05-10 + G-05-11 resolved; G-05-12 still open as separate gap-closure plan 05-09).
- **Phase 6 readiness.** Doctor Profile + Report Editor + PDF Generation can begin planning. The trim spawn contract is now locked at the unit-test layer — no future refactor of `runFfmpegTrim` can regress to the verbatim-flag failure mode without failing CI.

## User Setup Required

None - no external service configuration required.

## Self-Check

**Status: PASSED**

- **SUMMARY.md exists:** `.planning/phases/05-screenshots-procedure-review-trim/05-08-SUMMARY.md` (this file)
- **Per-task commits exist:**
  - `46acfb0` — fix(05-08): drop windowsVerbatimArguments from trim spawn (G-05-11)
  - `bca1ef7` — test(05-08): contract-guard for spawn options shape (G-05-11)
- **Modified files all exist and contain the expected changes:**
  - `src/main/recorder/trim.ts` — `windowsVerbatimArguments: true` line removed from spawn options (lines 146-148 now contain only `stdio: ['pipe', 'ignore', 'pipe']`). Header comment (lines 1-19) rewritten to cite the canonical recording + concat spawn pattern + note the verbatim flag's actual purpose + cite the G-05-11 regression history.
  - `tests/main/recorder/trim.test.ts` — new `describe('windowsVerbatimArguments regression guard (G-05-11)')` block with 2 tests added between the `'applies the 5-minute timeout constant'` test (line 315) and the `relativeVideoPath contract (G-05-5 guard)` describe block. Both tests use the existing `bootstrap()` + `fakeSpawnSuccess()` helpers.
- **Final test run:** PASS — `npm run test:unit` reports 501/501 tests pass across 63 files (499 baseline + 2 new contract-guard assertions; no regressions).
- **Typecheck:** PASS — `npm run typecheck:node` completes without errors.

---

*Phase: 05-screenshots-procedure-review-trim*
*Plan: 08 (gap-closure round 3)*
*Completed: 2026-08-07*
*Gap closed: G-05-11 (trim "Permission denied" on userData paths containing a space — verbatim flag was incorrectly truncating the argv at the first space)*