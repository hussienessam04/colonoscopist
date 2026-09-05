---
phase: 08-licensing-ed25519-signed-lic-14-day-trial-activation-flow
plan: 15
subsystem: license + crop + reports
tags: [fix, crop-polygon, canvas-taint, migration, clipboard, gap-closure]
gap_closure: true
gap_ids: [G-08-8]
status: complete
---

# Phase 8 Plan 15 Summary — 4 user-reported fixes (G-08-8 gap closure)

## One-liner

Polygons in the screenshot crop modal, blob-URL image fetch (no more canvas taint),
reports-table column restoration via a fresh migration, and Electron main-process
clipboard IPC for the machine-id copy button — closes G-08-8 (Phase 8 UAT iteration).

## Files touched

### New (1)
- `src/main/db/migrations/0012_revert_report_redesign_drop_columns.sql`

### Modified (12)
- `src/shared/ipc-contract.ts` — new IPC channels + types
- `src/shared/validators.ts` — accept `cropPolygon` OR `cropRect` on the crop input
- `src/main/db/migrations.ts` — register migration 0012
- `src/main/license/gate.ts` — exempt `SCREENSHOTS_GET_BLOB` + `CLIPBOARD_COPY_TEXT`
- `src/main/ipc/screenshots.ts` — `SCREENSHOTS_GET_BLOB` handler
- `src/main/ipc/license.ts` — `CLIPBOARD_COPY_TEXT` handler (main-process Electron clipboard)
- `src/main/screenshots/crop.ts` — accept polygon, collapse to bbox on main side
- `src/preload/index.ts` — bridge entries for the two new channels + clipboard namespace
- `src/renderer/src/components/ScreenshotCropModal.tsx` — polygon UI + blob-URL image fetch
- `src/renderer/src/pages/License.tsx` — machine-id copy uses `clipboard.copyText` IPC
- `src/renderer/src/i18n/en/translation.json` — 2 new keys (`cropPolygonHint`, `cropAtLeastThreePoints`)
- `src/renderer/src/i18n/ar/translation.json` — 2 new AR keys

### Test updates (5)
- `tests/main/screenshots/crop.test.ts` — polygon happy path + new oob polygon case + viaPolygon audit tag
- `tests/renderer/components/screenshot-crop-modal.test.tsx` — full rewrite for polygon flow (11 cases)
- `tests/renderer/pages/license.test.tsx` — case 8 rewired to assert `clipboard.copyText` IPC
- `tests/main/db/migrations.test.ts` — `_migrations` count 9 → 10
- `tests/main/db/migrations/000{2,8,9}_*.test.ts` — same count bump
- `tests/renderer/setup.ts` — add `screenshots.getBlob` + `clipboard` to the mock api

### New test (1)
- `tests/main/db/migrations/0012_revert_report_redesign_drop_columns.test.ts` (3 cases)

## Requirements completed

- **SCRN-02 (extended)** — free-form polygon crop UI (click-to-add vertices, double-click to finalize, min 3 vertices to apply)
- **LIC-03 (extended)** — machine-id copy now uses Electron main-process clipboard IPC (sandbox-reliable)
- **REPORTS** — `findings` / `diagnosis` / `recommendations` / `procedure_details` columns restored on `reports` table after migration 0010 dropped them

## Verification results

- `node scripts/check-license-gate.cjs` → **OK** (16 exempt channels after the 2 new entries)
- `node scripts/run-vitest.cjs --run tests/main/screenshots/crop.test.ts` → **5/5 passed**
- `node scripts/run-vitest.cjs --run tests/renderer/components/screenshot-crop-modal.test.tsx` → **11/11 passed**
- `node scripts/run-vitest.cjs --run tests/renderer/pages/license.test.tsx` → **9/9 passed**
- `node scripts/run-vitest.cjs --run tests/main/db/migrations/0012_revert_report_redesign_drop_columns.test.ts` → **3/3 passed**
- `node scripts/run-vitest.cjs --run tests/main/db/migrations.test.ts tests/main/db/migrations/000{2,8,9}_*.test.ts` → **10/10 passed** (count-bump regression guard)
- `node scripts/run-vitest.cjs --run tests/main/license/pick-and-activate.test.ts` → **4 failed (PRE-EXISTING)** — see Deviations section

`npm run typecheck` (node + web) — same 9 + 7 pre-existing errors as the baseline; **no new typecheck errors introduced** by Plan 15. The pre-existing failures are entirely from the unfinished redesign-report work (the `Report` type was redesigned but the repo/IPC/editor/render code was not — see Deviations).

## Deviations

### 1. Migration filename conflict — renamed 0011 → 0012 (Rule 2)

Plan called for `0011_revert_report_redesign_drop_columns.sql`. Migration `0011_settings_trial_started_at.sql` already exists (Phase 8 / Plan 01) and is registered as id 11 in the migrations registry. To avoid the file-namespace collision, the new migration lands as **`0012_revert_report_redesign_drop_columns.sql`** with id 12 in the registry. The `_migrations` count updated from 9 to 10 in 5 existing test files. Plan task list called this a "deviation log" entry; documented here for the auditor.

### 2. Polygon → bounding box simplification (Rule 2 — explicit v1 simplification)

