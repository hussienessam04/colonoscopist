---
phase: 06-doctor-profile-report-editor-pdf-generation
plan: 02
subsystem: doctor-profile + reports + pdf-generation
tags: [phase-6, renderer-pages, auto-save, screenshot-attach, react-components]
dependency-graph:
  requires: [phase-06-plan-01-complete]
  provides: [profile_editor, report_editor, use_doctor_profile_hook, use_report_hook, use_attached_screenshots_hook, use_procedure_screenshots_hook, use_auto_save_hook, debounce_helper, profile_route, report_route, settings_hub_profile_entry, procedure_review_report_cta]
  affects: [app_routes, settings_sidebar, settings_hub, screenshot_timeline, procedure_review]
tech-stack:
  added: []
  patterns: [swr-style-hooks, debounced-auto-save-on-blur, html5-drag-and-drop, magic-byte-sniff, defense-in-depth-upload-validation]
key-files:
  created:
    - src/renderer/src/lib/debounce.ts
    - src/renderer/src/hooks/useAutoSave.ts
    - src/renderer/src/hooks/useDoctorProfile.ts
    - src/renderer/src/hooks/useReport.ts
    - src/renderer/src/pages/ProfileEditor.tsx
    - src/renderer/src/pages/ReportEditor.tsx
    - tests/renderer/lib/debounce.test.tsx
    - tests/renderer/hooks/use-auto-save.test.ts
    - tests/renderer/pages/report-editor.test.tsx
    - tests/renderer/pages/profile-editor.test.tsx
  modified:
    - src/renderer/src/App.tsx
    - src/renderer/src/components/SettingsSidebar.tsx
    - src/renderer/src/components/ScreenshotTimeline.tsx
    - src/renderer/src/pages/SettingsHub.tsx
    - src/renderer/src/pages/ProcedureReview.tsx
    - tests/renderer/setup.ts
decisions:
  - useAutoSave trigger accepts an optional override value so the parent can pass the freshly patched state directly (closes closure-staleness race vs React setState batch)
  - useAutoSave cleanup useEffect depends only on debounceMs + unmount — every setLocal re-render would otherwise cancel the pending save the trigger just scheduled
  - useAutoSave onSave callback reads from the value parameter, not the closure value — the parent composes the IPC call from the freshest value the hook passes in
  - ProfileEditor upload widgets read FileReader.readAsDataURL + decode base64 + sniff PNG/JPEG magic bytes client-side BEFORE the IPC call (defense in depth on top of the main-side sniff from Plan 06-01 Task 11)
  - ScreenshotTimeline extends with 3 optional props (attachedIds, onToggleAttach, onReorder) — extend, don't replace; legacy ProcedureReview / ProcedureRoom callers keep working unchanged
  - HTML5 native drag-and-drop for attached screenshot reordering (no new dep); enabled only when reorder callback supplied AND > 1 attached screenshot
  - ReportEditor routes api.reports.updateDraft for drafts + api.reports.updateFinalized post-finalize — wider post-finalize edits per CONTEXT.md D-07
  - useReport / useAttachedScreenshots / useProcedureScreenshots guard window.api.reports?.* / window.api.screenshots?.* with optional chaining to close cascade-pollution window where prior test's stashed microtask can resolve against wiped mocks
  - ScreenshotTimeline attaches are NOT bounded — doctor attaches as many as clinically useful (typical 4-10 per CONTEXT.md §Screenshot attachment); reorder is the visual contract, not a cap
  - useDoctorProfile + useReport follow the useProcedures shape (SWR-style: profile/refresh/setLocal) for visual consistency across all renderer pages
metrics:
  duration: ~45min
  completed: 2026-08-08
  tasks: 10
  test_files_added: 4
  tests_added: 16
  tests_total: 559/559 passing across 72 files
  contract_checks: 3/3 passing (ipc-contract / no-any / security-baseline)
status: complete
---

# Phase 6 Plan 02: Doctor Profile + Report Editor — Renderer Surfaces

## One-liner

Renderer surfaces for the doctor profile editor (bilingual EN+AR fields + signature/logo upload with client-side magic-byte sniff) and the report editor (4 textareas + screenshot attach + Finalize), both backed by a shared `useAutoSave` hook with explicit-trigger debounce + inline save indicator; route cases + SettingsHub sidebar entry + ProcedureReview CTA complete the navigation surface.

## Tasks Executed

10 commits in chain:

