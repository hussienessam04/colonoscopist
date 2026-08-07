---
phase: 05-screenshots-procedure-review-trim
plan: 06
subsystem: recording
tags: [path-shape, contract, recorder, trim, restore, regression-test]
gap_closure: true
gap_ids:
  - G-05-5
status: complete

# Dependency graph
requires:
  - phase: 05-screenshots-procedure-review-trim
    provides: "Phase 5 plan 03 (applyTrim + restoreFromOriginal IPC + videoFilePath resolver + trim subprocess)"
  - phase: 04-recording
    provides: "Recorder supervisor that writes procedures.video_path on insert/finalize"
provides:
  - "Filename-only contract for procedures.video_path: recorder writers store just the filename (e.g. 'video.mp4'); resolver joins the procedure directory at read time"
  - "Contract-guard test that locks the recorder's relativeVideoPath return shape"
  - "End-to-end trim + restore round-trip test exercising the production column shape"
  - "Enriched source-missing diagnostic that lists resolved stat path + procedure status + files in procedure dir"
affects:
  - "Phase 5 plan 03 (applyTrim IPC was latent-broken; now end-to-end functional)"
  - "Phase 5 plan 04 (Range request support was shipping on a row that was fundamentally unreadable)"
  - "Phase 6 (Report editor will read procedures.video_path via the same resolver; same contract now stable)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Contract documentation via JSDoc on the resolver + on the writer (cites D-07 + G-05-5)"
    - "Test-only export for a module-private function (named __relativeVideoPathForTest) to assert contract without standing up ffmpeg/preview-server pipeline"
    - "Enriched error messages that surface resolved stat path + raw stored value + directory listing for fast debugging"

key-files:
  created: []
  modified:
    - src/main/recorder/recorder.ts
    - src/main/recorder/trim.ts
    - src/main/paths.ts
    - src/main/db/procedures-repo.ts
    - tests/main/recorder/trim.test.ts

key-decisions:
  - "Fix at the writer (recorder.relativeVideoPath), not at the resolver — keeps the contract surface explicit and avoids a defensive resolver that masks contract drift"
  - "Expose relativeVideoPath via __relativeVideoPathForTest rather than stand up the full Recorder.start() pipeline for the contract-guard test — minimum code for maximum assertion strength"
  - "Enriched error message keeps the raw stored value separate from the resolved stat path so future debugging can see both halves of the contract-drift symptom"

patterns-established:
  - "Recorder writers + resolver agree on the filename-only shape via JSDoc on both sides + a regression test that asserts the writer's output shape"
  - "Test bootstrap uses filename-shaped fixtures (video.mp4) end-to-end — matches production shape from the day the contract is locked"

requirements-completed:
  - REV-04

# Coverage metadata — one entry per shipped deliverable
coverage:
  - id: D1
    description: "Recorder writes filename-only procedures.video_path (no userData-relative prefix)"
    requirement: REV-04
    verification:
      - kind: unit
        ref: "tests/main/recorder/trim.test.ts#relativeVideoPath contract (G-05-5 guard) > returns just the filename \"video.mp4\" regardless of patientId/procedureId (regression test)"
        status: pass
      - kind: unit
        ref: "tests/main/recorder/trim.test.ts#relativeVideoPath contract (G-05-5 guard) > end-to-end: trim + restore round-trip on the production column shape (G-05-5)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Trim source-missing error surfaces resolved stat path + procedure status + raw stored value + directory listing"
    requirement: REV-04
    verification:
      - kind: unit
        ref: "tests/main/recorder/trim.test.ts#relativeVideoPath contract (G-05-5 guard) > source-missing error surfaces resolved path + procedure status + files in procedure dir (G-05-5 diagnostics)"
        status: pass
    human_judgment: false
  - id: D3
    description: "videoFilePath + restoreFromOriginal JSDoc explicitly document the filename-only contract (so future readers/writers cannot drift)"
    verification:
      - kind: unit
        ref: "tests/main/recorder/trim.test.ts#relativeVideoPath contract (G-05-5 guard) > end-to-end: trim + restore round-trip on the production column shape (G-05-5)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Windows hardware smoke re-run of UAT steps 5-7 (Trim 5s-25s, Verify trimmed, Restore)"
    verification: []
    human_judgment: true
    rationale: "Hardware smoke requires a connected capture device + 30s recording + real Windows ffmpeg + a doctor inspecting the resulting mp4 — out of scope for unit tests; /gsd-verify-work 5 re-runs UAT after this SUMMARY exists"

# Metrics
duration: 7min
completed: 2026-08-07
---

# Phase 5 Plan 6: Trim Path-Shape Fix Summary

