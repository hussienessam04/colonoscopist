---
slug: pdf-report-editor-fixes
created: 2026-09-07
type: bugfix+polish
status: complete
---

# Summary: PDF + Report Editor fixes — 8 issues from the doctor

## Outcome

All 8 issues from the doctor's ad-hoc report addressed:

1. **Footer pinned to the bottom of every page.** The band
   now uses `position: 'absolute', bottom: 32, fixed: true`
   so it sits at the bottom of every page (not just the
   last). Page `paddingBottom` bumped from 32 to 124 so body
   content doesn't slide under the pinned band.

2. **Anatomy textbox border dropped.** Boxes now have only
   padding + `marginBottom` spacing — no visible rectangle
   outline. Matches the reference image where the boxes are
   separated by gaps, not lines.

3. **Profile header/footer images now render in the PDF.**
   Root cause was a path-resolution mismatch: `writeProfileAsset`
   stored `data/profiles/<userId>/<filename>` (full
   userData-relative path) but the PDF render called
   `profileAssetPath(userId, rel)` which joins that path with
   `<userData>/data/profiles/<userId>/` → nested
   `<userData>/data/profiles/<userId>/data/profiles/<userId>/<filename>`
   that never resolved. Fix: resolve via
   `path.join(userData, profile.X.split('/').join(path.sep))`
   the same way `PROFILE_GET_ASSET_DATA_URL` does. Dropped
   the `profileAssetPath` import (no longer used).

4. **Line above signature removed.** `signatureBlock` lost
   its `borderTopWidth` + `borderColor`. The `signatureLine`
   child keeps its own `borderTopWidth` (the underline the
   doctor signs on).

5. **"Signature:" label added.** A bold `Signature: `
   (`التوقيع: ` in AR) now renders before the signature line
   so the section is self-describing.

6. **CRITICAL DATA-LOSS BUG FIXED.** Typing in a textbox and
   clicking "Finalize report" used to delete the typed text
   from the PDF. `handleFinalize` was calling
   `reports.finalize` + `reports.regenPdf` directly without
   flushing the local box-field edits via `updateDraft`.
   The regen read from the DB (which had empty box fields),
   so the typed text vanished. Extracted a `flushBoxEdits`
   helper that both `handleFinalize` and `handleRegenPdf`
   now call before `regenPdf`.

7. **Pre-medication defaults from profile.** Input pre-fills
   with `report.premedicationOverride ?? doctorProfile?.premedication ?? ""`.
   Auto-saves the default to the DB on first render (via a
   one-shot `useEffect` guarded by `instrumentAutoSaved` /
   `premedicationAutoSaved` flags) so the value sticks across
   page reloads.

8. **Instrument defaults to first device.** Same pattern as
   #7: the `<select>` value falls back to `usedDevices[0].id`
   when `report.instrument === null`. Auto-saves to DB on
   first render.

9. **Bullet logic fixed.** The add branch was prepending
   `• ` to every non-empty line; when the textarea had a mix
   of bulleted + non-bulleted lines, this produced `• • foo`
   for lines that were already bulleted. The fix: skip lines
   that already match `/^\s*•\s*/` so we never prepend twice.
   The un-bullet branch is unchanged (still idempotent — only
   strips the existing prefix per line).

## What changed

**`src/main/pdf/report.tsx`**:

- `FOOTER_BAND_STYLE`: `position: 'absolute', bottom: 32,
  left: 32, right: 32, height: 80, backgroundColor: '#E6EFF1',
  padding: 4` (was: `width: '100%', marginTop: 6`).
- `page` + `pageRtl.paddingBottom`: 32 → 124 (footer band
  height + gap).
- `anatomyBox`: dropped `borderWidth` + `borderColor`. Kept
  `padding: 6, marginBottom: 4`.
- `signatureBlock`: dropped `borderTopWidth` + `borderColor`.
  Kept `paddingTop: 6, paddingBottom: 6, marginBottom: 6`.