| # | Task | Commit | Notes |
|---|------|--------|-------|
| 1 | `lib/debounce.ts` | `985660c` | Closure-based primitive, 2 contract tests |
| 2 | `useAutoSave` hook | `388edf7` | Trigger-explicit debounced state machine, 4 contract tests |
| 3 | `useDoctorProfile` + `useReport` + `useAttachedScreenshots` + `useProcedureScreenshots` | `2c7d6cf` | SWR-style hooks mirroring useProcedures shape |
| 4 | `ProfileEditor.tsx` | `c8e46a8` | 6 fields + 2 upload widgets with FileReader + magic-byte sniff |
| 5 | `ScreenshotTimeline` extend | `0d32dec` | 3 optional props: attachedIds, onToggleAttach, onReorder (DnD) |
| 6 | `ReportEditor.tsx` | `667167d` | 4 textareas + Finalize + screenshot attach + badge + regen |
| 7 | `App.tsx` route cases | `5fc5cf7` | `profile-edit` + `report-editor` branches |
| 8 | `SettingsSidebar` + `SettingsHub` Profile | `b3b67c7` | Third nav entry + clinic-name preview card |
| 9 | `ProcedureReview` CTA | `77d7604` | Generate/Edit report button + post-finalize PDF leaf |
| 10 | Wave 0 tests + useAutoSave bugfix | `5ea94bf` | 16 new tests, 4 new files; debounce + auto-save hook fixes |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] useAutoSave cleanup effect cancels pending saves on every render**

- **Found during:** Task 10 (auto-save contract tests exposed that `api.reports.updateDraft` was never called)
- **Issue:** The cleanup `useEffect([debounceMs, debouncedSave, value])` had `value` in the dep array, so every `setLocal` re-render cancelled the 300ms debounce the trigger just scheduled. Trigger fired on each keystroke but the wrapped fn never ran because the next render's cleanup killed it.
- **Fix:** Removed `value` from the cleanup dep array. Cleanup now only fires on `debounceMs` change + unmount. Added a comment explaining the race.
- **Files modified:** `src/renderer/src/hooks/useAutoSave.ts`
- **Commit:** `5ea94bf`

**2. [Rule 2 - Missing critical functionality] useAutoSave trigger accepts override value to bypass closure staleness**

