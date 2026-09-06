---
slug: save-changes-vs-finalize-and-rail-max-height
created: 2026-09-06
type: polish
source: ad-hoc user report (2 issues)
---

# Quick Task: Save changes vs Finalize button + max-height on screenshots rail

## Issues

1. **Conditional primary action** — currently the page shows
   BOTH "Finalize report" (when `!isFinalized`) AND "Save changes"
   (always) at the bottom. That's redundant when the doctor
   hasn't finalized yet — the right primary action is just
   "Finalize report" (which both creates the report AND
   generates the first PDF). Once a PDF exists (the report has
   been finalized at least once), the primary action flips to
   "Save changes" (regenerates the PDF with edits).
   - If `report?.pdfPath === null` (no PDF yet): show only
     "Finalize report".
   - Else (PDF exists): show only "Save changes".

2. **Screenshots rail max-height** — the screenshots rail
   (`lg:sticky lg:top-4`) can grow unbounded if there are many
   screenshots. Add a `max-h-[60vh]` (60% of viewport height)
   cap with `overflow-y-auto` so the rail stays inside the
   viewport on tall pages. The grid layout already has
   `overflow-y-auto` on the container; adding the height cap
   activates the scroll.

## Scope

- `src/renderer/src/pages/ReportEditor.tsx`:
  - The bottom button row: replace the always-both buttons
    with `report?.pdfPath === null ? <Finalize> : <SaveChanges>`.
- `src/renderer/src/components/ScreenshotTimeline.tsx`:
  - In `layout='grid'` mode, add `max-h-[60vh]` to the
    container className (currently
    `'grid grid-cols-2 gap-2 content-start overflow-y-auto
    pb-2'`).

## Verification

- 25/25 tests should still pass (testids unchanged).
- Manual: with no PDF, only Finalize is shown. After
  finalizing, only Save changes is shown.

## Out of scope

- A separate "Save as draft" button — the user can still
  rely on auto-save (300ms debounce).
- Capping the grid by row count — `max-h-[60vh]` is the
  simpler viewport-relative cap.
