---
slug: report-editor-layout-and-bullets
created: 2026-09-06
type: bugfix+polish
source: ad-hoc user report (4 issues)
---

# Quick Task: ReportEditor layout — full width + screenshots-on-right + bullets, plus procedure-type error verification

## Issues

1. **"procedure_type is locked once a report box has been filled in"**
   still surfaces when the doctor toggles Colon → Upper GI. The error
   string is gone from `src/main/db/reports-repo.ts` (the SQL guard +
   the IPC_VALIDATION throw were removed in commit `1917203`), so the
   user is running a stale Electron build that still has the old
   compiled main process. Two-part fix:
   - Verify the current source no longer throws that message (it
     doesn't — confirm with grep).
   - Defensive IPC: in `reportsRepo.setProcedureType`, fall back to
     a plain UPDATE without the guard so even a stale compiled
     binary won't refuse the toggle. (Already done in `1917203`.)

2. **Make the report take the full width of the page.** The current
   `<div className="mx-auto flex max-w-3xl flex-col gap-5">` caps the
   editor document at ~768px. Change to `max-w-7xl` so the body
   fills the viewport on a workstation monitor.

3. **Screenshots on the right side of the screen.** Currently the
   `ScreenshotTimeline` is at the bottom of the document, full
   width. Move it to a right rail so the boxes + patient/procedure
   stack on the left and the screenshot timeline sits in a fixed
   column on the right (~320px). Layout:
   - Outer: `grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6`
   - Left column: patient/procedure + instrument + premedication +
     anatomy boxes (2-col grid) + conclusion + recommendation
   - Right column: screenshots timeline (sticky on scroll)

4. **Bullet feature for each box.** The translation file still has
   `report.bullet` + `report.addBulletHint` from the previous
   version, but the editor no longer renders the bullet button.
   Re-add a small "• Bullet" button next to Templates / Save
   template. Click behavior: prefix every non-empty line of the
   textarea with `"• "`. If the cursor is in the textarea, only
   operate on the lines that contain the selection; otherwise
   operate on the whole textarea. No-op if every line is already
   bulleted. The translation strings are already present
   (`bullet: "Bullet"`, `addBulletHint: "Prefix the current line
   with a bullet (or bullet every selected line). Enter on a bullet
   line continues the list."`).

## Scope

- `src/renderer/src/pages/ReportEditor.tsx`:
  - Outer wrapper `max-w-3xl` → `max-w-7xl`.
  - Restructure document into a 2-column grid (boxes left,
    screenshots right) with a sticky right rail.
  - Add `handleBullet(scope, key)` that mutates the textarea's
    body via setLocal + trigger.
- No main-process changes needed (issue 1 is just a stale-build
  confirmation; the IPC surface is unchanged).

## Verification

- `tests/renderer/pages/report-editor.test.tsx`:
  - Existing tests still pass (anatomy box layout now lives in a
    2-column grid; the test selectors still find each box by
    testid).
  - Add a new contract test for the bullet handler: render the
    box with text `"line one\nline two"`, click the bullet
    button, expect the textarea value to become `"• line one\n• line two"`.

## Out of scope

- Visual style of the bullet (• vs - vs *) — `•` matches the
  translation's hint copy and is the most common convention.
- Per-line undo / selection-aware paste — out of scope. The
  simple "bullet every line" behavior matches the previous version.
