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
  capture: {
    listDevices: ReturnType<typeof vi.fn>;
    getDefaultDevice: ReturnType<typeof vi.fn>;
    setDefaultDevice: ReturnType<typeof vi.fn>;
    getPreset: ReturnType<typeof vi.fn>;
    setPreset: ReturnType<typeof vi.fn>;
    noDeviceAudit: ReturnType<typeof vi.fn>;
  };
  procedures: {
    create: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    finalize: ReturnType<typeof vi.fn>;
    trim: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    listSegments: ReturnType<typeof vi.fn>;
  };
  procedureNotes: {
    create: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
  recording: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    forceCleanup: ReturnType<typeof vi.fn>;
    onStatus: ReturnType<typeof vi.fn>;
    getMediaUrl: ReturnType<typeof vi.fn>;
  };
  screenshots: {
    add: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    updateAnnotation: ReturnType<typeof vi.fn>;
  };
  // Phase 6 / Plan 02 — Profile + Reports namespaces. Plan 06-01 wired
  // the IPC contract; the renderer pages (ProfileEditor, ReportEditor,
  // ProcedureReview CTA) call these on mount. Tests seed defaults via
  // mockResolvedValue per-test; the empty vi.fn() ensures happy-dom
  // doesn't crash if a page mounts before the test seeds a specific
  // shape.
  profile: {
    get: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    uploadSignature: ReturnType<typeof vi.fn>;
    uploadLogo: ReturnType<typeof vi.fn>;
  };
  reports: {
    getOrCreate: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    updateDraft: ReturnType<typeof vi.fn>;
    updateFinalized: ReturnType<typeof vi.fn>;
    finalize: ReturnType<typeof vi.fn>;
    regenPdf: ReturnType<typeof vi.fn>;
    openPdf: ReturnType<typeof vi.fn>;
    attachScreenshot: ReturnType<typeof vi.fn>;
    detachScreenshot: ReturnType<typeof vi.fn>;
    reorderScreenshots: ReturnType<typeof vi.fn>;
    listScreenshots: ReturnType<typeof vi.fn>;
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
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
      restore: vi.fn(),
    },
    audit: {
      list: vi.fn().mockResolvedValue([]),
    },
    capture: {
      listDevices: vi.fn().mockResolvedValue([]),
      getDefaultDevice: vi.fn().mockResolvedValue(null),
      setDefaultDevice: vi.fn(),
      getPreset: vi.fn().mockResolvedValue(null),
      setPreset: vi.fn(),
      noDeviceAudit: vi.fn().mockResolvedValue({ ok: true }),
    },
    procedures: {
      create: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      finalize: vi.fn(),
      trim: vi.fn(),
      restore: vi.fn(),
      listSegments: vi.fn().mockResolvedValue([]),
    },
    procedureNotes: {
      create: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    },
    recording: {
      start: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      forceCleanup: vi.fn().mockResolvedValue(undefined),
      onStatus: vi.fn(),
      getMediaUrl: vi.fn().mockResolvedValue('http://127.0.0.1:0'),
    },
    // Plan 05-04 — defaults that resolve to [] / a minimal Screenshot so
    // renderer pages can render without their useEffects throwing
    // "Cannot read properties of undefined (reading 'then')". Tests that
    // need different behavior override per-test.
    screenshots: {
      add: vi.fn().mockResolvedValue({
        id: 1,
        procedureId: '',
        timestampInVideoMs: 0,
        filePath: '',
        annotation: null,
        createdAt: 0,
      }),
      list: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      updateAnnotation: vi.fn(),
    },
    // Phase 6 / Plan 02 — defaults that resolve to safe empty values
    // so any page that mounts the ProfileEditor / ReportEditor on
    // initial render doesn't crash before the per-test seeds arrive.
    profile: {
      get: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      uploadSignature: vi.fn().mockResolvedValue({ signaturePath: 'sig.png' }),
      uploadLogo: vi.fn().mockResolvedValue({ logoPath: 'logo.png' }),
    },
    reports: {
      getOrCreate: vi.fn().mockResolvedValue(null),
      get: vi.fn().mockResolvedValue(null),
      updateDraft: vi.fn(),
      updateFinalized: vi.fn(),
      finalize: vi.fn(),
      regenPdf: vi.fn().mockResolvedValue({ pdfPath: 'r.pdf' }),
      openPdf: vi.fn().mockResolvedValue({ opened: true }),
      attachScreenshot: vi.fn().mockResolvedValue({ ok: true }),
      detachScreenshot: vi.fn().mockResolvedValue({ ok: true }),
      reorderScreenshots: vi.fn().mockResolvedValue({ ok: true }),
      listScreenshots: vi.fn().mockResolvedValue([]),
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
  // ponytail: tests that fire-and-forget `session.refresh()` (e.g.
  // patients-list.test.tsx) leave the session store polluted across tests
  // — the pending async refresh resolves AFTER the next beforeEach's
  // `session.reset()`, overwriting the fresh null state with stale admin
  // credentials. Resetting AFTER cleanup() gives a stable baseline for
  // the next test.
  session.reset();
  // ponytail: `clearAllMocks` clears mock history (call counts) without
  // tearing down `.mockResolvedValue` implementations. `restoreAllMocks`
  // would strip implementations from `vi.fn()` instances mid-test,
  // which is the cascade-pollution that surfaced as `Cannot read
  // properties of undefined (reading 'then')` in ProcedureReview when
  // a prior test's async `.then` resolves against an implementation-
  // wiped mock.
  vi.clearAllMocks();
});