- **Found during:** Task 10 (parent's onChange handler fires `trigger()` but the closure-captured `value` is stale because `setLocal` queued but not yet flushed by the time the debounce fires)
- **Issue:** Without an override, the debounced save always reads the PRE-setLocal state, so the IPC sends old data.
- **Fix:** Added optional `overrideValue` parameter to `trigger()`. Parent calls `trigger(patched)` with the freshly-built state object, so the IPC round-trip always carries the latest values.
- **Files modified:** `src/renderer/src/hooks/useAutoSave.ts`, `src/renderer/src/pages/ProfileEditor.tsx`, `src/renderer/src/pages/ReportEditor.tsx`
- **Commit:** `5ea94bf`

**3. [Rule 2 - Missing critical functionality] ReportEditor + ProcedureReview + useReport guards with optional chaining**

- **Found during:** Tasks 6 + 9 (existing ProcedureReview.test.tsx emits unhandled rejections when useReport's `window.api.reports.getOrCreate` resolves against a wiped mock surface from a prior test's stashed microtask — same cascade-pollution pattern that surfaced in Phase 5 P10 for `useScreenshotIntake`)
- **Issue:** When `window.api` is mid-render-mutation during a test transition, the `.get()` / `.list()` call throws "Cannot read properties of undefined" which React's test renderer surfaces as an unhandled rejection.
- **Fix:** Optional-chain `window.api.reports?.getOrCreate?.(...)` in `useReport.refresh`, `useAttachedScreenshots.refresh`, `useProcedureScreenshots.refresh`, `useDoctorProfile.refresh`, and the `procedures.get` call inside `ReportEditor`. Existing tests no longer emit unhandled rejections; new tests can mount these pages without seeding every namespace.
- **Files modified:** `src/renderer/src/hooks/useReport.ts`, `src/renderer/src/hooks/useDoctorProfile.ts`, `src/renderer/src/pages/ReportEditor.tsx`
- **Commit:** `77d7604`, `b3b67c7`, `5ea94bf`

**4. [Rule 1 - Bug] setup.ts missing profile + reports namespaces**

- **Found during:** Tasks 8 + 10 (SettingsHub rendering caused cascade-pollution; new ReportEditor + ProfileEditor tests couldn't mock the IPC namespaces)
- **Issue:** MockApi type only covered the Phase 1-5 surface; Plan 06-02 added `profile.*` + `reports.*` to the IPC contract but the test setup didn't include them.
- **Fix:** Added the two namespaces to MockApi with `vi.fn()` defaults that resolve to safe empty values. Any renderer page that mounts them on initial render no longer crashes before per-test seeds land.
- **Files modified:** `tests/renderer/setup.ts`
- **Commit:** `5ea94bf`

## Verification

- [x] `npm run typecheck` exits 0 (both node + web)
- [x] `npm run test:unit` exits 0 — **559/559 tests passing across 72 files** (up from 543/65; +16 tests, +4 files)
- [x] `node scripts/check-ipc-contract.cjs` exits 0
- [x] `node scripts/check-no-any.cjs` exits 0
- [x] `node scripts/check-security-baseline.cjs` exits 0
- [x] 14 existing ScreenshotTimeline tests still pass after the 3-prop extension (no regressions from the extend)

## What's Next (Plan 06-03)

- `src/main/pdf/report.tsx` full clinical-report layout (header / patient / procedure / body sections / attached screenshots / footer — CONTEXT.md D-11).
- `api.reports.regenPdf` IPC handler + main-side orchestrator that re-renders on every post-finalize edit.
- `api.reports.openPdf` shells out via `electron.shell.openPath` (RPT-07).
- "Reveal PDF in Explorer" affordance alongside "Open PDF" in the ReportEditor header.
- `ProcedureReview.tsx` "PDF: <leaf>" line replaced by "Open PDF" + "Reveal in Explorer" buttons.
- Smoke test: render a real PDF end-to-end and verify the file's `%PDF-` magic + page count.

## Self-Check: PASSED

- [x] All 10 task commits exist in git log
- [x] `npm run typecheck` clean
- [x] 559/559 unit tests pass across 72 files
- [x] All three contract checks pass (ipc-contract / no-any / security-baseline)
- [x] ProfileEditor uploads reject non-PNG/JPEG files client-side via magic-byte sniff (verified by RTL test stubbing FileReader)
- [x] ReportEditor Finalize → updateFinalized routing verified end-to-end via stateful mock

## File Inventory

**New (10):**
- `src/renderer/src/lib/debounce.ts` (closure-based debounce primitive)
- `src/renderer/src/hooks/useAutoSave.ts` (debounced save state machine)
- `src/renderer/src/hooks/useDoctorProfile.ts` (SWR-style profile hook)
- `src/renderer/src/hooks/useReport.ts` (3 hooks: useReport + useAttachedScreenshots + useProcedureScreenshots)
- `src/renderer/src/pages/ProfileEditor.tsx` (bilingual fields + signature/logo upload)
- `src/renderer/src/pages/ReportEditor.tsx` (4 textareas + screenshot attach + Finalize + badge)
- `tests/renderer/lib/debounce.test.tsx` (2 tests)
- `tests/renderer/hooks/use-auto-save.test.ts` (4 tests)
- `tests/renderer/pages/report-editor.test.tsx` (5 tests)
- `tests/renderer/pages/profile-editor.test.tsx` (5 tests)

**Modified (6):**
- `src/renderer/src/App.tsx` (+2 route cases: `profile-edit` + `report-editor`)
- `src/renderer/src/components/SettingsSidebar.tsx` (+Profile entry, third nav button)
- `src/renderer/src/components/ScreenshotTimeline.tsx` (+3 optional props: attachedIds, onToggleAttach, onReorder with native HTML5 DnD)
- `src/renderer/src/pages/SettingsHub.tsx` (+Profile card with clinic-name preview + "Open profile editor" link)
- `src/renderer/src/pages/ProcedureReview.tsx` (+Report Card with Generate/Edit CTA + pdf_leaf line)
- `tests/renderer/setup.ts` (+`profile` + `reports` namespaces in MockApi)

## Notes

- The `useAutoSave` hook is now reusable for any future auto-save-on-blur pattern (notes, settings edits, etc.) — no renderer-specific code lives inside it.
- `ScreenshotTimeline` is now used in three contexts: ProcedureReview (post-recording), ProcedureRoom (mid-procedure gallery), and ReportEditor (attach picker). The 3 new props are additive — the existing 14 tests all keep passing.
- Profile + report uploads land at `<userData>/data/profiles/<userId>/` + `<userData>/data/reports/<reportId>.pdf` (Plan 06-01 paths). The renderer never sees the absolute paths — just the userData-relative forms returned by main.
- Plan 06-03 owns the actual PDF layout. This plan just wires the IPC + the post-finalize badge + the Open PDF / Re-render PDF buttons (the buttons call IPC stubs that Plan 06-01 left in place; Plan 06-03 fills in the @react-pdf/renderer template).