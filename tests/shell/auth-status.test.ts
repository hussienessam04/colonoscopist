import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IPC } from '../../src/shared/ipc-contract';
import type { AuthStatus } from '../../src/shared/ipc-contract';

// ponytail: the preload bridge test mocks invoke() to return whatever the
// caller hands it; the real handler test asserts the actual AuthStatus shape
// (which is the real return from registerAuthIpc().AUTH_STATUS).
const STUB_PAYLOAD = { authenticated: false, reason: 'scaffold' as const };
const EXPECTED_AUTH_STATUS: AuthStatus = {
  hasUsers: false,
  authenticated: false,
  userId: null,
  clinicName: null,
  isFirstAdmin: false,
};

const handleMock = vi.fn();
const invokeMock = vi.fn().mockResolvedValue(STUB_PAYLOAD);
let exposedApi: unknown = null;

// ponytail: registerAuthIpc() now transitively reaches userRepo.countActive(),
// which opens the DB. Give the electron mock a temp userData path so the
// import-time chain doesn't blow up. The test itself never exercises the DB.
let tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-auth-shell-'));

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b,
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  contextBridge: {
    exposeInMainWorld: (_name: string, api: unknown) => {
      exposedApi = api;
    },
  },
  ipcRenderer: {
    invoke: (...args: unknown[]) => invokeMock(...args),
  },
  ipcMain: {
    handle: (channel: string, fn: () => unknown) => {
      handleMock(channel, fn);
    },
  },
}));

describe('preload exposes auth.status over the IPC.AUTH_STATUS channel', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    handleMock.mockClear();
    exposedApi = null;
  });

  it('window.api.auth.status() invokes "auth:status" and returns the stub payload', async () => {
    await import('../../src/preload/index');
    const api = exposedApi as { auth: { status: () => Promise<typeof STUB_PAYLOAD> } };
    expect(typeof api.auth.status).toBe('function');
    const result = await api.auth.status();
    expect(result).toEqual(STUB_PAYLOAD);
    expect(invokeMock).toHaveBeenCalledWith(IPC.AUTH_STATUS);
    expect(IPC.AUTH_STATUS).toBe('auth:status');
  });
});

describe('main auth handler returns the literal scaffold payload', () => {
  beforeEach(() => {
    handleMock.mockClear();
  });

  it('registerAuthIpc registers IPC.AUTH_STATUS and the handler returns the payload', async () => {
    const { registerAuthIpc } = await import('../../src/main/ipc/auth');
    registerAuthIpc();
    // Per Fix 7: registerAuthIpc now registers 8 channels (status, bootstrap,
    // login, logout, users-list, recovery-request, accept-recovery-file,
    // wizard-bootstrap). We just need IPC.AUTH_STATUS to be among them.
    const statusCall = handleMock.mock.calls.find(([channel]) => channel === IPC.AUTH_STATUS);
    expect(statusCall, 'AUTH_STATUS handler missing').toBeDefined();
    const [channel, fn] = statusCall!;
    expect(channel).toBe(IPC.AUTH_STATUS);
    expect(fn()).toEqual(EXPECTED_AUTH_STATUS);
  });
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});
