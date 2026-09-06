---
slug: backup-restore-tests-polish
created: 2026-08-11
type: test-coverage+ui-polish
source: ad-hoc user request
---

# Quick Task: Backup & Restore — Add Comprehensive Tests + UI Polish

## What

Two improvements to `src/renderer/src/pages/BackupRestore.tsx`:
1. **UI polish** — refined spacing, better focus rings, tighter preview dialog, better button hierarchy (primary action more prominent), refined empty-state messaging, status indicators for last backup metadata if available.
2. **Comprehensive tests** — fill the test coverage gaps. The 8 existing tests cover happy paths + v1.1 placeholder + D-14 invariant. Missing: cancel paths (pickDestination/pickZip returning null), error paths (preview reject, unpack reject), stale-state reset, edge cases (empty data folder, long paths, procedureCount=0), IPC layer unit tests for the audit row emissions.

## Scope (smallest working diff)

### 1. `src/renderer/src/pages/BackupRestore.tsx` — UI polish

- **Header**: tighter kicker/title spacing; Back button with `variant="ghost"` (it's a navigation, not a primary action)
- **Backup card**: "Create Backup" button as primary `variant="default"` (already default, but add `size="lg"` for prominence); inline warning Alert gets a refined `bg-amber-50 border-amber-200 text-amber-900` styling
- **Restore card**: "Choose backup file" + "Preview backup" as `variant="outline"` (secondary actions); v1.1 activate placeholder stays `disabled`
- **Preview Dialog**: bump to `max-w-3xl` (matches Audit page polish); section headers (filename/staging/contents/integrity) get a subtle `border-b border-slate-200` separator
- **Add `data-testid="backup-success-toast-stub"` and `data-testid="restore-success-toast-stub"` anchors** for tests to query without depending on sonner's portal rendering
- **Refined empty state**: when no zip is picked yet, the Restore card shows a hint "No backup selected yet" instead of being just blank
- **Status indicator section** at the top of the Backup card: shows the timestamp of the most recent backup if one exists in the audit log. Implementation: query `audit.list({action: 'backup.created', pageSize: 1})` on mount via `useEffect`; if non-empty, render "Last backup: <relative time>" under the warning. If empty, render "No backups yet". This is purely informational — no click handlers, no auto-delete.

### 2. `tests/renderer/pages/BackupRestore.test.tsx` — add 9 new cases

New cases (alongside the 8 existing):

1. **Backup cancel** — `api.backup.pickDestination.mockResolvedValue(null)` → click Create Backup → assert no toast + no backup.create call + button re-enabled
2. **Backup cancel via empty string** — same with `''` (defensive)
3. **Restore cancel** — `api.restore.pickZip.mockResolvedValue(null)` → click Choose → assert no preview call + restore-preview button stays disabled
4. **Restore preview error path** — `api.restore.preview.mockRejectedValue(new Error('zip unreadable'))` → click Preview after picking → assert toast.error + restore-error Alert appears + restore-confirm-open stays disabled
5. **Restore unpack error path** — `api.restore.unpack.mockRejectedValue(new Error('disk full'))` → full flow → assert toast.error + unpack is the failing call
6. **Stale preview reset on re-pick** — pick zip → preview → re-pick a different zip → assert preview state was cleared
7. **Empty data folder** — procedureCount: 0 in preview → preview-contents still renders (no crash)
8. **Long zip path truncation** — zipPath with 200+ chars → assert restore-zip-path uses truncateTail (renders ellipsis + last 60 chars)
9. **Last backup status indicator** — `api.audit.list.mockResolvedValue({rows: [BACKUP_AUDIT_ROW], total: 1})` → assert "Last backup:" string rendered under the warning Alert
10. **No backups yet** — `api.audit.list.mockResolvedValue({rows: [], total: 0})` → assert "No backups yet" rendered

### 3. `tests/main/ipc/backup.test.ts` — NEW

Tests for the main-side backup IPC handlers (currently no dedicated test):
- **BACKUP_CREATE**: success path → assert `backup.created` audit row emitted with correct metadata (path, sizeBytes, procedureCount)
- **BACKUP_CREATE**: failure path → assert `backup.failed` audit row emitted with error message
- **BACKUP_REVEAL**: success path → assert shell.showItemInFolder was called with the right path
- **BACKUP_PICK_DESTINATION**: dialog cancel → returns null, no audit row
- **BACKUP_PICK_DESTINATION**: no session → throws IPC_AUTH_REQUIRED

### 4. `tests/main/ipc/restore.test.ts` — NEW

Tests for the main-side restore IPC handlers (currently no dedicated test):
- **RESTORE_PREVIEW**: success → returns preview shape + emits `restore.previewed` audit row
- **RESTORE_PREVIEW**: failure → emits `restore.failed` audit row with stage: 'preview'
- **RESTORE_UNPACK**: success → emits `restore.completed` audit row
- **RESTORE_UNPACK**: failure → emits `restore.failed` audit row with stage: 'unpack'
- **RESTORE_PICK_ZIP**: dialog cancel → returns null
- **RESTORE_REVEAL_STAGING**: calls shell.openPath; non-empty error string is logged but doesn't throw

### 5. i18n keys (if new ones are added)

If the polish adds new copy (e.g., "No backups yet", "Last backup"), add them to `src/renderer/src/i18n/{en,ar}/translation.json`. AR mirrors per D-24 parity.

## Non-scope (do NOT touch)

- The main-side backup/restore module (`src/main/backup/{index,restore,snapshot}.ts`) — already well-tested in `tests/main/backup/`. Don't add module-level tests.
- The IPC contract shapes — no changes.
- The `useRoute` / `useTranslation` hooks — no changes.
- The existing 8 BackupRestore tests must stay green.

## Acceptance

- `npm run typecheck` clean (node + web)
- `npm run test:unit -- tests/renderer/pages/BackupRestore.test.tsx tests/main/ipc/backup.test.ts tests/main/ipc/restore.test.ts` passes
- `npm run test:unit` — full suite green (no new failures beyond the 9 pre-existing baseline)
- `npm run test:unit -- tests/renderer/i18n/parity.test.ts` passes (any new EN keys mirrored in AR)

## Style

Ponytail — reuse existing patterns:
- Status indicator queries `window.api.audit.list({action: 'backup.created', pageSize: 1})` via existing MockApi — no new IPC
- Use `Intl.DateTimeFormat` or relative-time formatter for the "Last backup" timestamp (no new deps)
- Test patterns from the existing 8 BackupRestore tests (vitest + @testing-library/user-event + sonner mock)