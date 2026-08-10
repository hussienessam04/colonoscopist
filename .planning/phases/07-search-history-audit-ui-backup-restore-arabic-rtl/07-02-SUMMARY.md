---
phase: 07-search-history-audit-ui-backup-restore-arabic-rtl
plan: 02
subsystem: ui
tags: [search, patient-list, accordion, settings-sidebar, sqlite, fts, filter-sidebar]

# Dependency graph
requires:
  - phase: phase-07-plan-07-01
    provides: AUDIT_LOG IPC channel + REPORTS_GET_BY_PROCEDURE handler + extended patientRepo.list / proceduresRepo.list filter surface (dateFrom/dateTo/doctorId/procedureStatus) + shadcn primitives (popover/tooltip/slider)
  - phase: phase-06-doctor-profile-report-editor-pdf
    provides: DoctorProfile + Report + Procedure IPC surfaces + reports.openPdf IPC + SettingsHub page + SettingsSidebar shared component
  - phase: phase-03-capture-device-enumeration-live-preview-quality-presets
    provides: SettingsHub sidebar nav pattern (active-tab highlight + admin gate) + PatientRow actions menu
provides:
  - Patient List filter sidebar (5-dim AND-combined: search / MRN / dateFrom+dateTo / doctor / procedure status) with Apply + Clear buttons
  - PatientRow accordion expansion (procedure rows navigate to procedure-review; report rows invoke reports.openPdf)
  - SettingsSidebar Audit + Backup & Restore visual entries + Route union extensions
  - 18 new test cases (5 patientRepo + 3 proceduresRepo + 6 PatientsList + 4 SettingsSidebar)
affects: 07-03-audit-ui-profile (consumes Route.audit + reports.getByProcedure + filter audit metadata), 07-04-i18n-ar-pdf (consumes the new sidebar structure for RTL audit), 07-05-backup-restore-ui (consumes Route.backup-restore)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Filter sidebar in the left rail (`grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]`) with 5-dim AND-combined input surface (Phase 7 / D-01 verbatim)
    - Two flow channels on the same list: search/MRN debounce-refetch (Phase 2 preserved) + date/doctor/status Apply-only (D-01 verbatim "all inputs non-blocking")
    - `useEffect` + `isFirstRender` ref pattern to skip mount-time refetch when wiring a new "filter committed" effect that should only fire on user-driven changes
    - PatientRow renders a fragment of one or two `<tr>`s (single row collapsed, or row + accordion content row) — keeps the table structure intact while adding per-row expansion
    - `reportsByProcedure: Record<procedureId, Report | null>` map shape vs flat `Report[]` — O(1) lookup per procedure at render time, matches the natural 1:1 reports-per-procedure shape (D-05)

key-files:
  created:
    - tests/main/db/patients.test.ts (5 cases — Phase 2 zero-config regression + dateFrom/dateTo + doctorId + procedureStatus + AND-combined intersection)
  modified:
    - src/renderer/src/pages/PatientsList.tsx (filter sidebar layout + Apply/Clear + accordion expansion orchestration)
    - src/renderer/src/components/PatientRow.tsx (4 new props: expanded / onToggleExpand / procedures / reportsByProcedure / onOpenProcedure / onOpenReport)
    - src/renderer/src/lib/router.ts (Route union extended with 'audit' + 'backup-restore')
    - src/renderer/src/components/SettingsSidebar.tsx (Audit + Backup & Restore buttons with FileSearch + HardDrive icons; NOT admin-gated per UI-SPEC)
    - src/renderer/src/pages/SettingsHub.tsx (Audit + Backup & Restore descriptions in the existing CardContent)
    - tests/main/db/procedures-repo.test.ts (3 cases — dateFrom/dateTo + doctorId + AND-combined per D-04)
    - tests/renderer/pages/patients-list.test.tsx (6 cases — sidebar mounts, Clear resets, expand row, procedure click navigates, report click opens PDF, Apply triggers refetch)
    - tests/renderer/components/settings-sidebar.test.tsx (4 cases — Audit + Backup & Restore buttons mount + click navigates + not admin-gated)
    - tests/renderer/setup.ts (added reports.getByProcedure to the MockApi type + default mock)
    - src/preload/index.ts (paired the reports.getByProcedure bridge with the IPC.REPORTS_GET_BY_PROCEDURE handler from f96618c)

