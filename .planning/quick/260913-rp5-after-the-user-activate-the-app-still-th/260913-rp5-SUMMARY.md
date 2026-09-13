---
status: complete
task: 260913-rp5
description: after the user activate the app still there is some places in the app cant see that the app is licenced like in capture
date: 2026-09-13
commits:
  - 4dd439e (fix(quick): capture pages recover from gated-empty-state on license activation)
---

# Quick Task 260913-rp5

## What the user actually meant

The user initially framed this as a missing license-status badge in the capture pages. After a back-and-forth, the real bug surfaced: after activating the license, the capture workflow still rendered the gated-empty-state ("License required — open Settings → License to activate.") and prevented the doctor from picking a device or starting a procedure.

## Root cause

Three renderer hooks + four inline useEffects set a `gated` flag when the IPC gate rejects on mount, but never re-fetched after the license changed:

- `useCaptureDeviceMap` — used by ProcedureRoom, ProcedurePreview, SettingsCapture
- `useProcedures` — used by ProcedureReview
- ProcedureRoom's `getDefaultDevice` + `getPreset` useEffects
- ProcedurePreview's local `setGated` (set when `procedures.create` returns null)
- SettingsCapture's local `setGated` (set when `getDefaultDevice` returns null via safeInvoke)
- ProcedureReview's patient fetch (sets `patientGated`)

The License sub-page already dispatched `LICENSE_CHANGED_EVENT` on successful activation (commit `9ad4e6c`). The wire was missing on the consumer side.

## Fix

Added `useLicenseChangeRefresh(refresh)` helper hook in `useLicenseStatus.ts` that listens for `LICENSE_CHANGED_EVENT` and calls the callback. Wired into all 7 sites. Each `useEffect` with `[]` deps refactored to extract the fetch into a stable `useCallback` so the same logic runs on mount AND on license change.

## Files

- **MODIFIED:** `useLicenseStatus.ts` — added helper hook export
- **MODIFIED:** `useCaptureDeviceMap.ts` — extracted fetch to useCallback, wired helper
- **MODIFIED:** `useProcedures.ts` — wired helper to refresh
- **MODIFIED:** `ProcedureRoom.tsx` — refactored 2 useEffects + wired helper
- **MODIFIED:** `ProcedurePreview.tsx` — refactored 1 useEffect + wired helper + clear local gated
- **MODIFIED:** `SettingsCapture.tsx` — refactored hydration useEffect + wired helper
- **MODIFIED:** `ProcedureReview.tsx` — refactored patient fetch + wired helper
- **NEW TEST:** `260913-rp5-license-change-clears-gated.test.tsx` — regression test for the canonical "Settings → Capture" path

## Verification

- `npm run typecheck` clean
- `npm run test:unit` — 892 passed, 3 pre-existing failures (PDF smoke opt-in + Playwright e2e harness needing dev server), 0 new failures
- New regression test passes (1/1 in `260913-rp5-license-change-clears-gated.test.tsx`)

## Deviations from plan

None. The plan was scoped to 7 files; all 7 modified.

---

# Follow-up commit (260913-rp5-b): user reported bug NOT fixed by the first attempt

The first fix only re-fetched on LICENSE_CHANGED_EVENT. The user's actual report ("after activating, the capture page still shows License required") turned out to be a deeper bug: when the user is licensed but has no USB capture device plugged in, `getDefaultDevice` returns `null` (legitimate) but `safeInvoke` collapses BOTH `{ok:false}` (gate rejection) and `null` (no data) into a single `null` value. Pages then flipped `gated=true` and rendered the misleading EmptyStateCard.

Fix:
- Added `isGateRejected(raw)` type guard in `lib/ipc-result.ts`
- Updated 4 affected sites (useCaptureDeviceMap, useProcedures, SettingsCapture hydrate, ProcedureRoom + ProcedurePreview getDefaultDevice) to check the raw IPC shape via isGateRejected before treating null as a gate failure
- Added a second regression test for the "licensed user with no USB device plugged in" path
- `useCaptureDeviceMap` test contract narrowed: throws surface the raw error message (gate rejection still surfaces the "License required" message)

Test count: 893 passed, 3 pre-existing unrelated failures (PDF smoke opt-in + Playwright e2e harness).