**G-05-5 closed: procedures.video_path is now filename-only end-to-end, with a contract-guard regression test that locks the recorder's writer + the resolver's reader on the same shape.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-08-07T15:40:14Z
- **Completed:** 2026-08-07T15:51:00Z
- **Tasks:** 2 / 2 complete
- **Files modified:** 5 (recorder.ts, trim.ts, paths.ts, procedures-repo.ts, trim.test.ts)
- **Tests:** 491 / 491 pass (488 baseline + 3 new contract-guard tests, no regressions)

## Accomplishments

- **Path-shape contract drift closed.** `recorder.relativeVideoPath(patientId, procedureId)` now returns just `'video.mp4'` instead of `data/media/patients/<id>/<id>/video.mp4`. All five recorder call sites (insert at line 248, finalize at lines 893 / 1012 / 1127, partial-finalize at line 353 via `currentSegmentRelPath.partial.mp4` which was already filename-shaped) auto-pick up the new shape because they read `this.outputRelPath`.
- **Trim IPC end-to-end functional.** The resolver `paths.ts::videoFilePath` was already correct for the filename shape — it expected `videoRel` to be a filename within the procedure directory. Now that the writer stores just the filename, `existsSync(inputAbs)` passes and ffmpeg spawns against the canonical mp4.
- **`restoreFromOriginal` round-trips.** The second latent failure point of the same root cause (proceduresRepo.restoreFromOriginal used the same `videoFilePath(row.patient_id, id, row.video_path_original)` call) now succeeds: the resolver call was always correct, only the column shape was wrong. Once the shape is fixed, restore is clean.
- **Diagnostic improvement on the error path.** When the source is missing, the IpcErrorException now surfaces: the procedure id, the procedure status, the resolved absolute stat path, the raw stored value, AND a list of files actually present in the procedure directory. The prior toast printed only the raw stored value, which matched the DB but didn't reflect the doubled stat path the resolver produced when the contract drifted — confusing the doctor. Future debugging sees the doubled-path symptom immediately.
- **Contract documentation on both sides.** `paths.ts::videoFilePath` JSDoc and `proceduresRepo.restoreFromOriginal` JSDoc both cite the filename-only contract (D-07 + G-05-5). Any future drift on either side is visibly out-of-line with the documented invariant.
- **Regression test that locks the bug class.** A new `describe('relativeVideoPath contract (G-05-5 guard)')` in `tests/main/recorder/trim.test.ts` adds three tests:
  1. **Direct shape assertion**: `relativeVideoPath('p1', 'proc1') === 'video.mp4'` regardless of args; no path separators; doesn't contain `data`/`patients`/`media`. This would have caught G-05-5 at the unit-test layer had it existed.
  2. **End-to-end trim + restore round-trip**: bootstrap a completed row, run `applyTrim`, call `proceduresRepo.updateVideoPath`, call `proceduresRepo.restoreFromOriginal`. Asserts the row's `videoPath` cycles through `'video.mp4'` → `'video-trimmed.mp4'` → `'video.mp4'` with `videoPathOriginal` locked at `'video.mp4'` (first-trim COALESCE guard).
  3. **Enriched error diagnostic**: bootstrap + unlink source + `applyTrim` → assert the IPC_NOT_FOUND message carries the procedure id, `status=completed`, `Column holds video.mp4`, and `Files in procedure dir:`.

## Task Commits

Each task was committed atomically per the per-task contract:

1. **Task 1: Recorder path-shape contract fix + writer audit + trim error-path enrichment + contract docs** — `3faccd6` (fix)
2. **Task 2: Contract-guard test + end-to-end trim/restore round-trip** — `dffcfa1` (test)

**Plan metadata:** pending docs commit (`docs(05-06): complete plan 06 - trim path-shape fix (G-05-5)`)

## Files Created/Modified

