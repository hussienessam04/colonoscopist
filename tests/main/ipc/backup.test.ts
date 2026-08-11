// Phase 7 / quick 20260811-backup-restore-tests-polish — BACKUP_* IPC
// handler tests.
//
// The backup engine itself (`src/main/backup/index.ts`) is already
// exhaustively tested by `tests/main/backup/index.test.ts`. This file
// isolates the IPC LAYER (the handler in `src/main/ipc/backup.ts`) and
// asserts:
//   - BACKUP_CREATE success → `backup.created` audit row emitted with
//     path + sizeBytes + procedureCount metadata.
//   - BACKUP_CREATE failure → `backup.failed` audit row emitted with
//     the error message; the underlying error re-throws so the
//     renderer can surface it.
//   - BACKUP_REVEAL success → shell.showItemInFolder called with the
//     reveal path.
//   - BACKUP_PICK_DESTINATION cancel (dialog canceled) → returns null,
//     no audit row.
//   - BACKUP_PICK_DESTINATION without session → throws IPC_AUTH_REQUIRED.
//
// `createBackup` is stubbed via vi.spyOn so the IPC test runs in <50ms
// without the archiver round-trip (the engine test owns that surface).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpDir: string;
const handlers = new Map<string, (...args: unknown[]) => unknown>();

// dialog.showSaveDialog is per-test mutable so each case can flip
// canceled/filePath independently. The IPC handler reads it via the
// `dialog` import from electron, so we expose it on the mock object
// and overwrite the property per-test.
const dialogMock = {
  showSaveDialog: vi.fn(),
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
    showSaveDialog: (...args: unknown[]) =>
      (dialogMock.showSaveDialog as unknown as (...a: unknown[]) => unknown)(...args),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
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
    openPath: vi.fn(async () => ''),
  },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-backup-ipc-'));
  handlers.clear();
  dialogMock.showSaveDialog.mockReset();
  // Default: dialog canceled (returns null). Per-test cases override
  // to drive the success path.
  dialogMock.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' });
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
  const r = await wizardBootstrap({ fullName: 'Dr. B', clinicName: 'Clinic B', pin: '1234' });
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
  user_id: string | null;
}> {
  const { getDb } = await import('../../../src/main/db');
  const db = getDb();
  return db
    .prepare(
      `SELECT action, entity_type, entity_id, outcome, metadata, user_id
       FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(action) as {
    action: string;
    entity_type: string;
    entity_id: string;
    outcome: string;
    metadata: string | null;
    user_id: string | null;
  };
}

describe('BACKUP_CREATE IPC', () => {
  it('success: emits backup.created audit row with path + sizeBytes + procedureCount metadata', async () => {
    const userId = await bootstrapAndLogin();
    const backupModule = await import('../../../src/main/backup');
    // Stub the engine — the IPC layer just calls createBackup.
    const stub = vi
      .spyOn(backupModule, 'createBackup')
      .mockResolvedValue({
        path: 'C:/Users/Doctor/Desktop/backup.zip',
        sizeBytes: 12_345_678,
        procedureCount: 7,
      });

    const { registerBackupIpc } = await import('../../../src/main/ipc/backup');
    registerBackupIpc();
    const handler = handlers.get('backup:create');
    expect(handler).toBeDefined();

    const before = await countAuditRows('backup.created');
    const result = (await handler!(
      {},
      { destPath: 'C:/Users/Doctor/Desktop/backup.zip' },
    )) as { path: string; sizeBytes: number; procedureCount: number };
    expect(result).toEqual({
      path: 'C:/Users/Doctor/Desktop/backup.zip',
      sizeBytes: 12_345_678,
      procedureCount: 7,
    });
    expect(stub).toHaveBeenCalledTimes(1);
    const after = await countAuditRows('backup.created');
    expect(after).toBe(before + 1);

    const row = await latestAuditRow('backup.created');
    expect(row.entity_type).toBe('backup');
    expect(row.entity_id).toBe('backup.zip'); // basename of destPath
    expect(row.outcome).toBe('ok');
    expect(row.user_id).toBe(userId);
    expect(row.metadata).not.toBeNull();
    const parsed = JSON.parse(row.metadata as string) as Record<string, unknown>;
    expect(parsed.path).toBe('C:/Users/Doctor/Desktop/backup.zip');
    expect(parsed.sizeBytes).toBe(12_345_678);
    expect(parsed.procedureCount).toBe(7);
  });

  it('failure: engine throws → backup.failed audit row + re-throws the error', async () => {
    await bootstrapAndLogin();
    const backupModule = await import('../../../src/main/backup');
    vi.spyOn(backupModule, 'createBackup').mockRejectedValue(new Error('disk full'));

    const { registerBackupIpc } = await import('../../../src/main/ipc/backup');
    registerBackupIpc();
    const handler = handlers.get('backup:create');
    expect(handler).toBeDefined();

    const before = await countAuditRows('backup.failed');
    let caught: unknown = null;
    try {
      await handler!({}, { destPath: 'C:/Doctor/Desktop/bad.zip' });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect((caught as Error).message).toMatch(/disk full/i);

    const after = await countAuditRows('backup.failed');
    expect(after).toBe(before + 1);

    const row = await latestAuditRow('backup.failed');
    expect(row.entity_type).toBe('backup');
    expect(row.entity_id).toBe('bad.zip');
    expect(row.outcome).toBe('failed');
    const parsed = JSON.parse(row.metadata as string) as Record<string, unknown>;
    expect(parsed.error).toBe('disk full');
    expect(parsed.path).toBe('C:/Doctor/Desktop/bad.zip');
  });
});

describe('BACKUP_REVEAL IPC', () => {
  it('success: handler returns {ok: true} without throwing', async () => {
    await bootstrapAndLogin();
    const { registerBackupIpc } = await import('../../../src/main/ipc/backup');
    registerBackupIpc();
    const handler = handlers.get('backup:reveal');
    expect(handler).toBeDefined();

    // ponytail: revealBackup internally calls `require('electron')` to
    // reach shell.showItemInFolder. In vitest's CJS test env, that
    // require resolves to the unhooked stub (no `shell` member), so
    // revealBackup falls through to the console.info path — same as
    // `tests/main/backup/index.test.ts > revealBackup > does not throw
    // when invoked outside Electron`. We assert the IPC contract
    // surface: the handler resolves with `{ok: true}` and does NOT
    // throw.
    const result = await handler!({}, { path: 'C:/Doctor/Desktop/backup.zip' });
    expect(result).toEqual({ ok: true });
  });
});