key-decisions:
  - "Two-flow filter state — search/MRN are direct state that debounce-refetch (Phase 2 PAT-02/PAT-04 preserved); dateFrom/dateTo/doctorId/status are pending → applied on Apply (D-01 verbatim). The Apply button commits the new state and a separate useEffect fires the refetch — this avoids the closure-capture-stale-state trap of calling refetch() directly from the click handler"
  - "isFirstRender ref pattern to skip the mount-time call of the new useEffect — the search/MRN debounce effect already fires the initial refetch 250ms after mount; the second useEffect would otherwise double-fetch on every page load"
  - "PatientRow renders a fragment of one or two <tr>s (single row when collapsed, row + accordion content row when expanded) — keeps the existing table structure intact while adding per-row expansion. The expansion <tr> has colSpan={7} and the toggler cell adds an 8th column"
  - "reportsByProcedure is a Record<string, Report | null> map, not a flat Report[] — the 1:1 reports-per-procedure shape (D-05) means a map is the natural parent-state shape and gives O(1) lookup at render time"
  - "SettingsSidebar Audit + Backup & Restore buttons are NOT admin-gated per UI-SPEC §Implementation Bindings — every doctor sees them. Visual order is Capture → Profile → Audit → Backup & Restore → Users (audit-backup land between Profile and Users per the CONTEXT.md §Phase 7 plan)"
  - "Route union adds { name: 'audit' } + { name: 'backup-restore' } NOW so the sidebar's navigate() calls compile; the page bodies land in Plan 07-03 (Audit) + Plan 07-05 (Backup & Restore). Adding the variants up-front is cheaper than a follow-up commit just to extend the union"

patterns-established:
  - "Pattern 1: useEffect with isFirstRender ref to skip the mount-time call when wiring a new effect that should only fire on user-driven changes — eliminates the double-fetch that comes from adding a new effect alongside an existing one that already handles mount"
  - "Pattern 2: Filter sidebar as a left-rail Card on the existing list page (not a separate route) — matches SettingsHub's visual density per D-01 verbatim \"filter sidebar matches SettingsHub's visual density\". Doctor stays on the Patient List, just sees a refined view"
  - "Pattern 3: Procedure row click navigates to { name: 'procedure-review', procedureId } + report row click invokes window.api.reports.openPdf({id, reveal: false}) — both are the existing IPC surfaces, no new contract entries required for the Patient List accordion (SRCH-03 + D-03)"
  - "Pattern 4: Two-tier filter state (pendingFilters + appliedFilters) for Apply-only controls vs single-state debounce for text inputs — mirrors D-01 verbatim \"all inputs non-blocking\" without losing the Phase 2 debounce-refetch on search"

requirements-completed: [SRCH-01, SRCH-02, SRCH-03]