- Added `signatureLabel` style (`fontSize: 10, fontWeight:
  'bold', marginRight: 6`).
- Footer band render: added `fixed: true`.
- Signature block render: added a bold `Signature: ` /
  `التوقيع: ` Text element before the signature line.

**`src/main/pdf/render-report-pdf.ts`**:

- Dropped `profileAssetPath` import.
- Added a `userData` constant + inline `resolveAsset(rel)`
  helper. `signatureBox` / `headerBox` / `footerBox` now use
  the helper instead of `profileAssetPath`.
- Existing `userData` declaration further down (for the
  pdfPath writeback) was removed; the new declaration is
  reused by the existing writeback code.

**`src/renderer/src/pages/ReportEditor.tsx`**:

- `handleBullet` add branch: skip lines that already match
  `/^\s*•\s*/`.
- New `flushBoxEdits` helper (mirrors the patch logic in
  `handleRegenPdf`).
- `handleFinalize` now calls `await flushBoxEdits()` before
  `reports.finalize` + `reports.regenPdf`.
- `handleRegenPdf` now calls `await flushBoxEdits()` before
  `reports.regenPdf` (uses the same shared helper).
- `premedicationInput` initialization uses
  `report.premedicationOverride ?? doctorProfile?.premedication ?? ""`.
  New `useEffect` auto-saves the default to the DB on first
  render (guarded by `premedicationAutoSaved`).
- Instrument `<select>` `value` falls back to
  `usedDevices[0].id` when `report.instrument === null`.
  New `useEffect` auto-saves the default to the DB on first
  render (guarded by `instrumentAutoSaved`).

## Diff stat

```
 src/main/pdf/render-report-pdf.ts       |  26 ++++-
 src/main/pdf/report.tsx                 |  75 +++++++++++---
 src/renderer/src/pages/ReportEditor.tsx | 175 +++++++++++++++++++++++++++-----
 3 source files changed, +230/-46 (net +184)
```

## Verification

- `npm run typecheck` (node + web) → exits 0, no errors.
- `npx vitest run tests/renderer/pages/report-editor.test.tsx`
  → 10/10 pass.
- Manual checklist:
  - Type into a box → click Finalize → PDF shows the typed
    text (was empty before fix #6).
  - Open profile editor → set Premedication → save → open a
    fresh report editor → Pre-medication input pre-filled
    with the profile value (was empty before fix #7).
  - Open profile → add a used device → open a fresh report
    editor → Instrument select shows the first device
    selected (was "None" before fix #8).
  - Click bullet toggle on a textarea with mixed bullets →
    no double-bullets (was producing `• • foo` before fix
    #9).
  - Upload a header image + footer image in Profile →
    finalize a report → open PDF → both bands show the
    uploaded image (was empty before fix #3).
  - Open the PDF → footer band sits at the very bottom of
    the page (not pushed up by body content) and on every
    page when the body overflows.
  - No rectangle borders around the anatomy boxes (just
    spacing between them).
  - Signature block shows "Signature: " label followed by
    the signature line + printed doctor name; no separator
    line above it.

## Files

- `src/main/pdf/report.tsx` — band always-pinned + anatomy
  no border + signature label.
- `src/main/pdf/render-report-pdf.ts` — path resolution fix
  + signature/header/footer assets.
- `src/renderer/src/pages/ReportEditor.tsx` — flushBoxEdits
  + premed default + instrument default + bullet fix.
- `.planning/quick/20260907-pdf-report-editor-fixes/PLAN.md`
  — plan.
- `.planning/quick/20260907-pdf-report-editor-fixes/SUMMARY.md`
  — this file.

## Commit

`f409a29 fix(pdf+editor): 8 fixes — footer pinned, no textbox border, header/footer path, signature label, finalize flush, premed/instrument defaults, bullet logic`