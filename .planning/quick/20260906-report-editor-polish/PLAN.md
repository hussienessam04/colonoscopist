---
slug: report-editor-polish
created: 2026-09-06
type: bugfix+polish
source: ad-hoc user report (6 issues)
---

# Quick Task: ReportEditor polish — i18n keys, unlock procedure-type, editable-after-finalize, drop logo header, flex boxes, PDF header/footer images

## Issues

The previous quick task (`finish-report-redesign-integration`) shipped
the procedure-type toggle + 8 boxes + instrument/premedication/templates
picker, but the editor has six follow-up issues the doctor is hitting
in daily use:

1. **Missing i18n keys render as raw dotted paths.** The labels show
   `common.patient`, `common.name`, `common.mrn`, `common.dob`,
   `common.gender`, `common.procedure`, `common.date`,
   `common.duration`, `common.doctor` because the translation files
   only have `common.patient` + `common.report` etc. — not the
   sub-keys I used. Fix: add `common.name`, `common.mrn`,
   `common.dob`, `common.gender`, `common.procedure`, `common.date`,
   `common.duration`, `common.doctor` to both EN + AR.

2. **Procedure-type toggle is locked once any box is non-empty.**
   The user wants to be able to change procedure-type at any time
   (the boxes just re-render against the new type). Fix:
   - Drop the SQL empty-state invariant from
     `reportsRepo.setProcedureType` (the guard was too aggressive
     — the doctor's first edit can still pick freely, and later
     edits can flip the type at will).
   - Drop the `disabled={boxesLocked}` on the segmented control +
     the "Type is locked once any box is filled in" hint.

3. **After finalize, every field is `disabled` (textareas, instrument
   select, premedication input).** The doctor expects post-finalize
   edits to keep working — that's what the IPC `updateFinalized`
   channel exists for. Fix: drop `disabled={isFinalized}` from all
   inputs. `useAutoSave` already routes draft → finalized through
   the right IPC channel based on `report.status`. The "Finalized"
   badge + the four post-finalize-only buttons (Print / Open PDF /
   Reveal / Re-render) still gate the post-finalize-only affordances.

4. **Drop the editor's logo + signature header band** at the top of
   the document preview. The doctor doesn't want to see the logo
   placeholder / signature thumbnail in the editor — they only
   matter on the PDF. The PDF header is still rendered (it shows
   on the rendered document — that's separate from the editor UI).
   The "pageTitle" + "pageKicker" + Finalized badge in the editor
   header stay.

5. **Boxes should be a 2-column flex layout.** Currently each
   anatomy box stacks vertically. Wrap anatomy boxes (excluding
   the always-on Conclusion + Recommendation) in a 2-column grid
   so the page fits more on screen. Use CSS grid (`grid grid-cols-1
   md:grid-cols-2 gap-x-4`) so the layout collapses to one column on
   mobile widths.

6. **PDF doesn't show the actual header/footer IMAGE bands.**
   The doctor uploaded a header image + footer image in
   Settings → Profile, but the rendered PDF shows the same text
   "header" (logo placeholder + clinic name + signature + date) as
   the editor. Fix:
   - Verify the orchestrator resolves `headerBox` / `footerBox`
     from the profile assets. The current code does load them but
     the test PDF apparently shows nothing. Trace the chain:
     `render-report-pdf.ts` → `readImageBox(profileAssetPath(...))`
     for header/footer (separate from logo + signature).
   - The header image is currently the first child of the page
     (above the patient block). The footer image is the last
     child (below the footer). Both render at fixed positions
     (full-width bands).
   - If the doctor has uploaded the assets and the PDF still
     doesn't render them, surface the "header not uploaded" state
     prominently so the doctor can verify in Settings → Profile.

## Scope (smallest working diff)

- `src/renderer/src/i18n/en/translation.json` + AR equivalent: add
  the 8 missing `common.*` keys.
- `src/renderer/src/pages/ReportEditor.tsx`:
  - Drop the `boxesLocked` derivation + the `disabled={boxesLocked}`
    on the procedure-type buttons.
  - Remove the "Type is locked once any box is filled in" hint.
  - Drop `disabled={isFinalized}` from textareas, instrument
    select, premedication input. Keep the segmented control /
    templates / save-template buttons enabled post-finalize too
    (the doctor can fix typos).
  - Drop the logo + signature header band (the `<div className="mb-5 flex items-start justify-between border-b border-slate-200 pb-4">`
    block).
  - Wrap anatomy boxes in a 2-column grid (`grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0`); keep Conclusion + Recommendation
    full-width below.
- `src/main/db/reports-repo.ts`: drop the empty-state invariant
  from `setProcedureType` SQL. The new SQL: `UPDATE reports SET
  procedure_type = @procedure_type, updated_at = @now WHERE id =
  @id`.
- `src/renderer/src/i18n/{en,ar}/translation.json`: drop the
  `procedureTypeLockedHint` key (no longer used) + the
  "Type is locked once any box is filled in." copy.
- `src/main/pdf/render-report-pdf.ts` + `report.tsx`: trace the
  header/footer image chain — verify the assets load + render at
  the expected positions. Add an inline `<Text>` "Header image not
  uploaded — upload in Settings → Profile → Assets" when
  `headerBox === null` so the doctor knows why the band is empty.

## Out of scope

- The visual style of the PDF (dark-blue header band, Arabic footer
  copy) — flagged as a follow-up in the original SUMMARY.
- The procedure-type toggle now allows free toggling at any time;
  the doctor's old finalized reports may end up with a procedure
  type that doesn't match the boxes they typed. This is
  intentional — the doctor is in charge.
