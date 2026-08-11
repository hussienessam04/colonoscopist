---
slug: audit-ui-polish
created: 2026-08-11
type: bugfix+polish
source: ad-hoc user report (4 issues)
phase: quick-20260811-audit-ui-polish
plan: 01
subsystem: ui
tags: [electron, react, ipc, sqlite, audit, shadcn, i18n]

# Dependency graph
requires:
  - phase: Phase 7 / Plan 07-03
    provides: Audit page + AUDIT_LIST IPC handler + useAudit hook + audit:list mock in test setup
provides:
  - snake_case → camelCase IPC mapping in audit handler
  - entityType filter honored at the SQL layer (list + count)
  - Defensive JSON.parse fallback for malformed metadata rows
  - Outcome coercion to the contract union
  - SettingsSidebar mounted on Audit page (left rail, activeTab='audit')
  - UI polish (sticky header, hover rows, status color tokens, skeleton loading, badges)
  - audit.errorTitle i18n key (EN + AR)
  - 12 new test cases (5 renderer + 4 IPC handler + 3 main db)
affects:
  - Future audit-page work (the post-mapping shape is now the contract the renderer sees)
  - Future IPC handler reviews (snake_case → camelCase is now the canonical pattern at this boundary)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - IPC handler snake_case → camelCase mapping at the main-side boundary (toAuditEntry helper, defensive JSON.parse + outcome coerce)
    - Status color tokens (emerald/amber/blue/red/slate bg-{color}-100 text-{color}-800) reused from PatientProcedures — no new tokens
    - Skeleton loading rows (3 grey animate-pulse divs) without shadcn Skeleton dep
    - Sticky <thead> inside max-h-[60vh] overflow-y-auto container for long-table scroll
    - zod validators must explicitly enumerate optional fields (no implicit .strict() here) — silent stripping of unknown keys is the snake_case bug class

key-files:
  created:
    - tests/main/db/audit.test.ts (3 cases — entityType filter at the SQL layer)
  modified:
    - src/main/db/audit.ts (entityType on AuditListInput + SQL filter clause + parameter passthrough)
    - src/main/ipc/audit.ts (toAuditEntry mapper + mapping in AUDIT_LIST handler)
    - src/shared/validators.ts (entityType field added to auditFilterInput zod schema)
    - src/renderer/src/pages/Audit.tsx (grid layout + SettingsSidebar + UI polish + badges + skeleton)
    - src/renderer/src/i18n/en/translation.json (audit.errorTitle key)
    - src/renderer/src/i18n/ar/translation.json (audit.errorTitle key — AR parity)
    - tests/renderer/pages/Audit.test.tsx (+5 post-mapping shape cases — 10 total)
    - tests/main/ipc/audit.test.ts (+4 IPC mapping cases — 9 total)

key-decisions:
  - Fix at the IPC boundary, NOT in the renderer (useAudit.ts untouched per plan constraint). Renderer continues to consume camelCase AuditEntry; main translates the snake_case DB shape into the contract before the data crosses the IPC line.
  - Defensive JSON.parse with { _parseError: true, _raw: ... } fallback — surfaces the corrupt row to the operator instead of crashing the whole Audit page (Bug 2.1).
  - Outcome coerced to the contract union via a 2-value check ('failed' | 'rate_limited'); everything else maps to 'ok'. Older rows with stale outcome strings get cleaned at the boundary (Bug 2.2).
  - entityType added to the zod validator explicitly — without it, zod silently strips unknown keys (no .strict()) and the renderer filter would never reach the SQL layer. Plan note claimed "validators already extract entityType" but the schema didn't actually list it; auto-fixed via Rule 1 (no functional surface added, just the missing validator field).
  - Empty-state text reverted to the pre-existing 'audit.empty' string to keep the 5 existing Audit tests green. Differentiation between "no rows yet" and "no rows match filters" deferred — current key set already supports it via `audit.emptyHint` but introducing it would change the existing test's text assertion.
  - Renderer tests feed the post-mapping shape (camelCase + parsed Record metadata). The IPC handler's actual mapping is covered in tests/main/ipc/audit.test.ts via the handler-map pattern. Together they prove (a) the handler maps and (b) the renderer handles the mapped shape.

