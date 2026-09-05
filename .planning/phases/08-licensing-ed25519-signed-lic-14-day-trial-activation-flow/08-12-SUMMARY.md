---
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
plan: 12
subsystem: license
tags: [fix, renderer-handling, gated-ipc, gap-closure, hook-level]

# Dependency graph
requires:
  - phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
    plan: 11
    provides: "page-level safeInvoke coverage on SettingsCapture + ProcedureRoom"
  - phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
    plan: 10
    provides: "safeInvoke helper (src/renderer/src/lib/ipc-result.ts)"
provides:
  - "useCaptureDeviceMap-safeInvoke-coverage — hook-level gate rejection handled, no crash on expired/unactivated state"
affects:
  - "08-UAT (Test 8 still-crashing-after-08-11 closure)"
  - "All downstream consumers of useCaptureDeviceMap (SettingsCapture, ProcedureRoom)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "safeInvoke wrapper on every gated capture.* IPC call (hook + page level)"
    - "Null result -> setDshow([]) + setError(license-aware message) -> downstream renders empty state gracefully"

key-files:
  created: []
  modified:
    - src/renderer/src/hooks/useCaptureDeviceMap.ts
    - tests/renderer/hooks/use-capture-device-map.test.ts

key-decisions:
  - "Serial safeInvoke(...)().then(-> enumerateDevices()) instead of Promise.all — required to gate the null check before enumerateDevices runs (negligible perf cost)"
  - "On null path, skip enumerateDevices entirely — browser list stays at initial []; consumers already render EmptyStateCard when the gate rejects, so the empty browser list is consistent with the gated UI"

gap_closure: true
gap_ids: [G-08-6]

requirements-completed: [LIC-04]

coverage:
  - id: D1
    description: "useCaptureDeviceMap hook wraps window.api.capture.listDevices() with safeInvoke; on null (gate rejection) sets dshow=[] and error to license-aware message"
    requirement: LIC-04
    verification:
      - kind: unit
        ref: "tests/renderer/hooks/use-capture-device-map.test.ts#G-08-6: gate-rejected capture.listDevices yields empty dshow + license error (no crash)"
        status: pass
    human_judgment: false
  - id: D2
    description: "SettingsCapture + ProcedureRoom no longer crash on expired/unactivated state (downstream consumers receive an empty array, not the gate object)"
    requirement: LIC-04
    verification:
      - kind: automated_ui
        ref: "tests/renderer/pages/settings-capture.test.tsx#G-08-5: hydration gate rejection renders <EmptyStateCard> (no crash)"
        status: pass
      - kind: automated_ui
        ref: "tests/renderer/pages/procedure-room.test.tsx (5 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Existing success-path behavior preserved: when license is valid, capture devices populate dshow + browser lists as before"
    requirement: LIC-04
    verification:
      - kind: unit
        ref: "tests/renderer/hooks/use-capture-device-map.test.ts#enumerates BOTH the dshow IPC list and the browser mediaDevices list on mount"
        status: pass
      - kind: unit
        ref: "tests/renderer/hooks/use-capture-device-map.test.ts#builds a label-based bridge so lookup() returns the canonical name"
        status: pass
    human_judgment: false

# Metrics
duration: ~5min
completed: 2026-09-05
status: complete
---

# Phase 8 Plan 12 Summary

**useCaptureDeviceMap hook wraps capture.listDevices() with safeInvoke; gate rejection on expired/unactivated state now yields an empty device list + license error (no white-screen crash) — closes G-08-6.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-09-05T17:44:39Z
- **Completed:** 2026-09-05T17:48:30Z
- **Tasks:** 1 (single task split into 2 commits + SUMMARY commit)
- **Files modified:** 2 (1 source + 1 test)

## Accomplishments

- Hook-level gate-rejection handling completes the safeInvoke coverage for the entire `capture.*` IPC surface (page-level was already done in Plan 08-11)
- New regression test guards the G-08-6 fix — `{ok:false}` from listDevices yields `dshow=[]` + `/license required/i` error, downstream `dshow.find()` no longer crashes
- All 6 hook tests + 10 SettingsCapture tests + 5 ProcedureRoom tests green

## Task Commits

1. **`fix(08-12)` wrap useCaptureDeviceMap with safeInvoke** — `036c58e`
   - Import safeInvoke from `@/lib/ipc-result`
   - Serial `safeInvoke(listDevices).then(-> enumerateDevices())` replaces `Promise.all([...])`
   - Null result branch: `setDshow([]) + setError('License required — activate to list capture devices.')`
2. **`test(08-12)` regression test for gate-rejection path** — `774bb8f`
   - New `G-08-6` test: listDevices returns `{ok:false, code:'IPC_LICENSE_EXPIRED'}` → dshow empty, error matches `/license required/i`, no crash
   - Updated existing throw test to assert the new safeInvoke-absorbed contract (`error` matches `/license required/i`, not the raw rejection message)

