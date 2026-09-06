---
slug: finalize-idempotent
created: 2026-09-06
type: bugfix
source: ad-hoc user report
---

# Quick Task: make `reportsRepo.finalize` idempotent (race between finalize status flip and regenPdf)

## Bug

`reportsRepo.finalize` throws `IPC_NOT_FOUND: Report <id> not
found or already finalized` if the row's status is already
'finalized' (the SQL `WHERE status='draft'` filter rejects the
UPDATE so `info.changes === 0`).

This becomes user-visible when:

1. The doctor clicks **Finalize report**. The IPC handler
   calls `reportsRepo.finalize(id)` which atomically flips
   `status` to 'finalized', then the renderer immediately calls
   `regenPdf(id)`.
2. The doctor clicks **Back** *between* `finalize` and `regenPdf`
   (e.g. they got distracted, or the regenPdf IPC was slow).
3. The doctor re-enters the same procedure.
4. `useReport` loads the existing row → `status='finalized'`,
   `pdfPath=null` (regenPdf never ran).
5. The renderer's conditional `report?.pdfPath === null ? <Finalize
   button> : <Save changes button>` evaluates to **true** because
   `pdfPath` is null → the Finalize button is shown.
6. The doctor clicks Finalize → IPC throws "Report ... already
   finalized" → the report is stuck in a half-finalized state
   (status='finalized', pdfPath=null) until the doctor can
   somehow trigger a regenPdf.

The error message is also misleading ("not found or already
finalized") — the doctor reads this as a database corruption,
not a "you already finalized this, we just need to write the
PDF" recoverable state.

## Fix

Make `finalize` idempotent:
- Row missing → throw `IPC_NOT_FOUND: Report <id> not found`.
- Row status='draft' → flip to 'finalized' (current behavior).
- Row status='finalized' (already) → no-op, return the current
  row.

Then the renderer's `handleFinalize` works correctly on the
half-finalized state: the no-op `finalize` returns the row,
`regenPdf` writes the PDF, `refresh` re-syncs the React state.
The doctor recovers without losing the report.

## Scope

- `src/main/db/reports-repo.ts`: rewrite `finalize(id)` to:
  1. SELECT the row by id.
  2. If not found → throw `IPC_NOT_FOUND: Report <id> not found`.
  3. If status='draft' → UPDATE to 'finalized'.
  4. Always return the current row (whether we updated or not).
- `tests/main/db/reports-repo.test.ts`: add a contract test:
  `finalize` is idempotent — calling it on an already-finalized
  row returns the row without throwing and does not bump
  `finalizedAt`.

## Verification

- 10/10 (existing) + 1 (new idempotency) tests pass.
- `npm run typecheck` exits 0.
- Manual: click Finalize → click Back immediately → re-enter →
  click Finalize → no error, PDF generates.

## Out of scope

- Wrapping finalize + regenPdf in a single main-process
  transaction. The IPC surface stays as two sequential calls;
  the repo makes the first one idempotent so the doctor can
  recover when the renderer interrupts mid-flow.
- Audit metadata for the "no-op finalize" path — the existing
  audit row is only emitted when status flips, which is the
  correct behavior (the no-op isn't a fresh finalize event).
