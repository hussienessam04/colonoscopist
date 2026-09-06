---
slug: report-editor-procedure-layout-screenshots-grid-bullet-button
created: 2026-09-06
type: polish
source: ad-hoc user report (3 issues)
---

# Quick Task: ReportEditor — procedure data row + screenshots grid layout + bullet button inside the box

## Issues

1. **Procedure data stacked vertically.** The Date / Duration /
   Doctor lines render with `flex flex-col gap-2` so each on its
   own row. The doctor wants them side-by-side (one row, three
   columns).

2. **Duration formatter is timezone-dependent.** `formatHHMMSS`
   uses `new Date(ms).getHours()` which is local-time, so the
   displayed duration can drift by the doctor's UTC offset. For
   a procedure of 2 hours, `new Date(7200000).getHours()` returns
   `2` in UTC but `5` in Asia/Tokyo (UTC+9). The user noticed the
   "wrong" duration. Fix: replace with a pure seconds → HH:MM:SS
   computation that has no timezone dependency.

3. **Screenshots overflow horizontally in the right rail.** The
   ScreenshotTimeline container is `flex overflow-x-auto` — a
   horizontal scroll inside a 320px column is unusable. The
   doctor wants the thumbnails to wrap into a vertical grid that
   fills the rail's available height. Fix: in the right rail, wrap
   each thumbnail in a 2-column vertical grid (320px / 2 = ~150px
   per cell — enough for the existing 120×110 thumbnail).

4. **Bullet button should sit inside the box.** Currently the
   `• Bullet` button is in the heading row next to Templates /
   Save template, which clutters the heading. Move it into the
   box itself — a small icon-only button anchored at the
   top-right of the textarea, plus a thin row of helper text
   underneath.

## Scope

- `src/renderer/src/pages/ReportEditor.tsx`:
  - Procedure data row: `flex flex-col gap-2` → `grid
    grid-cols-3 gap-x-4 gap-y-1` with `text-xs uppercase
    tracking-wider text-slate-500` labels + the value below.
  - Drop the `formatHHMMSS` function. Use `formatDuration(s)`
    helper that does pure math (`s = hh*3600 + mm*60 + ss`).
  - Bullet button moves into the box: rendered as a small
    `absolute top-1 right-1` button inside the textarea wrapper,
    with a thin hint line below the textarea (`t('report.addBulletHint')`)
    that explains the toggle.
  - Right-rail screenshot container: change the
    ScreenshotTimeline container class to `grid
    grid-cols-2 gap-2 content-start` (or pass a new prop).
- `src/renderer/src/components/ScreenshotTimeline.tsx`:
  - Add an optional `layout?: 'row' | 'grid'` prop (default
    `'row'` for backward compat with ProcedureReview + the report
    editor when `layout !== 'grid'`).
  - `layout='grid'` renders a 2-column vertical grid with no
    overflow-x-auto.

## Verification

- `tests/renderer/pages/report-editor.test.tsx`:
  - Add a test asserting the procedure data row uses 3 columns
    (e.g. `getAllByText` on three `<span>`s, or check the
    container's className includes `grid-cols-3`).
  - Update the bullet test if needed (button is now found via
    `data-testid="report-editor-bullet-{scope}"` — still works).
  - Update the procedure-type / anatomy-box tests if they rely on
    the old heading row.

## Out of scope

- Changing the bullet behavior (still idempotent toggle).
- Adding more bullet characters (• vs - vs *) — `•` only.
- Changing the ScreenshotTimeline row layout outside the report
  editor.
