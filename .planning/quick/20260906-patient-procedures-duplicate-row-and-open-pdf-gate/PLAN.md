---
slug: patient-procedures-duplicate-row-and-open-pdf-gate
created: 2026-09-06
type: bugfix
source: ad-hoc user report
---

# Quick Task: Patient Procedures table — duplicate procedure row + Open PDF before PDF exists

## Bug 1 — Two rows per procedure (one 'completed' with empty videoPath, one 'recording' with the real mp4)

### Root cause

Two insert paths both fire for the same recording session:

1. `procedures.create` IPC (`src/main/ipc/procedures.ts:80-109`) — when the
   user picks a device on ProcedurePreview and clicks Continue, this
   pre-creates the procedure row so the notes panel has a stable id
   (per D-08). Inserted via `proceduresRepo.insert` with no `id`
   field → repo generates a new UUID, status='recording',
   video_path=`''`. This is row A.

2. Recorder `start()` (`src/main/recorder/recorder.ts:244-251`) —
   always calls `this.deps.procedures.insert({ id: args.procedureId,
   ... })` with the canonical videoPath + preset. The repo SILENTLY
   IGNORES `input.id` (line 248 of `procedures-repo.ts`:
   `const id = randomUUID();`) and generates a second UUID. This is
   row B.

Result: row A (id=A, status='completed', videoPath='') and row B
(id=B, status='recording', videoPath=actual.mp4). Both rows have the
same `started_at` timestamp because the recorder passes the same
`args.procedureId` to its updateStartedAt → finalize path (which
updates row A, not B). The doctor sees both rows in PatientProcedures.

### Fix

`src/main/db/procedures-repo.ts:248` — make `insert` honor an optional
`id` field. If the id is provided AND a row with that id already
exists, treat it as `updateVideoPath(newRel, originalRel, id)` so the
canonical videoPath lands on the pre-created row (row A) instead of a
new row B. `updateVideoPath` uses `COALESCE(video_path_original, ?)`
so the original is preserved as the recording's first canonical path
(NULL → real path on first call, no-op on subsequent trims).

When the id is NOT provided (legacy `recording.start` path that
inserts on demand), the repo still generates a new UUID — unchanged
behavior.

Add optional `id?: string` to `ProcedureInsertInput`. The recorder's
existing call shape (`{ id: args.procedureId, ... }`) already passes
the id; it was just being ignored.

## Bug 2 — "Open PDF" button shown for draft reports with no PDF generated

### Root cause

`src/renderer/src/pages/PatientProcedures.tsx:526` gates the Open PDF
button on `report !== null`. A `Report` row exists from the moment
the doctor opens ReportEditor (status='draft', pdfPath=null). Clicking
"Open PDF" then tries to open a file that doesn't exist.

### Fix

Change the condition to `report !== null && report.pdfPath !== null`.
A draft report shows the badge in the Report column but no Open PDF
button; the button appears once the report has been finalized (which
populates pdfPath).

## Verification

- Add a repo unit test: `proceduresRepo.insert({ id: <existing>, ... })`
  UPDATEs the existing row's video_path + video_path_original instead
  of creating a second row. Lock with `SELECT COUNT(*) WHERE
  patient_id = ?` before/after.
- Add a renderer test on PatientProcedures: when the report is draft
  with `pdfPath: null`, the `patient-procedure-open-pdf-*` button is
  NOT rendered; when `pdfPath: 'data/foo.pdf'`, it IS rendered.
- Run all related test files — ScreenshotTimeline from the previous
  quick task stays green; no contract changes.

## Out of scope

- Cleanup of pre-existing duplicate rows in user databases. The user
  can delete the 'completed'/empty row manually. A migration cleanup
  is a separate decision (would need user confirmation since it could
  delete the wrong row if timestamps collide).