## Files Created/Modified

- `src/renderer/src/hooks/useCaptureDeviceMap.ts` — `Promise.all([...])` → `safeInvoke(...)().then(...)` with a null-check branch; the `.catch` block (kept per plan) is unreachable for throws because safeInvoke absorbs them — this matches the G-08-4 / G-08-5 convention
- `tests/renderer/hooks/use-capture-device-map.test.ts` — added G-08-6 regression test + updated throw-path test contract

## Decisions Made

- **Serial over Promise.all:** the plan noted the prior parallel `Promise.all` was sacrificed to make the safeInvoke null check reachable. Performance impact is negligible (sub-ms IPC + browser-API calls).
- **Skip enumerateDevices on the null path:** browser list stays at initial `[]`. Consumers (SettingsCapture / ProcedureRoom) render EmptyStateCard when the gate rejects, so an empty browser list is consistent with the gated UI. Avoids wasted work and keeps the failure path minimal.
- **Throw path absorbs into null:** safeInvoke's internal `try/catch` returns `null` for any thrown error. The hook's outer `.catch` block (kept per the plan's literal code) is dead code for IPC throws — same convention as every other gated capture.* consumer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test contract] Updated existing throw-path test to match safeInvoke-absorbed contract**
- **Found during:** Test verification after commit 1
- **Issue:** The pre-existing `surfaces an error message when the IPC call rejects` test asserted `error === 'boom'`. After wrapping in safeInvoke, throws are absorbed to `null` and routed through the same license-aware message as gate rejection. The `.catch` block in the plan's code is unreachable for IPC throws.
- **Fix:** Updated the assertion to `error` matches `/license required/i`, with a comment explaining the contract shift. The "surface an error" intent is preserved; only the specific message changes.
- **Files modified:** `tests/renderer/hooks/use-capture-device-map.test.ts`
- **Verification:** All 21 tests across 3 files pass.
- **Committed in:** `774bb8f` (part of test commit)

**2. [Rule 1 - Over-assertion] Removed `lookup` assertion from G-08-6 test**
- **Found during:** Test verification after commit 1
- **Issue:** My initial G-08-6 test asserted `lookup('browser-easycap')` returned `'EasyCap USB Video'`. The plan's null path intentionally skips `enumerateDevices()`, so the browser list stays empty and lookup returns undefined.
- **Fix:** Replaced with `expect(result.current.browser).toEqual([])` + `expect(result.current.lookup('browser-easycap')).toBeUndefined()` — both verify the no-crash contract without contradicting the plan's implementation.
- **Files modified:** `tests/renderer/hooks/use-capture-device-map.test.ts`
- **Verification:** G-08-6 test passes.
- **Committed in:** `774bb8f` (part of test commit)

---

**Total deviations:** 2 auto-fixed (both test-contract adjustments, no source-code deviation)
**Impact on plan:** Source code follows the plan verbatim. Test file was adjusted to match the actual contract of safeInvoke (which absorbs throws) and the plan's intentional enumerateDevices skip on the null path. No scope creep.

## Issues Encountered

- Pre-existing typecheck errors in `src/renderer/src/hooks/useReport.ts` and `src/renderer/src/pages/ReportEditor.tsx` (untracked files from a different quick task) — unrelated to Plan 08-12. Not fixed (out of scope per deviation rule).
- CRLF/LF line-ending warnings from git on both modified files — benign on Windows; not fixed.

## Verification Results

| Check | Result |
|-------|--------|
| `npm run typecheck:web` (filtered to useCaptureDeviceMap scope) | No new errors in useCaptureDeviceMap.ts (pre-existing errors in unrelated untracked files: useReport.ts, ReportEditor.tsx) |
| `node scripts/run-vitest.cjs --run tests/renderer/hooks/use-capture-device-map.test.ts` | 6/6 pass |
| `node scripts/run-vitest.cjs --run tests/renderer/pages/settings-capture.test.tsx` | 10/10 pass |
| `node scripts/run-vitest.cjs --run tests/renderer/pages/procedure-room.test.tsx` | 5/5 pass |
| **Total** | **21/21 pass** |

Manual re-verification (Test 8 from 08-UAT): with license state `expired`, navigating to Settings → Capture now renders `<EmptyStateCard />` instead of white-screening — the `gated-empty-state` testid surfaces, and `dshow` stays `[]` so `dshow.find()` in the namesByBrowserId useMemo never receives the gate object.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- G-08-6 closed. Phase 8 UAT can proceed.
- All capture.* IPC consumers (pages + hook) now use safeInvoke uniformly; no remaining crash vectors identified for the license-gate path.

---
*Phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow*
*Completed: 2026-09-05*
