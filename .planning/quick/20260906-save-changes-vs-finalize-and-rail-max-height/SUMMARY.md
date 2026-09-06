---
slug: save-changes-vs-finalize-and-rail-max-height
status: complete
---

# Quick Task Summary: save-changes-vs-finalize-and-rail-max-height

## Outcome

Two polish fixes in `f733ce6`:

1. **Conditional primary action** — the bottom of the document
   showed both "Finalize report" AND "Save changes" at the
   same time (Finalize when `!isFinalized`, Save changes
   always). Now shows one or the other based on the report's
   PDF state:
   - `report?.pdfPath === null` (no PDF yet) → "Finalize report"
     (coral). Creates the report row, locks the procedure,
     and generates the first PDF.
   - else (PDF exists) → "Save changes" (teal). Regenerates
     the PDF with any post-finalize edits.

   The Finalize button moved OUT of the document (where it
   previously sat under the save indicator) so the document
   body no longer competes with the bottom action.

2. **Rail max-height** — the screenshots grid was growing
   unbounded as the doctor attached more screenshots. Cap at
   `max-h-[60vh]` + `overflow-y-auto` so the rail stays inside
   the viewport on tall pages. The grid layout already had
   `overflow-y-auto` on the container; adding the height cap
   activates the scroll.

## Diff

- `src/renderer/src/pages/ReportEditor.tsx`:
  - Dropped the `<div className="mt-3 flex flex-wrap items-center gap-2">`
    containing the in-document Finalize button.
  - Replaced the standalone Save changes button with a
    conditional:
    ```tsx
    {report?.pdfPath === null ? (
      <Button ... onClick={handleFinalize}>Finalize</Button>
    ) : (
      <Button ... onClick={handleRegenPdf}>Save changes</Button>
    )}
    ```
- `src/renderer/src/components/ScreenshotTimeline.tsx`:
  - In `layout='grid'` mode, container className gains
    `max-h-[60vh]`: `'grid max-h-[60vh] grid-cols-2
    gap-2 content-start overflow-y-auto pb-2'`.

## Verification

- 25/25 tests pass (10 report-editor + 15 ScreenshotTimeline).
- `npm run typecheck` (both node + web) → exits 0.

## Notes

- The conditional key is `report?.pdfPath === null`, which
  reads "no PDF on disk yet". After the first Finalize (which
  triggers `regenPdf` → writes the PDF), `pdfPath` is
  populated and the action flips to "Save changes".
- Coral vs teal keeps the visual cue distinct:
  - Coral `Finalize report` = "irreversible state transition"
  - Teal `Save changes` = "save my edits to disk"
- `max-h-[60vh]` keeps the rail in the upper 60% of the
  viewport — the bottom 40% stays for the document body +
  the bottom action button, so the rail never visually
  competes with them.
- The Finalize button is no longer reachable from inside
  the document body. It only renders at the very bottom of
  the page when `pdfPath === null`. After finalization, the
  same bottom slot hosts "Save changes" instead.
