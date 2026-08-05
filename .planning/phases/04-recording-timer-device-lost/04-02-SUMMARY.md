---
phase: 04-recording-timer-device-lost
plan: 02
subsystem: procedure-notes
tags: [notes, shadcn, ipc, db-check, audit, scroll-area, badge, alert, textarea]
dependency_graph:
  requires: [phase-03, phase-04-plan-01]
  provides: [procedure-notes-ipc, procedure-notes-panel, shadcn-textarea-scroll-area-badge-alert, recording-start-procedureid-reuse]
  affects: [phase-04-plan-03, phase-04-plan-04, phase-05, phase-06, phase-07]
tech-stack:
  added:
    - "@radix-ui/react-scroll-area@^1.2.18"
  patterns:
    - append-only-chronological-log
    - db-check-as-source-of-truth-for-input-limits
    - transaction-rollback-on-constraint-violation
    - form-layer-pre-check-then-db-enforcement
    - canonical-procedure-row-reused-by-recording-start
key-files:
  created:
    - src/renderer/src/components/ui/textarea.tsx
    - src/renderer/src/components/ui/scroll-area.tsx
    - src/renderer/src/components/ui/badge.tsx
    - src/renderer/src/components/ui/alert.tsx
    - src/renderer/src/components/procedure-notes-panel.tsx
    - tests/main/ipc/procedure-notes.test.ts
    - tests/renderer/components/procedure-notes-panel.test.tsx
  modified:
    - package.json
    - src/shared/validators.ts
    - src/shared/ipc-contract.ts
    - src/main/db/procedures-repo.ts
    - src/main/ipc/procedures.ts
    - src/main/ipc/recording.ts
    - src/main/index.ts
    - src/renderer/src/pages/ProcedureRoom.tsx
    - src/renderer/src/pages/ProcedureReview.tsx
    - tests/renderer/pages/procedure-room.test.tsx
    - tests/renderer/pages/procedure-room-timer.test.tsx
decisions:
  - "procedure_notes is append-only: notes are never updated or deleted; renderer mirrors the SQL ORDER BY created_at ASC so list ordering is consistent across reloads + browser refreshes"
  - "Body length 1..1000 enforced at the DB CHECK layer; renderer pre-check filters empty/whitespace submit attempts; CHECK violation is translated to IPC_VALIDATION {field:body} so the renderer can switch on it"
  - "Audit metadata carries bodyLength only, never the body content (per Fix 6 inheritance from Phase 2)"
  - "Procedure row is now created via procedures.create IPC on ProcedureRoom mount so the notes panel has a stable id BEFORE Record is pressed; recording.start accepts an optional procedureId and reuses the existing row (no duplicate procedure rows)"
  - "ProcedureRoom splits initialized.current into procedureInitRef + deviceInitRef so the procedure-create flow and the device-default-load flow do not block each other"
  - "ProcedureNotesPanel disabled state is gated on procedureId only (D-08) — the textarea is enabled mid-recording so the doctor can take notes during the procedure"
  - "No optimistic UI: the new note is appended to the list only after procedureNotes.create resolves; failed create surfaces an inline error and preserves the body so the user can retry"
  - "procedureNotes.list writes a procedure.note_list audit row per AUDIT-01 — reads are auditable too, with metadata = {procedureId, count}"
  - "Four shadcn additions (textarea + scroll-area + badge + alert) written by hand to match the existing shadcn component style in this repo rather than via `npx shadcn@latest add` (network-free, deterministic)"
metrics:
  duration: ~35 minutes
  completed_date: "2026-08-05"
  tasks: 2
  files: 18
  tests: 281
  commits:
    - 8f715b8: feat(04-02): procedure-notes IPC + four shadcn additions + DB CHECK body length
    - c882670: feat(04-02): ProcedureNotesPanel + ProcedureRoom mount + recording.start reuse
status: complete
---

# Phase 4 Plan 2: Procedure Notes (Append-Only Log + shadcn Surface) Summary

Mid-procedure notes feature ships end-to-end: append-only chronological `procedure_notes` log surfaced through a `<ProcedureNotesPanel>` mounted in the Procedure Room side-rail. The four shadcn components (`textarea` + `scroll-area` + `badge` + `alert`) that Plan 03 (Pause/Resume) and Plan 04 (device-lost banner) need to compose are now in place. Pause/Resume, device-lost UI, and scanForOrphans remain in their respective follow-up plans.

## What shipped

### Main process

