---
slug: print-preview-and-input-unify
created: 2026-09-06
type: polish
source: ad-hoc user report (4 issues)
---

# Quick Task: print preview fix + Print button rename + Re-render PDF polish + unify input styles

## Issues

1. **No print preview.** Clicking Print opens the OS print
   dialog but it shows "This app doesn't support print preview".
   The hidden iframe (1×1 px at opacity 0.01) isn't large
   enough for Chromium to render a preview. Make the iframe
   visible-sized but positioned off-screen so the OS print
   dialog can preview the PDF.

2. **Print button label is misleading.** It currently says
   "Print (opens PDF)" — but after the previous quick task the
   button actually triggers the OS print dialog directly. Rename
   to "Print" + a Printer icon (already present).

3. **Re-render PDF polish.** Currently lives at the bottom of
   the document next to Finalize. Move into the screenshots
   rail so the doctor sees PDF controls + screenshots as a
   single "report assets" cluster. Style as a primary-looking
   button (teal accent matching the procedure-type toggle
   active state) so it doesn't look like a tertiary action.
   Ensure any pending auto-save fires before regenPdf runs.

4. **Unify input styles across the page.** Instrument select,
   Pre-medication input, the 8 box textareas, and the patient
   / procedure meta-row value fields all currently have
   slightly different border / padding / focus treatments.
   Standardize on one consistent input style:
   - Default: ivory tint background (`bg-[#FBF7EE]`), hairline
     border (`border-[#E0D9C6]`), 8px padding-y, 12px
     padding-x, text-sm
   - Focus: white background, teal border + 1px teal ring
   - Hover (select): teal border, no background change

## Scope

- `src/renderer/src/pages/ReportEditor.tsx`:
  - `PrintPreview` iframe: change style from `position: fixed;
    top: 0; left: 0; width: 1px; height: 1px; opacity: 0.01`
    → `position: fixed; top: 0; left: 0; width: 100vw; height:
    100vh; opacity: 0; pointer-events: none; z-index: -1`. The
    iframe renders at full viewport size (so the OS print
    preview can read it) but is invisible / non-interactive
    (so it doesn't show in the editor UI).
  - Print button label: `t('report.printButton')` is already
    "Print (opens PDF)" in EN — change to just "Print" in EN
    + AR.
  - Re-render PDF button moves into the screenshots rail
    (right column), styled as `bg-[#0E3A47] text-white
    hover:bg-[#0B2C36]`.
  - Instrument select + Pre-medication input: standardize
    input styles (see issue 4 above).

## Verification

- 25/25 tests should still pass (testids unchanged).
- Manual: click Print, verify the OS print dialog shows the
  PDF preview.

## Out of scope

- Adding a visible inline preview pane in the editor itself
  (a real "preview" area the doctor can scroll through). The
  off-screen iframe is enough for the OS print dialog.
- Custom print settings (paper size, orientation). The OS
  dialog already handles these.