coverage:
  - id: D1
    description: "patientRepo.list AND-combines dateFrom / dateTo / doctorId / procedureStatus with the Phase 2 name / MRN filters via the single listWithFiltersActive prepared statement + EXISTS subquery on procedures"
    requirement: SRCH-01
    verification:
      - kind: unit
        ref: tests/main/db/patients.test.ts#dateFrom/dateTo filters on procedures.started_at (canonical procedure date per Phase 4 D-10)
        status: pass
      - kind: unit
        ref: tests/main/db/patients.test.ts#doctorId filters on procedures.doctor_id
        status: pass
      - kind: unit
        ref: tests/main/db/patients.test.ts#procedureStatus multi-select returns patients with matching procedure status
        status: pass
      - kind: unit
        ref: tests/main/db/patients.test.ts#AND-combined filters: dateFrom/dateTo + doctorId + procedureStatus = the intersection
        status: pass
      - kind: unit
        ref: tests/main/db/patients.test.ts#no filters returns all active patients (preserves Phase 2 behavior)
        status: pass
    human_judgment: false
  - id: D2
    description: "proceduresRepo.list accepts dateFrom / dateTo / doctorId filters per D-04 (date range applies to procedures.started_at)"
    requirement: SRCH-02
    verification:
      - kind: unit
        ref: tests/main/db/procedures-repo.test.ts#dateFrom/dateTo filters on procedures.started_at
        status: pass
      - kind: unit
        ref: tests/main/db/procedures-repo.test.ts#doctorId filters on procedures.doctor_id
        status: pass
      - kind: unit
        ref: tests/main/db/procedures-repo.test.ts#AND-combined: dateFrom + dateTo + doctorId = the intersection
        status: pass
    human_judgment: false
  - id: D3
    description: "Patient List filter sidebar live in the left rail with 5 dimensions AND-combined + Apply + Clear buttons (D-01 verbatim)"
    requirement: SRCH-01
    verification:
      - kind: unit
        ref: tests/renderer/pages/patients-list.test.tsx#renders the filter sidebar with all 5 dimensions + Apply + Clear
        status: pass
      - kind: unit
        ref: tests/renderer/pages/patients-list.test.tsx#Clear filters resets search + mrn and refetches with empty filters
        status: pass
      - kind: unit
        ref: tests/renderer/pages/patients-list.test.tsx#Apply triggers refetch with the new dateFrom / dateTo / status
        status: pass
    human_judgment: false
  - id: D4
    description: "PatientRow accordion expansion: procedure row click navigates to procedure-review; report row click invokes reports.openPdf per SRCH-03 + D-03"
    requirement: SRCH-03
    verification:
      - kind: unit
        ref: tests/renderer/pages/patients-list.test.tsx#expanding a patient row calls procedures.list + reports.getByProcedure
        status: pass
      - kind: unit
        ref: tests/renderer/pages/patients-list.test.tsx#clicking a procedure row navigates to {name: "procedure-review", procedureId}
        status: pass
      - kind: unit
        ref: tests/renderer/pages/patients-list.test.tsx#clicking a report row invokes window.api.reports.openPdf with {id, reveal:false}
        status: pass
    human_judgment: false
  - id: D5
    description: "SettingsSidebar gains Audit + Backup & Restore visual entries with FileSearch + HardDrive lucide icons + new Route union variants (D-05 + D-11); page bodies land in Plan 07-03 + 07-05"
    requirement: SRCH-01
    verification:
      - kind: unit
        ref: tests/renderer/components/settings-sidebar.test.tsx#renders the Audit + Backup & Restore buttons alongside the existing entries
        status: pass
      - kind: unit
        ref: tests/renderer/components/settings-sidebar.test.tsx#clicking Audit navigates to {name: "audit"}
        status: pass
      - kind: unit
        ref: tests/renderer/components/settings-sidebar.test.tsx#clicking Backup & Restore navigates to {name: "backup-restore"}
        status: pass
      - kind: unit
        ref: tests/renderer/components/settings-sidebar.test.tsx#Audit + Backup & Restore are NOT admin-gated (every doctor sees them)
        status: pass
    human_judgment: false

# Metrics
duration: ~30min
started: 2026-08-11T02:30:00Z
completed: 2026-08-11T03:00:00Z
tasks: 2 (Task 1 renderer finish — filter sidebar + accordion + tests; Task 2 — SettingsSidebar audit + backup-restore + Route union)
files: 9 modified + 1 created
status: complete
---

# Phase 7 Plan 2: Patient List filter sidebar + accordion expansion + Settings sidebar entries

**Cross-cutting Patient List filter sidebar (5-dim AND-combined per D-02) with Apply/Clear, per-row accordion expansion (procedure → procedure-review, report → openPdf), and SettingsSidebar Audit + Backup & Restore visual entries backed by the Route union.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-08-11T02:30:00Z
- **Completed:** 2026-08-11T03:00:00Z
- **Tasks:** 2 (Task 1 renderer finish — filter sidebar + accordion + tests; Task 2 — SettingsSidebar audit + backup-restore entries + Route union)
- **Files modified:** 9 (1 new test file + 9 modified)

## Accomplishments

