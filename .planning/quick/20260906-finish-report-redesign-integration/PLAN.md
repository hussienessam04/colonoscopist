---
slug: finish-report-redesign-integration
created: 2026-09-06
type: bugfix
source: ad-hoc user report
---

# Quick Task: finish report-redesign integration (header/footer + procedure-type toggle + 8 boxes)

## Bug

Report editor shows the OLD UI (Findings + Diagnosis textareas) and the
PDF renders the OLD shape. The redesigned UI (procedure-type toggle,
8 procedure-type-specific boxes, instrument picker, premedication
override, saved-text-templates picker, header/footer images) was
written in 20260812-redesign-report-procedure-type but the integration
was never finished — most files were written to disk but never
committed, and the files that WERE committed don't wire to the new
shape.

## State of the world (this morning)

**Committed but broken (references new shape, uses old shape):**
- `src/shared/ipc-contract.ts` — new Report shape (8 boxes +
  procedureType + instrument + premedicationOverride)
- `src/shared/validators.ts` — new schemas
- `src/preload/index.ts` — new IPC exposed
- `src/main/db/migrations.ts` — references 0010 SQL (file on disk
  but untracked)
- `src/main/ipc/reports.ts` — setProcedureType handler calls
  `reportsRepo.setProcedureType` which DOES NOT EXIST
- `src/main/ipc/report-templates.ts` — fully wired
- `src/main/index.ts` — registers reportTemplates IPC
- `src/renderer/src/hooks/useReport.ts` — still uses old
  `findings/diagnosis/recommendations/procedureDetails` fields
- `src/renderer/src/pages/ReportEditor.tsx` — still has Findings +
  Diagnosis textareas
- `src/main/pdf/render-report-pdf.ts` + `report.tsx` — still read old
  fields

**Untracked but written (need to commit):**
- `src/main/db/migrations/0010_report_procedure_type_and_templates.sql`
- `src/main/db/report-templates-repo.ts`
- `src/renderer/src/components/SaveTemplateDialog.tsx`
- `src/renderer/src/components/TemplatesDialog.tsx`
- `src/renderer/src/hooks/useReportTemplates.ts`
- `src/renderer/src/lib/pdf-locked-error.ts`
- `tests/renderer/lib/pdf-locked-error.test.ts`

## Fix plan (atomic commits)

1. **commit 1: commit the untracked files** — all the redesign pieces
   sitting on disk. Migration, repos, dialogs, hook, pdf-locked-error
   helper + its test. Lets the rest of the codebase reference them.

2. **commit 2: add missing repo methods on reportsRepo** —
   `setProcedureType`, `setInstrument`, `setPremedicationOverride`,
   plus update `updateDraft` / `updateFinalized` to write the 8 new
   box columns instead of the old 4. The `setProcedureType` guard
   uses the empty-state invariant (procedure_type still 'colon' AND
   every box = '') so it's idempotent on first edit only.

3. **commit 3: useReport hook — switch ReportEditableFields to the 8
   boxes**. The hook currently Pick<Report, 'findings' | 'diagnosis'
   | 'recommendations' | 'procedureDetails'> — these fields no
   longer exist on Report, so the Pick produces `never`. Replace
   with the 8 box keys.

4. **commit 4: ReportEditor rewrite** — header band (logo + clinic
   name + signature), instrument picker (usedDevices dropdown),
   premedication input (defaults to profile.premedication, override
   stored on report), procedure-type segmented control (editable
   until any box non-empty), anatomy boxes (colon/ileum OR
   esophagus/stomach/pylorus/duodenum based on procedureType) +
   conclusion + recommendation, per-box Templates dropdown + Save
   current as template, signature footer. Uses the new Templates +
   SaveTemplate dialogs (commit 1). The auto-save path now writes
   the 8 box fields instead of the old 4.

5. **commit 5: PDF render + template** — `render-report-pdf.ts`
   resolves `instrumentLabel` via usedDevices lookup + falls back
   on `report.premedicationOverride ?? profile.premedication`,
   then passes the 8 box fields + procedureType to `report.tsx`.
   `report.tsx` switches anatomy boxes by procedureType; always-on
   conclusion + recommendation.

6. **commit 6: i18n** — EN + AR keys for procedure-type labels
   (Colonoscopy / Upper GI endoscopy), 8 box labels, instrument
   label, premedication label, template picker affordances,
   pdf-locked-error toast copy.

7. **commit 7: tests** — update `tests/renderer/setup.ts` MockApi to
   expose `setProcedureType` / `setInstrument` /
   `setPremedicationOverride` / `reportTemplates.*`. Add new
   contract-guard tests on ReportEditor for the procedure-type
   toggle, anatomy-box rendering per type, instrument picker,
   templates picker.

## Out of scope

- Visual polish on the PDF (dark-blue header band, Arabic footer
  copy) — the SUMMARY flagged this as a follow-up. Structural changes
  are done; visual polish is a separate quick task.
- Re-keying `useReportTemplates` to a global (no-scope) variant.
- Pre-existing pdf-smoke failures (unrelated to this task).

## Risk

- Migration 0010 DROPS the old `findings` / `diagnosis` /
  `recommendations` / `procedure_details` columns. Existing
  finalized PDFs are preserved (the on-disk file is independent of
  the DB row text columns), but the DB row text goes to ''. The user
  explicitly asked for this ("change completely").
- The IPC handler `REPORTS_SET_PROCEDURE_TYPE` currently crashes
  (calls undefined method). With commit 2 it works; before then, any
  renderer call to it would throw.