- **proceduresRepo.insertNote({ procedureId, body })** — inserts one row to `procedure_notes`, returns `{ id, procedureId, body, createdAt }`. The SQL `CHECK(length(body) > 0 AND length(body) <= 1000)` rejects empty/over-length bodies; better-sqlite3 surfaces `SQLITE_CONSTRAINT_CHECK` which the IPC layer translates to `IPC_VALIDATION { field: 'body' }`.
- **proceduresRepo.listNotes(procedureId)** — returns rows ordered by `created_at ASC` so the renderer reads directly with no client-side sort.
- **IPC `procedure-notes:create`** — `safeParse(procedureNoteCreateInput, raw)` → `requireSession()` → `db.transaction(() => insert + audit)`. CHECK violation is caught inside the transaction and re-thrown as `IpcErrorException('IPC_VALIDATION', 'Note body must be 1..1000 characters', { field: 'body' })`. Audit row has `action='procedure.note_added'`, `entityType='procedure'`, `entityId=<procedureId>`, `metadata={ bodyLength }` — body content NEVER appears in audit metadata (Fix 6).
- **IPC `procedure-notes:list`** — gates on `requireSession()`, calls `proceduresRepo.listNotes(procedureId)`, writes `procedure.note_list` audit row with `metadata={ procedureId, count }` per AUDIT-01.
- **`recording.start` now accepts optional `procedureId`** — if provided, the handler reuses the existing procedure row (no duplicate procedure insert per session); otherwise it falls back to creating one (back-compat for tests + legacy callers).
- **`main/index.ts` wires `createProcedure` to `proceduresRepo.insert`** — Plan 01 stubbed this with `'reserved for future plans'`; Plan 02 replaces the stub with the actual insert using the `doctorId` derived from `requireSession()`.
- **Validators** — added `procedureNoteListInput = z.object({ procedureId: z.string().uuid() })` and the inferred `ProcedureNoteListInput` type.

### Renderer

- **shadcn `textarea.tsx`** — `<Textarea>` with `forwardRef`, matches the existing `input.tsx` style (cn helper, `flex min-h-[60px] w-full rounded-md border ... disabled:cursor-not-allowed disabled:opacity-50`).
- **shadcn `scroll-area.tsx`** — `<ScrollArea>` + `<ScrollBar>` using `@radix-ui/react-scroll-area@^1.2.18` (new dep). Style matches the existing `select.tsx` analog.
- **shadcn `badge.tsx`** — `<Badge variant='default'|'secondary'|'destructive'|'outline'>` using `class-variance-authority` (already present).
- **shadcn `alert.tsx`** — `<Alert>` + `<AlertTitle>` + `<AlertDescription>` with `role='alert'` and destructive variant styling. No new Radix dep needed.
- **`procedure-notes-panel.tsx`** — `<ProcedureNotesPanel procedureId: string | null>`:
  - `useEffect` on mount + `procedureId` change fetches `procedureNotes.list({ procedureId })`; cancelled flag prevents setState-after-unmount.
  - `<Textarea>` bound to local state; `disabled={!procedureId}` per D-08 (the textarea is enabled mid-recording so the doctor can take notes during the procedure).
  - Save `<Button>` is disabled when `procedureId` is null OR `body.trim()` is empty; form-layer pre-check fires before the IPC round-trip.
  - On save success: appends the returned `ProcedureNote` to the bottom of the list (chat-style per D-09) and clears the body. On failure: inline error string under the input; body is preserved so the user can retry.
  - `<ScrollArea className='h-[280px] rounded-md border p-3'>` contains the chronological list (`<time>` + `<p className='whitespace-pre-wrap'>`); empty state renders a muted "No notes yet." paragraph.
- **`ProcedureRoom.tsx` extensions**:
  - New `useEffect` calls `procedures.create({ patientId })` once on mount (gated by `procedureInitRef`) and stores the returned `procedure.id` in state.
  - `handleRecordToggle` passes `procedureId` to `recording.start` when available.
  - `<ProcedureNotesPanel procedureId={procedureId} />` mounted BELOW the existing device/preset/record controls in the right-hand side-rail.
  - Device-init ref split into `deviceInitRef` so the procedure-create flow does not block the device-default-load flow.
- **`ProcedureReview.tsx`** — status text wrapped in `<Badge variant={statusBadgeVariant(procedure.status)}>` (default for completed, secondary for recording, destructive for partial + crashed). The destructive red `<span>` for `status === 'partial'` is preserved for Plan 04 to wrap in `<Alert>`.

### Shared / preload

