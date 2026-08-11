// Phase 7 / quick 20260811-backup-restore-tests-polish — RESTORE_* IPC
// handler tests.
//
// The restore engine (`src/main/backup/restore.ts`) is already
// exhaustively tested by `tests/main/backup/restore.test.ts`. This
// file isolates the IPC LAYER (the handler in `src/main/ipc/restore.ts`)
// and asserts:
//   - RESTORE_PREVIEW success → `restore.previewed` audit row emitted
//     with zipPath + stagingDir + contents.procedureCount +
//     dbIntegrityCheck metadata.
//   - RESTORE_PREVIEW failure → `restore.failed` audit row with
//     stage: 'preview'.
//   - RESTORE_UNPACK success → `restore.completed` audit row emitted
//     with stagingDir + fileCount metadata.
//   - RESTORE_UNPACK failure → `restore.failed` audit row with
//     stage: 'unpack'.
//   - RESTORE_PICK_ZIP cancel → returns null, no audit row.
//   - RESTORE_REVEAL_STAGING → shell.openPath non-empty error string
//     is logged but the handler still resolves `{ok: true}` (no throw).
//
// `previewRestore` + `unpackRestore` are stubbed via vi.spyOn so the
// IPC tests don't drive the real zip round-trip.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpDir: string;
const handlers = new Map<string, (...args: unknown[]) => unknown>();

// Per-test mutable mocks. The IPC handler reads them via the `dialog`
// and `shell` imports from electron, so we expose them on the mock
// object and overwrite the property per-test.
const dialogMock = {
  showOpenDialog: vi.fn(),
};
const shellMock = {
  openPath: vi.fn(),
};

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => (key === 'userData' ? tmpDir : tmpDir),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b,
  },
  dialog: {
    // Reference the per-test mutable mock so the IPC handler sees
    // whatever the current case set up.
    showOpenDialog: (...args: unknown[]) =>
      (dialogMock.showOpenDialog as unknown as (...a: unknown[]) => unknown)(...args),
    showSaveDialog: async () => ({ canceled: true, filePath: '' }),
  },
  ipcMain: {
    handle: (channel: string, cb: (...args: unknown[]) => unknown) => {
      handlers.set(channel, cb);
    },
    on: () => {},
  },
  contextBridge: {
    exposeInMainWorld: () => {},
  },
  ipcRenderer: {
    invoke: async () => null,
    on: () => {},
    removeListener: () => {},
  },
  shell: {
    showItemInFolder: vi.fn(),
    // Reference the per-test mutable mock so the IPC handler sees the
    // current case's stub. shell.openPath is async-returning — its
    // resolved value is the OS-reported error string (empty on success).
    openPath: (...args: unknown[]) =>
      (shellMock.openPath as unknown as (...a: unknown[]) => Promise<string>)(...args),
  },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-restore-ipc-'));
  handlers.clear();
  dialogMock.showOpenDialog.mockReset();
  // Default: dialog canceled.
  dialogMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
  shellMock.openPath.mockReset();
  // Default: openPath resolves to '' (success).
  shellMock.openPath.mockResolvedValue('');
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function bootstrapAndLogin(): Promise<string> {
  const { getDb } = await import('../../../src/main/db');
  const { wizardBootstrap, login } = await import('../../../src/main/auth');
  getDb();
  const r = await wizardBootstrap({ fullName: 'Dr. R', clinicName: 'Clinic R', pin: '1234' });
  await login({ userId: r.userId, pin: '1234' });
  return r.userId;
}

async function countAuditRows(action: string): Promise<number> {
  const { getDb } = await import('../../../src/main/db');
  const db = getDb();
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE action = ?`).get(action) as { c: number }
  ).c;
}

async function latestAuditRow(action: string): Promise<{
  action: string;
  entity_type: string;
  entity_id: string;
  outcome: string;
  metadata: string | null;
}> {
  const { getDb } = await import('../../../src/main/db');
  const db = getDb();
  return db
    .prepare(
      `SELECT action, entity_type, entity_id, outcome, metadata
       FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(action) as {
    action: string;
    entity_type: string;
    entity_id: string;
    outcome: string;
    metadata: string | null;
  };
}

