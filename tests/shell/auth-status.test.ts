import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IPC } from '../../src/shared/ipc-contract';

const STUB_PAYLOAD = { authenticated: false, reason: 'scaffold' as const };

const handleMock = vi.fn();
const invokeMock = vi.fn().mockResolvedValue(STUB_PAYLOAD);
let exposedApi: unknown = null;

vi.mock('electron', () => ({
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
    expect(handleMock).toHaveBeenCalledTimes(1);
    const [channel, fn] = handleMock.mock.calls[0];
    expect(channel).toBe(IPC.AUTH_STATUS);
    expect(fn()).toEqual(STUB_PAYLOAD);
  });
});