- **`recordingStartInput` zod schema** grew with optional `procedureId`.
- **`IpcContract.recording.start` input type** grew with optional `procedureId`. No new IPC channels — preload bridge unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] `procedures.create` was stubbed in Plan 01 — Plan 02 needed it wired up**
- **Found during:** Task 2 typecheck (renderer couldn't call `procedures.create` without the IPC factory being non-throwing)
- **Issue:** Plan 01 reserved the `createProcedure` factory with `throw new Error('reserved for future plans')`. The D-08 "notes panel has a stable id before Record" requirement can only be satisfied if `procedures.create` actually inserts a row.
- **Fix:** `main/index.ts` now wires `createProcedure` to `proceduresRepo.insert({ patientId, doctorId, videoPath: '', presetSummary, audioDeviceName: null })`; the `createProcedure` factory input now carries `doctorId` from the closure (passed by the handler after `requireSession()`).
- **Files modified:** `src/main/ipc/procedures.ts`, `src/main/index.ts`

**2. [Rule 2 - Missing] `recording.start` needed `procedureId` reuse — Plan 02 had to extend the IPC contract**
- **Found during:** Task 2 design walk-through — without this, `recording.start` would create a SECOND procedure row, leaving notes orphaned from the recording.
- **Issue:** D-08 requires notes and recording to share a procedureId. If the renderer creates the row up front but `recording.start` keeps creating, two rows exist per session.
- **Fix:** Added optional `procedureId` to `recordingStartInput` + `IpcContract.recording.start`; the IPC handler reuses the row when provided (FK + patient ownership checks), creates one otherwise. Existing tests + legacy callers that don't pass `procedureId` continue to work.
- **Files modified:** `src/shared/validators.ts`, `src/shared/ipc-contract.ts`, `src/main/ipc/recording.ts`, `src/renderer/src/pages/ProcedureRoom.tsx`

**3. [Rule 1 - Bug] `initialized.current` was shared between two `useEffect`s in ProcedureRoom**
- **Found during:** Task 2 code review — the first `useEffect` that calls `procedures.create` set `initialized.current = true`, which would have blocked the second `useEffect` that initializes the device-default state.
- **Issue:** Sharing the ref across two init flows would silently break the device default-load path.
- **Fix:** Split into `procedureInitRef` + `deviceInitRef`, each guarding its own effect.
- **Files modified:** `src/renderer/src/pages/ProcedureRoom.tsx`

**4. [Rule 1 - Bug] `procedures.create` + `procedureNotes.list` mocks were missing from existing procedure-room tests**
- **Found during:** Task 2 test run — `procedure-room.test.tsx` and `procedure-room-timer.test.tsx` did not stub the new IPC calls.
- **Issue:** ProcedureRoom mounts and immediately calls `procedures.create`; without a mock, `mockResolvedValue(undefined)` returns undefined and `.id` reads crash the render.
- **Fix:** Added `procedures.create` + `procedureNotes.list` stubs to the existing `beforeEach` blocks in both test files.
- **Files modified:** `tests/renderer/pages/procedure-room.test.tsx`, `tests/renderer/pages/procedure-room-timer.test.tsx`

### Skipped (not auto-fixed)

None.

## Auth Gates

None.

## Known Stubs

| File | Line | Kind | Reason |
|------|------|------|--------|
| `src/renderer/src/components/ui/alert.tsx` | entire file | plan-reserved | Added now but only `ProcedureReview.tsx`'s destructive `<span>` placeholder uses it tangentially. Plan 04 wraps the partial banner in `<Alert>`; Plan 03 may use it for the pause-confirmation surface. |
| `src/renderer/src/pages/ProcedureReview.tsx` | partial `<span className="text-sm text-destructive">` | placeholder | Plan 04 replaces with `<Alert variant="destructive">` containing the partial banner copy. |

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: ipc-procedure-notes | `src/main/ipc/procedures.ts` | New IPC handlers `procedure-notes:create` + `procedure-notes:list` cross the renderer → main trust boundary. Mitigated by `requireSession()` gate + zod validation + SQL CHECK on length 1..1000 + audit metadata carrying bodyLength only (T-04-08 + T-04-09 + T-04-11). |
| threat_flag: ipc-recording-start-procedureid | `src/main/ipc/recording.ts` | `recording.start` now accepts optional `procedureId` from the renderer. Mitigated by IPC_NOT_FOUND if the procedure doesn't exist, IPC_VALIDATION if it belongs to a different patient; main still owns the doctorId derivation. |
| threat_flag: scroll-area-dep | `package.json` | New `@radix-ui/react-scroll-area@^1.2.18` dependency. Mitigated by `package.json` pinning + the lockfile carries the resolved version. |

## Self-Check: PASSED

- `npm run typecheck:node` — clean.
- `npm run typecheck:web` — clean.
- `npm run test:unit` — 272 / 272 tests pass across 42 test files (was 257 / 40 in Plan 01; +15 tests, +2 files).
- `git log --oneline` — `8f715b8` (Task 1) + `c882670` (Task 2) atomic commits land on `main`.
- The four shadcn components are importable; `node -p "require('./package.json').dependencies['@radix-ui/react-scroll-area']"` returns `^1.2.18`.
- Plan 02 ships zero Pause/Resume IPC channels and zero device-lost UI (both reserved for Plans 03 / 04).