- **Patient List filter sidebar lives on the existing page (D-01 verbatim)** — the layout restructures to `grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]` matching SettingsHub's visual density. The left rail is a `<Card>` with 5 inputs (search / MRN / dateFrom+dateTo / doctor / 3 status checkboxes) + Apply + Clear buttons. Search and MRN debounce-refetch (Phase 2 behavior preserved); date range, doctor, and procedure status are Apply-only per D-01 verbatim "all inputs non-blocking".
- **Per-row accordion expansion on PatientRow (SRCH-03 + D-03)** — the row gains 4 new optional props (expanded / onToggleExpand / procedures / reportsByProcedure / onOpenProcedure / onOpenReport). When expanded, a sub-`<tr>` renders each procedure with status badge + "Open procedure" link that calls `navigate({name:'procedure-review', procedureId})`, and each report sub-row with status chip (Draft / Finalized) + "Open PDF" link that invokes `window.api.reports.openPdf({id, reveal:false})`.
- **SettingsSidebar Audit + Backup & Restore entries (D-05 + D-11)** — the Route union extends with `{name:'audit'}` + `{name:'backup-restore'}` so the sidebar's navigate() calls compile NOW. The sidebar gains two new buttons (FileSearch + HardDrive icons, NOT admin-gated per UI-SPEC §Implementation Bindings — every doctor sees them). Visual order is Capture → Profile → Audit → Backup & Restore → Users. The SettingsHub page adds matching description paragraphs; the page bodies land in Plan 07-03 + 07-05.
- **18 new test cases prove all the filter dimensions + navigation paths** — 5 cases in `tests/main/db/patients.test.ts` (new file) for the patientRepo filter combinations + Phase 2 zero-config regression; 3 cases in `tests/main/db/procedures-repo.test.ts` for proceduresRepo date + doctor filters; 6 cases in `tests/renderer/pages/patients-list.test.tsx` (sidebar mounts, Clear resets, expand row triggers IPC, procedure click navigates, report click opens PDF, Apply triggers refetch); 4 cases in `tests/renderer/components/settings-sidebar.test.tsx` (Audit + Backup & Restore mount + click navigate + not admin-gated).
- **Full unit suite green** — 625/628 tests pass (3 PDF smoke tests fail with a pre-existing `@react-pdf/reconciler` "Minified React error #130" unrelated to this plan; the 36 tests in the four files targeted by this plan all pass). The pre-existing typecheck errors in `ScreenshotTimeline.tsx` + `ReportEditor.tsx` (useState unused, Screenshot import, Uint8Array BlobPart cast, missing ReportEditableFields properties) are out of scope for Plan 07-02.

## Task Commits

Each task was committed atomically:

1. **Task 1: Patient List filter sidebar + accordion expansion + per-row navigation (renderer finish + tests)** — `74eb47c` (feat)
2. **Task 2: SettingsSidebar visual entries + Route union extensions + SettingsHub descriptions** — `eb8ee92` (feat)

**Plan metadata:** `eb8ee92` (Task 2 — last commit before SUMMARY)

_Note: Task 1's main-side work landed in `f96618c` (the prior agent's WIP commit before this continuation). This continuation agent finished the renderer side (PatientsList layout + PatientRow accordion + preload getByProcedure bridge) and added the new test files + test extensions; then Task 2 added the SettingsSidebar entries + Route union._

## Files Created/Modified

### Created

- `tests/main/db/patients.test.ts` — 5 cases: Phase 2 zero-config regression (no filters returns all 3 active patients) + dateFrom/dateTo filter + doctorId filter + procedureStatus multi-select + AND-combined intersection across all 4 dimensions.

### Modified

