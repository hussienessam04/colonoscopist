---
slug: patient-procedures-duplicate-row-and-open-pdf-gate
status: complete
---

# Quick Task Summary: patient-procedures-duplicate-row-and-open-pdf-gate

## Outcome

Two PatientProcedures bugs fixed in one commit (dc06ae3):

1. No more duplicate procedure rows — every recording now produces exactly
   one row.
2. "Open PDF" no longer appears for draft reports where the PDF hasn't
   been generated yet.

## Diff

- `src/main/db/procedures-repo.ts` (+22 −1) — `ProcedureInsertInput` gained
  optional `id?: string`. `insert` now treats an existing id as
  `updateVideoPath(newRel, originalRel, id)` instead of creating a
  duplicate row. `updateVideoPath`'s `COALESCE(video_path_original, ?)`
  guard sets the original to the canonical recording path on first call
  (NULL → real path) and preserves it on subsequent trims (no-op).
- `src/renderer/src/pages/PatientProcedures.tsx` (+1 −1) — Open PDF
  button condition tightened from `report !== null` to
  `report !== null && report.pdfPath !== null`. Draft reports still
  show the Report-column badge; Open PDF only appears once finalized.
- `tests/main/db/procedures-repo.test.ts` (+90) — 3 new contract guards:
  - existing id → updateVideoPath, no duplicate row
  - no id → fresh UUID (legacy path unchanged)
  - fresh id (not in DB) → insert normally
- `tests/renderer/pages/PatientProcedures.test.tsx` (+14) — new case:
  Open PDF button is hidden when report exists but `pdfPath` is null.

## Verification

- `tests/main/db/procedures-repo.test.ts` + `tests/renderer/pages/PatientProcedures.test.tsx` →
  25/25 pass (22 prior + 3 new repo + 1 new renderer − 1 prior that
  now also exercises the new path).

## Notes

- Pre-existing duplicate rows in user databases are NOT auto-cleaned.
  The fix prevents future duplicates; existing rows need manual cleanup.
  Out of scope per the user's reported scope (and risky to auto-clean
  when two rows share `started_at`).
- The recorder itself still passes `id: args.procedureId` to
  `procedures.insert` — unchanged. The repo is the only thing that
  changed behavior; callers don't need to be touched.
- `typecheck:web` clean for changed files. Pre-existing errors in
  `reports-repo.ts` / `reports.ts` / `render-report-pdf.ts` (Phase 6
  Report redesign fallout) are unrelated to this task.
