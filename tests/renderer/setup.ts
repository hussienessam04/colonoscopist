// Renderer test scaffolding. happy-dom + @testing-library/react + a window.api mock router.
// Per Plan 02-03 task 1. Tests use this file as the per-test setup; each test installs
// its own window.api mock via mockApi() to keep IPC assertions per-test.

import { afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { initialRoute, setRoute } from '@/lib/router';
import { session } from '@/store/session';

type MockApi = {
  auth: {
    status: ReturnType<typeof vi.fn>;
    bootstrap: ReturnType<typeof vi.fn>;
    wizard: ReturnType<typeof vi.fn>;
    login: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
    usersList: ReturnType<typeof vi.fn>;
    recoveryRequest: ReturnType<typeof vi.fn>;
    acceptRecoveryFile: ReturnType<typeof vi.fn>;
  };
  users: {
    create: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    resetPin: ReturnType<typeof vi.fn>;
  };
  patients: {
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    softDelete: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
  };
  audit: {
    list: ReturnType<typeof vi.fn>;
  };
};

export function mockApi(): MockApi {
  const api: MockApi = {
    auth: {
      status: vi.fn(),
      bootstrap: vi.fn(),
      wizard: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      usersList: vi.fn(),
      recoveryRequest: vi.fn(),
      acceptRecoveryFile: vi.fn(),
    },
    users: {
      create: vi.fn(),
      remove: vi.fn(),
      resetPin: vi.fn(),
    },
    patients: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
      restore: vi.fn(),
    },
    audit: {
      list: vi.fn(),
    },
  };
  (window as unknown as { api: MockApi }).api = api;
  return api;
}

export function getApi(): MockApi {
  return (window as unknown as { api: MockApi }).api;
}

beforeEach(() => {
  mockApi();
  setRoute(initialRoute);
  session.reset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