- `src/main/recorder/recorder.ts` — `relativeVideoPath` body changed from template-literal full path to the literal `'video.mp4'`; args retained as `_patientId`/`_procedureId` (unused, marked `void`); added `__relativeVideoPathForTest` export with JSDoc noting "exposed for the contract-guard test in tests/main/recorder/trim.test.ts (G-05-5 regression)".
- `src/main/recorder/trim.ts` — added `readdirSync` import; enriched the source-missing error message with procedure id, status, resolved stat path, raw stored column value, and the procedure directory listing (graceful fallback if `readdirSync` throws).
- `src/main/paths.ts` — `videoFilePath` JSDoc rewritten to explicitly document the filename-only contract (cites D-07 + G-05-5 + the recorder's `relativeVideoPath`). Implementation unchanged — the fix is on the writer side.
- `src/main/db/procedures-repo.ts` — `restoreFromOriginal` JSDoc note added citing the contract; resolver call is correct as-is once the column shape is fixed.
- `tests/main/recorder/trim.test.ts` — added `describe('relativeVideoPath contract (G-05-5 guard)')` with three tests (direct shape assertion + end-to-end round-trip + enriched-error assertion). Existing 7 trim tests unchanged.

## Writers/Readers Audit of `procedures.video_path`

Audited every reader/writer of the `procedures.video_path` column end-to-end (per Rule 2 + the plan's explicit audit requirement). Findings:

**Writers (writers that were broken by the column shape drift):**

| Site | File:line | What it writes | Status |
|------|-----------|----------------|--------|
| Recorder INSERT | `recorder.ts:248` | `videoPath: this.outputRelPath` | Auto-fixed (now `'video.mp4'`) |
| Recorder partial-finalize | `recorder.ts:353` | `videoPath: partialVideoRelPath` (`${segment}.partial.mp4` or `outputRelPath`) | Already filename-shaped |
| Recorder onExit finalize | `recorder.ts:893` | `videoPath: this.outputRelPath` | Auto-fixed |
| Recorder concat-failed finalize | `recorder.ts:1012` | `videoPath: ctx.outputRelPath` | Auto-fixed |
| Recorder stop() finalize | `recorder.ts:1127` | `videoPath: this.outputRelPath` | Auto-fixed |
| Trim IPC → updateVideoPath | `procedures-repo.ts:114` | `videoPath: trimmedRel` (via `path.relative(path.dirname(inputAbs), outputAbs)`) | Already filename-shaped (`video-trimmed.mp4`) |
| Repo insert | `procedures-repo.ts:220` | passes through whatever the caller passes | Writers above are now filename-shaped |
| Repo updateFinalized | `procedures-repo.ts:254` | passes through whatever the caller passes | Writers above are now filename-shaped |

**Readers (all already expected the filename-only shape; nothing to fix):**

| Site | File:line | What it reads | Status |
|------|-----------|---------------|--------|
| Resolver | `paths.ts:47-52` (`videoFilePath`) | `videoRel: string` joined with procedure dir | Already expected filename-only; JSDoc now documents the contract |
| Trim IPC | `trim.ts:75` | `procedure.videoPath` via `videoFilePath` | Now passes `existsSync` (source is reachable) |
| Trim error toast | `trim.ts:80` (now 76-83) | `procedure.videoPath` raw + `inputAbs` resolved + dir listing | Enriched |
| Restore IPC | `procedures-repo.ts:293` | `row.video_path_original` via `videoFilePath` | Now passes `existsSync` |
| Repo row → Procedure | `procedures-repo.ts:180` | `row.video_path` | Just maps the column; reader contract unchanged |

**Test fixtures using the OLD shape (no impact — these tests don't exercise the trim/restore path):**

- `tests/main/ipc/screenshots.test.ts:74` — fixture for screenshot tests; no `videoFilePath` call
- `tests/main/ipc/procedures.test.ts:134, 161, 199` — fixtures for insert/get/finalize/list; no `videoFilePath` call
- `tests/main/recorder/segments.test.ts:64` — fixture for segments repo; no `videoFilePath` call
- `tests/main/db/screenshots-repo.test.ts:59` — fixture for screenshots repo; no `videoFilePath` call
- `tests/main/db/migrations/0003_screenshots_and_trim.test.ts:66` — fixture for migration test; no `videoFilePath` call

These were intentionally NOT touched. The plan explicitly says "no fixture change needed" because they don't pass through the resolver. Touching them would be churn with no test-coverage benefit.

## Decisions Made

- **Fix the writer, not the resolver.** The resolver `videoFilePath(patientId, procedureId, videoRel)` always expected `videoRel` to be a filename; the recorder was the one writing a userData-relative path. Adding defensive prefix-stripping to the resolver (Option A in the debug doc) would mask future contract drift. Changing the writer (Option B) keeps the contract surface explicit: writer stores filename, resolver joins procedure dir, both sides documented in JSDoc.
- **Export the writer for testability.** The plan suggested either exporting `relativeVideoPath` OR standing up the full `Recorder.start()` pipeline with stubs. Exposing `__relativeVideoPathForTest` is the minimum change that gives the test direct access to the contract without fakes for child/procFs/preview-server. The export is named with a `__` prefix + "ForTest" suffix to make its test-only intent obvious in code review.
- **Args retained as `_patientId`/`_procedureId` with `void` statements.** The function signature stays the same (both args kept) so existing call sites don't need to change. Ponytail discipline: the args carry API-symmetry intent (a future per-procedure filename shape is conceivable) but are unused for the current single-shape case.
- **Diagnostic message keeps the raw stored value separate from the resolved stat path.** Both are useful for debugging — the raw value matches the DB (so a SQL query can corroborate) and the resolved path shows the actual `existsSync` target (where the doubling would manifest). A single concatenated string with both fields is what the doctor needs in the toast.
- **No new dependencies added.** Stdlib `readdirSync` is sufficient for the directory listing in the error path.

## Deviations from Plan

### Auto-fixed Issues

None. Plan executed exactly as written.

### Documented Plan Adjustments

**1. Test approach — direct function export vs full Recorder bootstrap**

The plan suggested two options for the contract-guard test:

- (a) Bootstrap a procedure via the recorder's path-shaped write path (`new Recorder(deps).start({...})` then read `proceduresRepo.get(...).videoPath`)
- (b) Expose the writer function (or read its `outputRelPath` field) and assert the shape directly

I chose option (b) — exporting `__relativeVideoPathForTest` — because it requires zero test boilerplate (no fake child, no fake procFs, no fake preview server) and gives a stronger, more focused assertion. The plan acknowledged both options as acceptable. The end-to-end round-trip test (option a's spirit) is also added in a separate test, so both code paths are covered.

**2. Removed `expect(existsSync(trimmedAbs)).toBe(true)` from the end-to-end test**

The original draft asserted that the trimmed sibling file exists on disk. This failed under the test's stubbed ffmpeg (the stub exits 0 but doesn't actually write the file — real-ffmpeg writing is exercised by `tests/integration/trim-smoke.test.ts` which requires `RUN_SMOKE=1`). Adjusted to assert on the rel-path shape only (which IS what the contract-drift bug was about) and added a comment pointing at the integration smoke test for the on-disk presence.

## Issues Encountered

None. All 491 tests pass on first run after Task 2's adjustment. No pre-commit hook failures. No type errors on `npm run typecheck:node` or `npm run typecheck:web`.

## Verification Summary

- `npm run typecheck:node` — PASS (no errors)
- `npm run typecheck:web` — PASS (no errors)
- `npm run test:unit -- --run tests/main/recorder/trim.test.ts` — PASS (10/10 tests: 7 original + 3 new)
- `npm run test:unit` (full suite) — PASS (491/491 tests across 62 files, no regressions)
- `npm run test:unit -- --run tests/main/recorder/trim.test.ts tests/main/db/procedures-repo.test.ts tests/main/ipc/procedures.test.ts` — PASS (20/20 tests on the gap-relevant files)

Acceptance criteria (per plan frontmatter):

- [x] `src/main/recorder/recorder.ts` `relativeVideoPath(patientId, procedureId)` returns just `'video.mp4'`.
- [x] All recorder INSERT/UPDATE sites (lines 248, 353, 893, 1012, 1127) write the new filename-only shape via `this.outputRelPath`.
- [x] `src/main/recorder/trim.ts` source-missing error message includes the procedure id, status, resolved stat path, raw stored column value, AND a list of files in the procedure dir.
- [x] `src/main/paths.ts` `videoFilePath` JSDoc explicitly documents the filename-only contract.
- [x] `src/main/db/procedures-repo.ts` `restoreFromOriginal` JSDoc cites the contract.
- [x] No new dependencies added.
- [x] 3 new contract-guard tests added (direct shape + end-to-end round-trip + enriched-error diagnostic).
- [x] All 491 pre-existing + new unit tests still pass.

## Next Phase Readiness

- **G-05-5 closed.** UAT steps 5-7 (Trim 5s-25s, Verify trimmed mp4 plays, Restore original) are re-runnable on a Windows workstation with a connected capture device. The renderer's Apply button is now expected to run ffmpeg against the canonical mp4 path, write a trimmed sibling file, update the procedure row, and reload the `<video>`.
- **Phase 5 status.** All 4 original plans (05-01..05-04) + 2 gap-closure plans (05-05 + 05-06) shipped end-to-end. 491 tests pass. `/gsd-verify-work 5` should re-run the full UAT to close out the gap list (G-05-3 + G-05-5 both reported in the UAT.md Gaps section).
- **Phase 6 readiness.** Doctor Profile + Report Editor + PDF Generation can begin planning. Procedures.video_path is now a stable contract — Report editor's "open procedure review" path will resolve `video_path` through the same `videoFilePath` resolver without surprises.

## User Setup Required

None - no external service configuration required.

---

*Phase: 05-screenshots-procedure-review-trim*
*Plan: 06 (gap-closure)*
*Completed: 2026-08-07*
*Gap closed: G-05-5 (path-shape contract drift between recorder writer and trim resolver)*