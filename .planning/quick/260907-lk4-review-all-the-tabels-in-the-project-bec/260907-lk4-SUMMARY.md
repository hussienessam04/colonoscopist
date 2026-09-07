---
task: pagination-fixes-across-tables
status: complete
files_modified:
  - src/renderer/src/pages/PatientProcedures.tsx
  - src/renderer/src/pages/PatientsList.tsx
  - src/renderer/src/pages/Audit.tsx
  - src/renderer/src/hooks/useAudit.ts
  - src/renderer/src/i18n/en/translation.json
  - src/renderer/src/i18n/ar/translation.json
key_decisions:
  - PatientProcedures uses a `PAGE_SIZE = 25` constant (no PageSizeSelector on this page) — keeps the dep surface smaller than wiring unused state.
  - useAudit hook fix is included: prev/next clicks previously did NOT refetch the IPC because `useEffect([refresh])` only fired once on mount (refresh identity is stable). Fixed by adding `page` + `pageSize` as direct useEffect deps and removing the now-dead `pageRef` + `pageSizeRef`. `filtersRef` kept because the parent rebuilds the filters object every render.
  - Auto-clamp useEffect added to PatientsList + Audit + PatientProcedures — guards against the "user deletes last row on page N → empty page → only Previous helps" trap. Runs after every render where `total`/`page`/`pageSize` change; safe re-entrancy (only mutates page when an actual clamp is needed).
  - `totalPages` collapses to 0 (instead of `Math.max(1, ceil(0/25))` = 1) when total = 0 — fixes the misleading "Page 1 of 1" / "Showing 0-0 of 0" surfaces. Footer copy falls back to "No patients" / "No events" / "No procedures".
deviations: none
---

# Pagination Fixes Across Tables — Summary

Three distinct pagination bugs surfaced during the user's "review all the tables" pass on the colonoscopist app, and all three are fixed in this single commit (`a20eb88`). **Bug 1 (PatientProcedures silent data loss):** the page fetched `pageSize: 200` once on mount and never re-fetched — anything above the 200th procedure was unreachable, with no UI signal. Now the page passes real `page` + `pageSize` (= 25) to `procedures.list()`, renders a footer with `patient-procedures-pagination-range` + `patient-procedures-prev` + `patient-procedures-next`, and auto-clamps `page` when `total` shrinks. **Bug 2 (PatientsList + Audit stuck on empty page):** deleting the last row on page N leaves `page = N` while `totalPages` collapses to N-1; the user sees an empty table with no way forward. Added a defensive `useEffect` on each page that watches `total` + `page` + `pageSize` and snaps `page` back to a valid value. **Bug 3 (the "Page 1 of 1" lie):** `Math.max(1, ceil(total / pageSize))` mis-reports a non-empty pager on empty data; replaced with `total === 0 ? 0 : Math.ceil(...)` across all three pages, with the range footer falling back to a "No X" copy. **Task 3 — useAudit hook fix applied:** `Audit.test.tsx` exercises prev/next click → IPC refetch in zero places (the closest test only fires `change` on the action input, which resets `page` to 1 — but goes through a different code path), so the lazy-ref pattern was hiding a real silent bug where clicking prev/next updated React state but never refetched the audit log. Fixed by adding `page` + `pageSize` as direct `useEffect` deps and removing the now-dead `pageRef`/`pageSizeRef` (primitives don't need the lazy ref); `filtersRef` kept because the parent rebuilds the filters object every render.

## Test verification

- `npm run typecheck:web` → ✅ pass
- `npm run typecheck:node` → ✅ pass
- `tests/renderer/i18n/parity.test.ts` → ✅ 5/5 pass (EN↔AR key coverage enforced)
- `tests/renderer/pages/PatientProcedures.test.tsx` → ✅ 13/13 pass (the existing pagination-related testid assertions still match)
- `tests/renderer/pages/Audit.test.tsx` → ✅ 10/10 pass (the hook fix did not regress D-08's audit_view debounce contract — the lazy `refresh` callback identity is preserved, only `page`/`pageSize` are new direct deps)
- `tests/renderer/pages/patients-list.test.tsx` → ✅ 15/15 pass, including the existing "pagination footer uses the 'Showing X-Y of Z' range format" test that asserts `Showing 1-25 of 50` (the empty-state branch only fires when `total === 0`, so the existing format is untouched)
- Full unit suite: 862 pass, 10 fail (all 10 are pre-existing failures unrelated to pagination: `tests/renderer/rtl/*` Playwright runner mismatch, `tests/main/license/*` mock gap, `tests/integration/*` PDF lib API drift + vendor key constant). No new regressions.

## Plan verify checklist (excerpt)

- `pageSize: 200` no longer appears in `PatientProcedures.tsx` → ✅
- `patient-procedures-pagination-range` + `patient-procedures-prev` + `patient-procedures-next` testids added → ✅
- All existing data-testids preserved (`pagination-range`, `audit-pagination`, `audit-prev`, `audit-next`, full PatientProcedures surface) → ✅
- `Math.max(1, Math.ceil(...))` removed from PatientsList + Audit → ✅
- `setPage((p) => Math.max(1, p - 1))` prev button handlers preserved → ✅
- `pageRef` + `pageSizeRef` removed from `useAudit.ts` → ✅

## Task 3 finding (hook refetch)

**The hook fix WAS needed.** `Audit.test.tsx` does not click `audit-prev` / `audit-next` and assert that `audit.list` was called with the new page number — none of the 10 tests cover the prev/next → IPC refetch flow. The lazy-ref pattern in the previous `useAudit` hid the bug: `useCallback([])` makes the `refresh` identity stable, so `useEffect([refresh])` only fired on mount; clicking prev/next updated the page state but `refresh()` was never called again. After the fix the deps are `[refresh, page, pageSize]` — when the user clicks next, the page state changes, the effect re-fires, and `audit.list` is called with the new page.