- `src/renderer/src/pages/PatientsList.tsx` — restructured layout to `grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]`; left rail is a `<Card data-testid="patient-filter-sidebar">` with CardHeader "Search & filter" + CardContent containing the 5 inputs + Apply + Clear; right column is the existing results Card + pagination. State split: `search` + `mrn` are direct state (debounce-refetch) + `pendingFilters` + `appliedFilters` for the Apply-only controls. The first `useEffect` debounces on `[search, mrn, includeDeleted, page, pageSize]`; the second `useEffect` watches `[appliedFilters]` with an `isFirstRender` ref skip pattern. `handleApply` and `handleClear` commit state changes; the refetch happens in the second `useEffect` so it always uses the latest committed state (not the closure-captured stale value).
- `src/renderer/src/components/PatientRow.tsx` — added 4 new optional props (`expanded?`, `onToggleExpand?`, `procedures?`, `reportsByProcedure?`, `onOpenProcedure?`, `onOpenReport?`); renders a fragment of one or two `<tr>`s. The first `<tr>` adds an 8th column with a `<Button>` chevron toggler. The second `<tr>` (only when expanded) has `colSpan={7}` and renders the procedure list + per-procedure report sub-row. Uses `formatProcedureDate(proc.startedAt)` from `src/renderer/src/lib/format.ts` (added in Plan 07-01 WIP) for the procedure date label.
- `src/renderer/src/lib/router.ts` — extended the `Route` union with `{name:'audit'}` + `{name:'backup-restore'}` so the SettingsSidebar's `navigate()` calls compile. The page bodies land in Plan 07-03 + 07-05.
- `src/renderer/src/components/SettingsSidebar.tsx` — extended `SettingsTab` type to `'capture' | 'users' | 'profile' | 'audit' | 'backup-restore'`; added two new `<Button>` entries AFTER the Profile button with FileSearch + HardDrive lucide icons, the `data-testid='settings-hub-audit'` + `data-testid='settings-hub-backup-restore'` hooks, and the `data-active` highlight that keys on `route.name === 'audit' | 'backup-restore'`. Both are NOT admin-gated per UI-SPEC §Implementation Bindings.
- `src/renderer/src/pages/SettingsHub.tsx` — added two `<p>` description entries in the existing CardContent for Audit + Backup & Restore (mirroring the existing Capture/Profile/Users paragraphs). Kept the existing `<SettingsSidebar />` mount unchanged.
- `src/preload/index.ts` — paired the `reports.getByProcedure` bridge with the `IPC.REPORTS_GET_BY_PROCEDURE` handler that landed in `f96618c` (WIP commit). Without this bridge the Patient List accordion couldn't call the read-only report lookup from the renderer.
- `tests/main/db/procedures-repo.test.ts` — added a new `describe('proceduresRepo.list — Phase 7 date + doctor filters (D-04)')` block with 3 cases (dateFrom/dateTo on started_at, doctorId, AND-combined).
- `tests/renderer/pages/patients-list.test.tsx` — added a new `describe('PatientsList — filter sidebar + accordion expansion (Phase 7)')` block with 6 cases.
- `tests/renderer/components/settings-sidebar.test.tsx` — added a new `describe('SettingsSidebar — Phase 7 Audit + Backup & Restore entries')` block with 4 cases.
- `tests/renderer/setup.ts` — added `getByProcedure: ReturnType<typeof vi.fn>` to the `MockApi.reports` type + the default `vi.fn().mockResolvedValue(null)` in `mockApi()`. Without this addition the new `expanding a patient row` test would fail with `Cannot read properties of undefined (reading 'mockResolvedValue')`.

## Decisions Made