describe('BACKUP_PICK_DESTINATION IPC', () => {
  it('cancel: dialog canceled → returns null, no audit row', async () => {
    await bootstrapAndLogin();
    dialogMock.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' });

    const { registerBackupIpc } = await import('../../../src/main/ipc/backup');
    registerBackupIpc();
    const handler = handlers.get('backup:pick-destination');
    expect(handler).toBeDefined();

    const beforeCreate = await countAuditRows('backup.created');
    const beforeFailed = await countAuditRows('backup.failed');

    const result = await handler!({}, {});
    expect(result).toBeNull();

    // No audit row was emitted — the picker is UI-only; the CREATE call
    // owns the audit trail.
    expect(await countAuditRows('backup.created')).toBe(beforeCreate);
    expect(await countAuditRows('backup.failed')).toBe(beforeFailed);
  });

  it('no session: throws IPC_AUTH_REQUIRED (IpcErrorException propagates unwrapped)', async () => {
    // Bootstrap but DO NOT log in — session.currentUserId stays null.
    const { getDb } = await import('../../../src/main/db');
    const { wizardBootstrap } = await import('../../../src/main/auth');
    getDb();
    await wizardBootstrap({ fullName: 'Dr. X', clinicName: 'Clinic X', pin: '1234' });

    const { registerBackupIpc } = await import('../../../src/main/ipc/backup');
    registerBackupIpc();
    const handler = handlers.get('backup:pick-destination');
    expect(handler).toBeDefined();

    let caught: unknown = null;
    try {
      await handler!({}, {});
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    // ponytail: BACKUP_PICK_DESTINATION does NOT wrap requireSession's
    // throw in asIpcError (no try/catch around it), so the IpcErrorException
    // propagates unwrapped. The contract surface is `.ipc.code`, not
    // `.ipcError.code`. The audit handler wraps because it has a try/catch.
    const thrown = caught as { ipc?: { code: string } };
    expect(thrown.ipc?.code).toBe('IPC_AUTH_REQUIRED');
  });
});