describe('RESTORE_PREVIEW IPC', () => {
  it('success: returns preview shape + emits restore.previewed audit row with full metadata', async () => {
    await bootstrapAndLogin();
    const restoreModule = await import('../../../src/main/backup/restore');
    vi.spyOn(restoreModule, 'previewRestore').mockResolvedValue({
      filename: 'backup.zip',
      totalSize: 4096,
      dbIntegrityCheck: 'ok',
      procedureCount: 12,
    });

    const { registerRestoreIpc } = await import('../../../src/main/ipc/restore');
    registerRestoreIpc();
    const handler = handlers.get('restore:preview');
    expect(handler).toBeDefined();

    const before = await countAuditRows('restore.previewed');
    const result = (await handler!({}, {
      zipPath: 'C:/Doctor/Desktop/backup.zip',
      stagingDir: 'data-restore-1700000000000',
    })) as { filename: string; totalSize: number; dbIntegrityCheck: string; procedureCount: number };
    expect(result).toEqual({
      filename: 'backup.zip',
      totalSize: 4096,
      dbIntegrityCheck: 'ok',
      procedureCount: 12,
    });
    expect(await countAuditRows('restore.previewed')).toBe(before + 1);

    const row = await latestAuditRow('restore.previewed');
    expect(row.entity_type).toBe('restore');
    expect(row.entity_id).toBe('backup.zip');
    expect(row.outcome).toBe('ok');
    const parsed = JSON.parse(row.metadata as string) as Record<string, unknown>;
    expect(parsed.zipPath).toBe('C:/Doctor/Desktop/backup.zip');
    expect(parsed.stagingDir).toBe('data-restore-1700000000000');
    expect(parsed.dbIntegrityCheck).toBe('ok');
    const contents = parsed.contents as Record<string, unknown>;
    expect(contents.procedureCount).toBe(12);
  });

  it('failure: engine throws → restore.failed audit row with stage: preview', async () => {
    await bootstrapAndLogin();
    const restoreModule = await import('../../../src/main/backup/restore');
    vi.spyOn(restoreModule, 'previewRestore').mockRejectedValue(new Error('zip unreadable'));

    const { registerRestoreIpc } = await import('../../../src/main/ipc/restore');
    registerRestoreIpc();
    const handler = handlers.get('restore:preview');
    expect(handler).toBeDefined();

    const before = await countAuditRows('restore.failed');
    let caught: unknown = null;
    try {
      await handler!({}, {
        zipPath: 'C:/Doctor/Desktop/broken.zip',
        stagingDir: 'data-restore-1700000000000',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect((caught as Error).message).toMatch(/zip unreadable/i);

    expect(await countAuditRows('restore.failed')).toBe(before + 1);
    const row = await latestAuditRow('restore.failed');
    expect(row.entity_type).toBe('restore');
    expect(row.outcome).toBe('failed');
    const parsed = JSON.parse(row.metadata as string) as Record<string, unknown>;
    expect(parsed.stage).toBe('preview');
    expect(parsed.error).toBe('zip unreadable');
    expect(parsed.zipPath).toBe('C:/Doctor/Desktop/broken.zip');
  });
});

describe('RESTORE_UNPACK IPC', () => {
  it('success: returns {fileCount, stagingDir} + emits restore.completed audit row', async () => {
    await bootstrapAndLogin();
    const restoreModule = await import('../../../src/main/backup/restore');
    vi.spyOn(restoreModule, 'unpackRestore').mockResolvedValue({
      fileCount: 42,
      stagingDir: 'data-restore-1700000000000',
    });

    const { registerRestoreIpc } = await import('../../../src/main/ipc/restore');
    registerRestoreIpc();
    const handler = handlers.get('restore:unpack');
    expect(handler).toBeDefined();

    const before = await countAuditRows('restore.completed');
    const result = (await handler!({}, {
      zipPath: 'C:/Doctor/Desktop/backup.zip',
      stagingDir: 'data-restore-1700000000000',
    })) as { fileCount: number; stagingDir: string };
    expect(result).toEqual({
      fileCount: 42,
      stagingDir: 'data-restore-1700000000000',
    });
    expect(await countAuditRows('restore.completed')).toBe(before + 1);

    const row = await latestAuditRow('restore.completed');
    expect(row.entity_type).toBe('restore');
    expect(row.entity_id).toBe('backup.zip');
    expect(row.outcome).toBe('ok');
    const parsed = JSON.parse(row.metadata as string) as Record<string, unknown>;
    expect(parsed.stagingDir).toBe('data-restore-1700000000000');
    expect(parsed.fileCount).toBe(42);
  });

  it('failure: engine throws → restore.failed audit row with stage: unpack', async () => {
    await bootstrapAndLogin();
    const restoreModule = await import('../../../src/main/backup/restore');
    vi.spyOn(restoreModule, 'unpackRestore').mockRejectedValue(new Error('disk full'));

    const { registerRestoreIpc } = await import('../../../src/main/ipc/restore');
    registerRestoreIpc();
    const handler = handlers.get('restore:unpack');
    expect(handler).toBeDefined();

    const before = await countAuditRows('restore.failed');
    let caught: unknown = null;
    try {
      await handler!({}, {
        zipPath: 'C:/Doctor/Desktop/backup.zip',
        stagingDir: 'data-restore-1700000000000',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect((caught as Error).message).toMatch(/disk full/i);

    expect(await countAuditRows('restore.failed')).toBe(before + 1);
    const row = await latestAuditRow('restore.failed');
    expect(row.entity_type).toBe('restore');
    expect(row.outcome).toBe('failed');
    const parsed = JSON.parse(row.metadata as string) as Record<string, unknown>;
    expect(parsed.stage).toBe('unpack');
    expect(parsed.error).toBe('disk full');
    expect(parsed.zipPath).toBe('C:/Doctor/Desktop/backup.zip');
    expect(parsed.stagingDir).toBe('data-restore-1700000000000');
  });
});

describe('RESTORE_PICK_ZIP IPC', () => {
  it('cancel: dialog canceled → returns null', async () => {
    await bootstrapAndLogin();
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    const { registerRestoreIpc } = await import('../../../src/main/ipc/restore');
    registerRestoreIpc();
    const handler = handlers.get('restore:pick-zip');
    expect(handler).toBeDefined();

    const beforePreviewed = await countAuditRows('restore.previewed');
    const beforeCompleted = await countAuditRows('restore.completed');

    const result = await handler!({}, {});
    expect(result).toBeNull();

    // No audit row — picker is UI-only; preview/unpack own the trail.
    expect(await countAuditRows('restore.previewed')).toBe(beforePreviewed);
    expect(await countAuditRows('restore.completed')).toBe(beforeCompleted);
  });
});

describe('RESTORE_REVEAL_STAGING IPC', () => {
  it('openPath returns empty string (success) → handler resolves {ok: true}', async () => {
    await bootstrapAndLogin();
    shellMock.openPath.mockResolvedValue('');

    const { registerRestoreIpc } = await import('../../../src/main/ipc/restore');
    registerRestoreIpc();
    const handler = handlers.get('restore:reveal-staging');
    expect(handler).toBeDefined();

    const result = await handler!({}, { stagingDir: 'data-restore-1700000000000' });
    expect(result).toEqual({ ok: true });
    expect(shellMock.openPath).toHaveBeenCalledTimes(1);
  });

  it('openPath returns non-empty error string → handler still resolves {ok: true} (no throw)', async () => {
    await bootstrapAndLogin();
    // ponytail: shell.openPath resolves a non-empty string when the OS
    // can't open the path (no PDF viewer, bad path, etc.). The handler
    // logs the message via console.warn but still returns {ok: true}
    // — a true exception would still propagate through asIpcError.
    shellMock.openPath.mockResolvedValue('no application is associated');

    const { registerRestoreIpc } = await import('../../../src/main/ipc/restore');
    registerRestoreIpc();
    const handler = handlers.get('restore:reveal-staging');
    expect(handler).toBeDefined();

    const result = await handler!({}, { stagingDir: 'data-restore-1700000000000' });
    expect(result).toEqual({ ok: true });
    expect(shellMock.openPath).toHaveBeenCalledTimes(1);
  });
});
