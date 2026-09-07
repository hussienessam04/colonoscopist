---
slug: pdf-report-editor-fixes
created: 2026-09-07
type: bugfix+polish
source: ad-hoc user report (8 issues)
---

# Quick Task: PDF + Report Editor fixes — 8 issues from the doctor

## Issues

1. **Footer needs to be always at the end of the page.** The
   current footer band is the last element in the body flow, so
   it slides down when the body grows. On multi-page reports
   the footer appears only on the last page (if at all). Fix:
   wrap the footer band in `position: 'absolute', bottom: 0,
   fixed: true` so it pins to the bottom of every page.
   Bump `page.paddingBottom` (and `pageRtl.paddingBottom`) by
   the footer height so the body content doesn't slide under
   it.

2. **Remove the border from the text boxes.** Drop
   `borderWidth` + `borderColor` from the `anatomyBox` style.
   The boxes still have `padding` + `marginBottom` spacing
   between them so they remain visually distinct, just
   without the visible rectangle outline. Matches the
   reference image where the boxes are separated by gaps,
   not lines.

3. **Profile header/footer upload seems broken — the PDF
   can't find the images the doctor uploaded.** Root cause:
   `writeProfileAsset` stores the FULL userData-relative
   path (e.g. `data/profiles/<userId>/header.png`) in the DB
   column, but the PDF render calls `profileAssetPath(userId,
   relPath)` which expects `relPath` to be a filename and
   joins it with `<userData>/data/profiles/<userId>/`. The
   join produces the wrong nested path and `readImageBox`
   returns null → the band renders empty.
   Same bug also breaks signature/logo PDF rendering (the
   PROFILE_GET_ASSET_DATA_URL handler bypasses it by using
   `path.join(userData, relPath)` directly). Fix: in
   `render-report-pdf.ts`, resolve each asset via
   `path.join(userData, profile.X.split('/').join(sep))`
   the same way `PROFILE_GET_ASSET_DATA_URL` does. This
   matches the stored format without changing the storage
   shape.

4. **Remove the line between screenshots and signature.**
   The current `signatureBlock` style has
   `borderTopWidth: 1` + `borderColor: '#cbd5e1'` (a thin
   gray line above the signature area). Remove it. Keep
   the `signatureLine` borderTopWidth (that's the underline
   the doctor signs on).

5. **Add the word "Signature" to the signature area.**
   Render a "Signature:" label (bold) next to the signature
   line so the section is self-describing.

6. **CRITICAL DATA-LOSS BUG: typing in a text box, then
   clicking "Finalize report", erases what the doctor just
   typed.** `handleFinalize` calls `reports.finalize` and
   then `reports.regenPdf` directly, but it does NOT flush
   the local box-field edits via `updateDraft` /
   `updateFinalized`. The PDF regen reads from the DB, which
   still has empty box fields for a freshly-finalized report
   → the doctor's typed text vanishes from the PDF. Fix:
   extract a `flushBoxEdits()` helper (mirrors the patch
   logic in `handleRegenPdf`) and call it BEFORE
   `reports.finalize` inside `handleFinalize`.

7. **Pre-medication should default to the profile's
   premedication when the report has no override yet.**
   Currently `premedicationInput` initializes from
   `report.premedicationOverride ?? ""` — so the input
   shows empty until the doctor types. Change the
   initializer to
   `report.premedicationOverride ?? doctorProfile?.premedication ?? ""`.
   Auto-save the override on first display so the DB has
   the value (otherwise the PDF would render with no
   premedication until the doctor explicitly saves).

8. **Instrument should default to the first device in the
   profile's used-devices list.** Same pattern as #7.
   Pre-select the first device when `report.instrument ===
   null` and `usedDevices.length > 0`. Auto-save on first
   display.

9. **Bullet logic in the textareas is broken.** Current
   `handleBullet` does:
   ```js
   const next = allBulleted
     ? lines.map((line) => line.replace(/^\s*•\s*/, '')).join('\n')
     : lines.map((line) => (line === '' ? '' : `• ${line}`)).join('\n');
   ```
   When the textarea has a MIX of bulleted and non-bulleted
   lines (e.g. `• foo\nbar`), `allBulleted` is false (because
   `bar` doesn't match `/^\s*•\s*/`), so the toggle goes to the
   "add bullet" branch and prepends `• ` to EVERY non-empty
   line — producing `• • foo\n• bar` (double bullet on `foo`).
   Fix: in the add branch, skip lines that already match
   `/^\s*•\s*/` so we don't double-bullet.

## Scope

- `src/main/pdf/report.tsx`:
  - Footer band: add `position: 'absolute', bottom: 0,
    left: 0, right: 0, fixed: true` (still 80px tall).
  - Bump `page.paddingBottom` (and `pageRtl.paddingBottom`)
    from 32 to 112 to leave room for the footer.
  - Drop `borderWidth` + `borderColor` from `anatomyBox`.
  - Drop `borderTopWidth` + `borderColor` from
    `signatureBlock`.
  - Add a "Signature:" label render in the signature block
    (bold, EN + AR via the existing `isAr` branch).

- `src/main/pdf/render-report-pdf.ts`:
  - Resolve the signature / header / footer image paths
    directly via `path.join(userData, profile.X.split('/').join(path.sep))`
    (matches `PROFILE_GET_ASSET_DATA_URL` and the stored
    DB format).

- `src/renderer/src/pages/ReportEditor.tsx`:
  - Extract a `flushBoxEdits()` helper.
  - Call it inside `handleFinalize` before `reports.finalize`.
  - Update `premedicationInput` initial value to fall back
    to `doctorProfile?.premedication`.
  - Update instrument `<select>` to fall back to the first
    `usedDevices` id; auto-save the override on first display
    when both report.premedicationOverride and
    report.instrument are null but the defaults are non-null.
  - Fix `handleBullet` add-branch: skip lines that already
    match `/^\s*•\s*/`.

## Verification

- `npm run typecheck` (node + web) → exits 0.
- `report-editor.test.tsx` → 10/10 still pass.
- Manual:
  - Type into a box → click Finalize → PDF shows the typed
    text (was empty before fix #6).
  - Open profile editor → set Premedication → save → open
    a fresh report editor → Pre-medication input pre-filled
    with the profile value (was empty before fix #7).
  - Open profile → add a used device → open a fresh report
    editor → Instrument select shows the first device
    selected (was "None" before fix #8).
  - Click bullet toggle on a textarea with mixed bullets
    → no double-bullets (was producing `• • foo` before
    fix #9).
  - Upload a header image + footer image in Profile →
    finalize a report → open PDF → both bands show the
    uploaded image (was empty before fix #3).
  - Open the PDF → footer band sits at the very bottom of
    the page (not pushed up by body content) and on every
    page when the body overflows.
  - No rectangle borders around the anatomy boxes (just
    spacing between them).

## Out of scope

- The Doctor Profile editor itself; the bug is in the
  PDF render path, not the upload path.
- Header pinned to every page (only the footer is fixed;
  the header stays in the body flow on the first page
  per the reference image).
- Migrating existing DB rows that might have inconsistent
  `headerImagePath` / `footerImagePath` values (clinic
  workstation, single user — re-upload fixes the row).