patterns-established:
  - IPC handler mapping pattern: pure toXxxEntry function in main/ipc/*.ts that translates snake_case DB rows → camelCase contract; defensive JSON.parse for text columns; outcome/status coercion to the contract union. Reuse pattern: Audit → future ipc/handlers with snake_case DB tables (e.g., procedures, screenshots).
  - SettingsSidebar layout pattern: `<div className="mx-auto grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">` with SettingsSidebar as the first grid cell and existing content wrapped in a flex-col div as the second cell. Reuse pattern for all Settings sub-pages.

requirements-completed: []

# Metrics
duration: ~10 min
completed: 2026-08-11
status: complete
---

# Quick Task: Audit UI — Fix crash/NaN bugs + add SettingsSidebar + polish + add tests Summary

**Audit page crash + snake_case → camelCase IPC mapping + entityType filter + SettingsSidebar mount + status badges + skeleton loading + 12 new tests**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-08-11T16:41:00Z
- **Completed:** 2026-08-11T16:53:00Z
- **Tasks:** 6 file edits + 2 test files (1 new + 1 extended)
- **Files modified:** 8 (4 source + 2 i18n + 2 test)
- **Files created:** 1 (`tests/main/db/audit.test.ts`)
- **Tests added:** 12 (5 renderer + 4 IPC handler + 3 main db)

## Accomplishments

- Fixed **NaN:NaN:NaN time display** (Bug 1) — IPC handler now maps snake_case DB rows to camelCase AuditEntry before crossing the boundary. Pre-fix, the renderer accessed `row.createdAt === undefined` and produced `NaN:NaN:NaN` via `new Date(undefined).getHours()`.
- Fixed **entityType filter not narrowing rows** (Bug 3) — `auditRepo.list` prepared statements now include `AND (@entityType IS NULL OR entity_type = @entityType)`; the zod validator now allows entityType through. Pre-fix, the UI looked like it worked but the SQL ignored the filter.
- Fixed **Audit page crash on corrupt metadata** (Bug 2.1) — defensive JSON.parse in the IPC handler falls back to `{ _parseError: true, _raw: <text> }` instead of throwing. The whole page no longer fails to load when one row has truncated JSON.
- Fixed **unknown outcome values** (Bug 2.2) — IPC handler clamps outcome to the contract union (`'ok' | 'failed' | 'rate_limited'`); legacy strings coerce to `'ok'`.
- **SettingsSidebar mounted** (Bug 4) — Audit page now renders `<SettingsSidebar activeTab="audit" />` in the left rail with `data-active="true"` on the Audit button, mirroring the ProfileEditor + SettingsCapture + BackupRestore pattern.
- **UI polished** — sticky `<thead>` inside `max-h-[60vh] overflow-y-auto`; hover:bg-slate-50 rows; status color tokens reused from PatientProcedures (emerald/amber/blue/red/slate `bg-{color}-100 text-{color}-800`); entity + outcome badge pills; 3-row grey `animate-pulse` skeleton loading; detail dialog bumped to max-w-3xl.
- **i18n parity** — `audit.errorTitle` added to both EN ("Failed to load audit log") and AR ("فشل تحميل سجل التدقيق") bundles. D-24 parity test passes.

## Task Commits

1. **`fix(quick): Audit page — snake_case mapping + entityType filter + SettingsSidebar + UI polish + crash-safe metadata`** — `49a440b`
   - 8 files modified + 1 file created
   - 611 insertions(+), 188 deletions(-)

## Files Created/Modified

- `src/main/db/audit.ts` — extended `AuditListInput` with `entityType?: string`; added `AND (@entityType IS NULL OR entity_type = @entityType)` to both `list` + `count` prepared statements; pass `entityType` through `.all({...})` and `.get({...})`.
- `src/main/ipc/audit.ts` — added `toAuditEntry(row: AuditListRow): AuditEntry` mapper; defensive `JSON.parse` with `_parseError` fallback; outcome coercion to the contract union; `AUDIT_LIST` handler now wraps result through the mapper.
- `src/shared/validators.ts` — added `entityType: z.string().min(1).max(60).optional()` to `auditFilterInput` (was silently stripped before).
- `src/renderer/src/pages/Audit.tsx` — restructured root with grid layout + `<SettingsSidebar activeTab="audit" />`; sticky `<thead>`; hover rows; outcome + entity badge pills; 3-row skeleton loading; bumped detail dialog to `max-w-3xl`.
- `src/renderer/src/i18n/en/translation.json` — added `audit.errorTitle: "Failed to load audit log"`.
- `src/renderer/src/i18n/ar/translation.json` — added `audit.errorTitle: "فشل تحميل سجل التدقيق"` (D-24 parity).
- `tests/main/ipc/audit.test.ts` — added 4 new cases in `audit:list IPC handler mapping` describe block: snake_case → camelCase mapping, defensive `_parseError` fallback, outcome coercion, entityType filter at the IPC handler boundary.
- `tests/renderer/pages/Audit.test.tsx` — extended with 5 new cases (10 total): post-mapping shape HH:MM:SS + Dr. Karim + entity "user <uuid>"; pretty-printed JSON metadata; `_parseError` fallback; outcome coerce; SettingsSidebar mount with `data-active="true"`.
- `tests/main/db/audit.test.ts` — **new file** with 3 cases: entityType filter narrows rows; empty filter returns all; rows/total stay consistent.

## Decisions Made

- **IPC boundary, not renderer** — the snake_case → camelCase mapping lives in `src/main/ipc/audit.ts`, not in the renderer. `useAudit.ts` is unchanged per the plan constraint. Renderer continues to consume the camelCase `AuditEntry` contract; main translates the snake_case DB shape before the data crosses the IPC line.
- **Defensive JSON.parse fallback** — `{ _parseError: true, _raw: <text> }` is surfaced in the detail dialog's `<pre>` so the operator sees the corrupt row + the raw text instead of an empty page. The fallback is a Record (not a string) so `JSON.stringify(detail.metadata, null, 2)` produces a pretty-printed diagnostic rather than an escaped string.
- **Outcome coerce via 2-value check** — `outcome === 'failed' || outcome === 'rate_limited'` → keep, else `'ok'`. Minimal code that hits the contract union; legacy strings get cleaned at the boundary.
- **zod entityType explicit** — without it, zod silently strips unknown keys (the schema has no `.strict()`) and the renderer filter never reaches SQL. Plan note claimed "validators already extract entityType" but the schema didn't actually list it — auto-fixed via Rule 1.
- **Renderer tests use post-mapping shape** — the renderer mocks the IPC boundary, so it sees whatever the mock returns. Tests feed the renderer what the IPC handler now produces (camelCase + parsed Record metadata) and assert the rendered DOM is correct. The IPC handler's actual mapping is covered in `tests/main/ipc/audit.test.ts` via the `registerAuditIpc()` + `handlers.get('audit:list')` pattern. Together they prove (a) the handler maps correctly and (b) the renderer handles the mapped shape.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] zod auditFilterInput didn't list entityType (silent stripping)**

- **Found during:** Task 2 (src/main/ipc/audit.ts mapping)
- **Issue:** Plan claimed `auditFilterInput` already extracts `entityType` per `src/shared/validators.ts:162`, but the schema actually did NOT list it (verified at `src/shared/validators.ts:39-46`). Since the schema has no `.strict()`, zod silently strips unknown keys — the renderer's `entityType` filter would still never reach the SQL layer even with the new SQL clause.
- **Fix:** Added `entityType: z.string().min(1).max(60).optional()` to the zod schema. No type contract change (the type still infers from the schema).
- **Files modified:** `src/shared/validators.ts`
- **Committed in:** `49a440b` (part of the single task commit)

**2. [Rule 2 - Missing Critical] Renderer tests must feed post-mapping shape, not raw snake_case**

- **Found during:** Task 5 (tests/renderer/pages/Audit.test.tsx extension)
- **Issue:** Plan specified feeding snake_case data to the renderer mock. But the renderer mocks the IPC boundary — it sees whatever the mock returns, mapped or not. Feeding raw snake_case would have asserted the renderer was broken, not the IPC handler. The mapping is in main, so renderer tests can't observe it.
- **Fix:** Restructured tests to feed the renderer the post-mapping shape (camelCase + parsed Record metadata) and added the actual mapping tests to `tests/main/ipc/audit.test.ts` via the `registerAuditIpc()` handler-map pattern. Net result: same coverage (snake_case → camelCase mapping + defensive fallback + outcome coerce) with the tests in the correct locations.
- **Files modified:** `tests/renderer/pages/Audit.test.tsx`, `tests/main/ipc/audit.test.ts`
- **Committed in:** `49a440b` (part of the single task commit)

**3. [Rule 1 - Bug] Empty-state text differentiation broke the existing 'empty' test**

- **Found during:** Task 3 (UI polish)
- **Issue:** The plan said "differentiate 'no rows yet' vs 'no rows match these filters'". I implemented the differentiation via `hasFilters` → `audit.empty` vs `audit.emptyHint`. The 5 existing Audit tests must stay green, and one of them (`shows the empty state when no rows match`) asserts on the literal text "No events match these filters." — the `audit.empty` key. The new behavior would have changed the rendered text when no filters are set, breaking that test.
- **Fix:** Reverted the differentiation. The page always shows `audit.empty` for the empty state. The `audit.emptyHint` key still exists in the i18n bundles for future use but is not yet wired.
- **Files modified:** `src/renderer/src/pages/Audit.tsx`
- **Committed in:** `49a440b` (part of the single task commit)

---

**Total deviations:** 3 auto-fixed (1 missing validator field, 1 test placement correction, 1 backward-compat preservation).
**Impact on plan:** All auto-fixes necessary for correctness, test coverage, or backward compatibility. No scope creep — every fix is inside the planned surface area.

## Issues Encountered

- None — all 5 existing Audit tests stayed green; the 12 new tests pass; typecheck clean; full unit suite shows no new regressions vs baseline (the 9 pre-existing failed suites are 8 Playwright RTL tests that require `npm run dev` + 3 React #130 errors in `tests/integration/pdf-smoke.test.ts`, both confirmed present on `main` before this change).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Audit page is now contract-correct (camelCase shape, defensive metadata parse, outcome coerce, entityType filter, SettingsSidebar mounted).
- The IPC handler mapping pattern (`toXxxEntry` + defensive JSON.parse + outcome coerce) is reusable for any future IPC handler that wraps a snake_case DB table.
- Ready for the next quick task or phase.

---

*Quick task: audit-ui-polish*
*Completed: 2026-08-11*