- **Two-tier filter state (pendingFilters + appliedFilters) for Apply-only controls** — search and MRN are direct state that debounce-refetch (Phase 2 PAT-02 / PAT-04 preserved); date range, doctor, and procedure status are pending → applied on Apply. The Apply button commits the new state and a separate `useEffect` fires the refetch. This avoids the closure-capture-stale-state trap of calling `refetch()` directly from the click handler (the click handler's closure sees the OLD state at the time of the call).
- **`isFirstRender` ref pattern to skip the mount-time call of the new useEffect** — the search/MRN debounce effect already fires the initial refetch 250ms after mount. The second `useEffect` on `[appliedFilters]` would otherwise double-fetch on every page load. The `useRef(true)` + first-render-skip pattern is the smallest correct way to add an effect that should only fire on user-driven changes.
- **PatientRow renders a fragment of one or two `<tr>`s** — single row when collapsed, row + accordion content row when expanded. The expansion `<tr>` has `colSpan={7}` (the existing 7 columns) and the toggler cell adds an 8th column with a chevron. This keeps the existing table structure intact while adding per-row expansion; an accordion wrapping the whole row would have required restructuring the table layout.
- **`reportsByProcedure: Record<string, Report | null>` map vs flat `Report[]`** — the 1:1 reports-per-procedure shape (D-05) means a map is the natural parent-state shape and gives O(1) lookup at render time. A flat array would have required a linear scan inside PatientRow's render.
- **SettingsSidebar Audit + Backup & Restore buttons are NOT admin-gated** per UI-SPEC §Implementation Bindings — every doctor sees them. Visual order is Capture → Profile → Audit → Backup & Restore → Users (audit-backup land between Profile and Users per the CONTEXT.md §Phase 7 plan).
- **Route union adds `{ name: 'audit' }` + `{ name: 'backup-restore' }` NOW** so the sidebar's `navigate()` calls compile; the page bodies land in Plan 07-03 (Audit) + Plan 07-05 (Backup & Restore). Adding the variants up-front is cheaper than a follow-up commit just to extend the union.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `refetch()` in handleApply / handleClear used the closure-captured stale state**
- **Found during:** Task 1 — PatientsList "Apply triggers refetch" test was seeing the OLD filter values (e.g. `dateFrom: undefined` when the test had typed '2026-08-01' into the date input then clicked Apply).
- **Issue:** `handleApply` called `void refetch()` directly. The closure had the stale `appliedFilters` from the previous render (the new value wouldn't be in scope until React re-rendered, which happens after the click handler returns). Same pattern in `handleClear`.
- **Fix:** Removed the direct `refetch()` call. Added a second `useEffect` on `[appliedFilters]` with an `isFirstRender` ref skip. The refetch now fires AFTER React commits the new state, so it always uses the latest values. The `isFirstRender` ref skip prevents double-fetching on mount (the search/MRN debounce already fires the initial refetch 250ms after mount).
- **Files modified:** `src/renderer/src/pages/PatientsList.tsx`
- **Verification:** "Apply triggers refetch with the new dateFrom / dateTo / status" test passes; "Clear filters resets search + mrn and refetches with empty filters" test passes; all 12 PatientsList tests green.
- **Committed in:** `74eb47c` (Task 1)

**2. [Rule 3 - Blocking] `tests/main/db/patients.test.ts` + `tests/main/db/procedures-repo.test.ts` had invalid TypeScript syntax (`ReturnType<typeof import>['getDb']`)**
- **Found during:** Task 1 — `npm run test:unit` failed with `Expected "(" but found ">"` at the type annotation. The angle-bracket in the import type confuses esbuild's parser.
- **Issue:** I used `ReturnType<typeof import>['getDb']` (a partial import form) to avoid the cycle / the unused-import warning. The parser rejected it.
- **Fix:** Changed to `ReturnType<typeof import('../../../src/main/db').getDb>` (full path form). The TS compiler resolves the import type and the esbuild transform no longer trips on the angle brackets.
- **Files modified:** `tests/main/db/patients.test.ts`, `tests/main/db/procedures-repo.test.ts`
- **Verification:** Test transform succeeds; all 5 patients.test.ts + 9 procedures-repo.test.ts cases green.
- **Committed in:** `74eb47c` (Task 1)

**3. [Rule 3 - Blocking] `tests/main/db/patients.test.ts` had typo'd patient UUIDs that failed the FK constraint**
- **Found during:** Task 1 — `AND-combined filters` test failed with `FOREIGN KEY constraint failed` on the `insertProcedure` call.
- **Issue:** I copy-pasted the procedure UUIDs but typo'd the patient UUIDs (`'00000000-4000-8000-000000000020'` was missing the `0000-` group between `00000000` and `4000`). The procedure FK references a non-existent patient.
- **Fix:** Restored the canonical UUID format `'00000000-0000-4000-8000-000000000020'`. Also fixed a wrong expected-procedure-id in the procedures-repo AND-combined test (expected `c1` but the test's data made `a1` the correct answer — `a1` is Aug + doctor1, the only row that matches `dateFrom=2026-08-01 + dateTo=2026-08-31 + doctorId=doctor1`).
- **Files modified:** `tests/main/db/patients.test.ts`, `tests/main/db/procedures-repo.test.ts`
- **Verification:** All 5 patients.test.ts + 9 procedures-repo.test.ts cases green.
- **Committed in:** `74eb47c` (Task 1)

**4. [Rule 2 - Missing Critical] `tests/renderer/setup.ts` MockApi type was missing `reports.getByProcedure`**
- **Found during:** Task 1 — `expanding a patient row calls procedures.list + reports.getByProcedure` test failed with `Cannot read properties of undefined (reading 'mockResolvedValue')`.
- **Issue:** The `MockApi` interface in the test setup was missing the new `getByProcedure` method. The Patient List accordion's `handleToggleExpand` calls `window.api.reports.getByProcedure(...)` for each procedure to look up the report; without the mock the test threw.
- **Fix:** Added `getByProcedure: ReturnType<typeof vi.fn>` to the `MockApi.reports` type and `getByProcedure: vi.fn().mockResolvedValue(null)` to `mockApi()`.
- **Files modified:** `tests/renderer/setup.ts`
- **Verification:** "expanding a patient row" + "clicking a procedure row navigates" + "clicking a report row invokes openPdf" all pass.
- **Committed in:** `74eb47c` (Task 1)

---

**Total deviations:** 4 auto-fixed (1 bug + 3 blocking/missing-critical)
**Impact on plan:** All auto-fixes necessary for correctness. No scope creep. The isFirstRender pattern is documented in `## Decisions Made` so the next plan that wires a new "filter committed" effect can use the same pattern.

## Issues Encountered

- **PDF smoke tests fail with a pre-existing `@react-pdf/reconciler` "Minified React error #130"** — these 3 tests (`tests/integration/pdf-smoke.test.ts`) are opt-in via `RUN_SMOKE=1` and have a known issue with the @react-pdf reconciler that surfaces when the ReportPdf component is rendered. This is pre-existing (not caused by this plan's changes) and lives in Plan 06-03's scope to fix.
- **Pre-existing typecheck errors in `ScreenshotTimeline.tsx` + `ReportEditor.tsx`** — `useState` declared but never read in ScreenshotTimeline; `Screenshot` import declared but never used in ReportEditor; `Uint8Array<ArrayBufferLike>` not assignable to `BlobPart` in ReportEditor; `ReportEditableFields` missing properties in ReportEditor. None of these are in Plan 07-02's scope — they were already present in the codebase before this plan's execution.

## User Setup Required

None - no external service configuration required. The filter sidebar, accordion, and SettingsSidebar entries are all renderer-side work that builds on the existing Plan 07-01 IPC surface (`patients.list` + `procedures.list` + `reports.getByProcedure` + `auth.usersList`).

## Next Phase Readiness

**Ready for:**
- **07-03 (Audit UI + Profile)** — the new `Route.audit` variant + the `SettingsSidebar.settings-hub-audit` button now point at a route the renderer will mount. The page body can land in Plan 07-03.
- **07-04 (i18n + AR PDF)** — the new sidebar structure mirrors cleanly into RTL via the existing shadcn primitives; the filter sidebar Card body can be wrapped with the i18n translation keys without layout reflow.
- **07-05 (Backup/Restore UI)** — the new `Route.backup-restore` variant + the `SettingsSidebar.settings-hub-backup-restore` button are wired and waiting for the page body. The `BACKUP_CREATE/REVEAL/RESTORE_PREVIEW/UNPACK` IPC channels from Plan 07-01 are ready for the renderer to consume.

**Concerns:**
- The pre-existing renderer-side typecheck errors in `ScreenshotTimeline.tsx` + `ReportEditor.tsx` are still present (unrelated to this plan but visible in `npm run typecheck:web`). Phase 7 will need to address them as renderer code is touched.
- The pre-existing `@react-pdf/reconciler` error #130 in `pdf-smoke.test.ts` blocks the 3 PDF smoke tests; the next plan touching `ReportEditor.tsx` will likely surface this as well.

---
*Phase: 07-search-history-audit-ui-backup-restore-arabic-rtl*
*Completed: 2026-08-11*