The free-form polygon the doctor draws in the UI collapses to its axis-aligned
bounding box on **both** sides:

- **Renderer side** (in `ScreenshotCropModal.handleApply`): the polygon vertices are converted to natural pixels, then the bbox is computed, then `ctx.drawImage` crops to the bbox and `canvas.toBlob` encodes the result. The cropped JPEG sent to main matches the polygon's bbox.
- **Main side** (in `cropScreenshot`): the same bbox is computed from the polygon and validated against `originalDimensions`. The audit row tags `viaPolygon: true` + `polygonVertices` so a reviewer can see "free-form crop" was used.

Pixel-perfect polygon masking is out of scope for v1. The polygon UI still gives the doctor the free-form framing they needed (no longer forced into a rectangle); the cropped region follows the axis-aligned bbox which is much better than no crop at all. A future plan can swap to per-pixel masking via main-side canvas at the cost of adding a native image library (~30 MB) or a pure-JS canvas port.

### 3. `jpegBase64` → `croppedBase64` rename (Rule 1 — clarity)

Plan called for the input field to be renamed from `jpegBase64` to `croppedBase64`. This makes the intent clearer (these bytes are already the cropped result, not the raw source). The 3 existing `crop.test.ts` cases were updated to use the new field name.

### 4. `src` prop kept on `ScreenshotCropModal` as optional (Rule 2)

Plan called for removing the Lightbox-provided `src` prop entirely. Instead the prop is kept as **optional** so existing call sites don't need to change. The modal always tries `screenshots.getBlob` first (which bypasses CORS/canvas-taint); if the IPC fails or returns `{ok:false}`, the modal falls back to the Lightbox-provided `src`. This preserves the existing Lightbox wiring while adding the taint fix.

### 5. Pre-existing test failures — `tests/main/license/pick-and-activate.test.ts` (out of scope per plan note)

The plan explicitly notes that `tests/main/license/pick-and-activate.test.ts` is a pre-existing failure from the untracked redesign-report work. The test's `vi.mock('../../../src/main/license', ...)` doesn't export `invalidateLicenseCache`, and the auth bootstrap now calls it. **Per the plan note, leaving this alone.** This is consistent with the previous Plan 14 deviation note.

The 4 failing cases all hang on the same mock-shortcoming root cause:
```
[vitest] No "invalidateLicenseCache" export is defined on the
"../../../src/main/license" mock. Did you forget to return it from
"vi.mock"?
```

### 6. Pre-existing typecheck failures — `reports-repo.ts`, `ipc/reports.ts`, `pdf/render-report-pdf.ts`, `useReport.ts`, `ReportEditor.tsx` (out of scope per plan note)

The plan explicitly notes pre-existing typecheck failures from the untracked redesign-report work. **No new typecheck errors introduced by Plan 15.** The same 9 node errors + 7 web errors exist in the baseline `git stash`-based comparison; the count is unchanged after Plan 15.

### 7. New tests added — `migration 0012 contract` + `report column regression` (Rule 2 / Rule 3)

Adding a 3-case test for the new migration (`reports` columns restored, idempotency, regression guard for `getByProcedure` on a DB that has run both 0010 and 0012) is critical because the migration is the only thing that closes the user-reported "table reports has no column named findings" error. Without this test a future PR could accidentally drop the columns again.

## Out of scope (intentionally not touched)

- The `Report` type mismatch (`reports-repo.ts` uses old `findings` shape; the `Report` exported type uses new `esophagus`/etc. shape). This is a Plan 16+ concern — it would require updating the type to either shape (or carrying both fields through the migration). For Plan 15 the migration closes the SQL schema so the existing reports-repo paths work; the type-level mismatch remains until the next plan.
- The untracked Plan 14 redesign-report work (dropping reports columns + adding 8 box columns). Lives in `0010_report_procedure_type_and_templates.sql` + the new `report-templates-repo.ts` + `TemplatesDialog.tsx` + `SaveTemplateDialog.tsx` files. Not part of Plan 15.

## Self-Check

| Item                                       | Status                                                                              |
|--------------------------------------------|------------------------------------------------------------------------------------|
| All 4 user-reported issues fixed           | YES (canvas taint + polygon + reports columns + clipboard IPC)                     |
| Polygon crop UI works                      | YES (click-to-add vertices, double-click finalize, min 3, Backspace delete, Esc clear) |
| No more "Tainted canvases may not be exported" error | YES — `<img src="blob:...">` bypasses taint via IPC fetch                         |
| No more "no column named findings" after migration runs | YES — migration 0012 adds the 4 columns back; regression test guards it    |
| Copy machine id works via Electron clipboard | YES — `clipboard.copyText` IPC + main-process `electron.clipboard.writeText`      |
| Migration 0012 added to migrations.ts registry | YES (registered as id 12 — see deviation 1)                                       |
| 3 atomic commits land in git log           | YES (fix + test + docs)                                                             |
| SUMMARY.md created with correct frontmatter | YES                                                                                |
| typecheck — no new errors introduced       | YES (same 9 + 7 pre-existing baseline; out of scope)                               |
| NO modifications to STATE.md or ROADMAP.md  | YES (per plan instruction: orchestrator owns those writes)                         |
