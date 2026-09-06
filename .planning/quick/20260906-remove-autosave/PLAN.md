---
slug: remove-autosave
created: 2026-09-06
type: bugfix
source: ad-hoc user report
---

# Quick Task: drop the auto-save hook (we have Save changes now)

## Issue

The editor's textareas + instrument + premedication all flow
through `useAutoSave` which auto-saves every keystroke (after
a 300ms debounce) via `api.reports.updateDraft` /
`updateFinalized`. With the recent "Save changes" button at
the end of the page, the auto-save is now redundant (and causes
extra IPC traffic on every keystroke). The doctor explicitly
asked to drop it.

## Scope

- `src/renderer/src/pages/ReportEditor.tsx`:
  - Drop the `import { useAutoSave } from "@/hooks/useAutoSave"`.
  - Drop the `useAutoSave({...})` call + its destructured
    `status, savedAt, trigger`.
  - The textarea / select / input `onChange` handlers now just
    call `setLocal(patched)` — no `trigger()` (so the change sits
    in local React state only).
  - The bullet / template handlers also drop the `trigger()` call.
  - Drop the `indicatorText` useMemo + the "Saving… / Saved at
    HH:MM:SS" UI line (no auto-save means nothing to show).
  - The `Save changes` button at the bottom already calls
    `handleRegenPdf` which writes the current `report` to the
    DB via the IPC handlers it chains; the only field it persists
    is the PDF regeneration. Box edits are persisted at that
    point via the existing auto-save hook... wait, after dropping
    auto-save, the doctor needs Save changes to persist the box
    edits too. Update `handleRegenPdf` to also flush the
    current box fields via `updateDraft` / `updateFinalized`
    before calling `regenPdf`.

## Out of scope

- Deleting `useAutoSave` hook itself (other callers may use it).
- Removing the `useAutoSave` tests.

## Verification

- 24/24 tests should still pass.
- Manual: type in a box → no IPC until "Save changes" is clicked.
