// Renderer test scaffolding. happy-dom + @testing-library/react + a window.api mock router.
// Per Plan 02-03 task 1. Tests use this file as the per-test setup; each test installs
// its own window.api mock via mockApi() to keep IPC assertions per-test.

import { afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { initialRoute, setRoute } from '@/lib/router';
import { session } from '@/store/session';
// Phase 7 / Plan 07-04 — I18N-01 + D-19: i18next must be initialized before
// any component that calls useTranslation() / useLanguage() mounts in the
// test environment. main.tsx normally fires the side-effect import, but
// tests import components directly without going through main.tsx, so the
// init never runs. Importing the i18n module here ensures the bundles
// load + the default language (en) is active for every renderer test.
import '@/i18n';

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
    // Phase 7 / Plan 07-03 — AUDIT-01 + D-08: renderer-initiated audit
    // row write for "audit-on-every-read" patterns (the Audit page
    // calls audit.log({action: 'audit_view'}) on mount). The hook
    // resolves to { ok: true } so the page render doesn't crash
    // before the test seeds a specific shape.
    log: ReturnType<typeof vi.fn>;
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
    // Phase 8 / Plan 14 — permanent crop (SCRN-02 extended).
    crop: ReturnType<typeof vi.fn>;
    // Phase 8 / Plan 15 (G-08-8) — read JPEG bytes off disk so the
    // renderer can build a `blob:` URL (avoids canvas-taint on crop).
    getBlob: ReturnType<typeof vi.fn>;
  };
  // Phase 8 / Plan 15 (G-08-8) — main-process clipboard write. Replaces
  // navigator.clipboard.writeText for the License page machine-id copy.
  clipboard: {
    copyText: ReturnType<typeof vi.fn>;
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
    // Quick task 260812-ns0 — header / footer image uploads + extended
    // asset-data-url kind enum.
    uploadHeader: ReturnType<typeof vi.fn>;
    uploadFooter: ReturnType<typeof vi.fn>;
    getAssetDataUrl: ReturnType<typeof vi.fn>;
  };
  // Quick task 260812-ns0 — used-devices CRUD.
  usedDevices: {
    list: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  reports: {
    getOrCreate: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    // Phase 7 / Plan 07-02 — SRCH-03 + D-03: read-only lookup by
    // procedureId (returns null when no report exists). Used by the
    // PatientProcedures page (quick task 20260811).
    getByProcedure: ReturnType<typeof vi.fn>;
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
  // Phase 7 / Plan 07-05 — backup + restore namespaces. The default
  // mocks resolve to safe empty values so any test that mounts the
  // BackupRestore page without per-test seeding doesn't crash. Tests
  // that exercise specific branches seed `mockResolvedValue`
  // per-test.
  backup: {
    create: ReturnType<typeof vi.fn>;
    reveal: ReturnType<typeof vi.fn>;
    pickDestination: ReturnType<typeof vi.fn>;
  };
  restore: {
    preview: ReturnType<typeof vi.fn>;
    unpack: ReturnType<typeof vi.fn>;
    pickZip: ReturnType<typeof vi.fn>;
    revealStaging: ReturnType<typeof vi.fn>;
  };
  // Phase 8 / Plan 08-05 — License sub-page + LicenseGate modal. The
  // status mock defaults to the unactivated state so a renderer test
  // that mounts any page WITHOUT per-test seeding does not show the
  // activation modal over the test render. Tests that exercise the
  // License sub-page seed status/activate/pickAndActivate per-test.
  license: {
    status: ReturnType<typeof vi.fn>;
    activate: ReturnType<typeof vi.fn>;
    pickAndActivate: ReturnType<typeof vi.fn>;
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
      list: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
      log: vi.fn().mockResolvedValue({ ok: true }),
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
      crop: vi.fn().mockResolvedValue({
        ok: true,
        newDimensions: { width: 10, height: 10 },
        byteSize: 4,
      }),
      // Plan 15 (G-08-8) — default getBlob resolves to a tiny mock JPEG
      // so the ScreenshotCropModal can boot without per-test seeding
      // (tests that need different behavior override per-test).
      getBlob: vi.fn().mockResolvedValue({
        ok: true,
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]),
        mimeType: 'image/jpeg',
      }),
    },
    // Plan 15 (G-08-8) — clipboard defaults to a no-op {ok:true} so
    // the License page can render without crashing on the Copy button.
    clipboard: {
      copyText: vi.fn().mockResolvedValue({ ok: true as const }),
    },
    // Phase 6 / Plan 02 — defaults that resolve to safe empty values
    // so any page that mounts the ProfileEditor / ReportEditor on
    // initial render doesn't crash before the per-test seeds arrive.
    profile: {
      get: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      uploadSignature: vi.fn().mockResolvedValue({ signaturePath: 'sig.png' }),
      uploadLogo: vi.fn().mockResolvedValue({ logoPath: 'logo.png' }),
      // Quick task 260812-ns0 — header / footer image uploads.
      uploadHeader: vi.fn().mockResolvedValue({ headerImagePath: 'header.png' }),
      uploadFooter: vi.fn().mockResolvedValue({ footerImagePath: 'footer.png' }),
      getAssetDataUrl: vi.fn().mockResolvedValue({ dataUrl: null }),
    },
    // Quick task 260812-ns0 — used-devices CRUD (1:N with doctor_profile).
    usedDevices: {
      list: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockImplementation(async (input: { name: string; notes?: string | null }) => ({
        id: '00000000-0000-4000-8000-000000000999',
        profileId: '00000000-0000-4000-8000-000000000888',
        name: input.name,
        notes: input.notes ?? null,
        sortOrder: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      remove: vi.fn().mockResolvedValue({ ok: true as const }),
    },
    reports: {
      getOrCreate: vi.fn().mockResolvedValue(null),
      get: vi.fn().mockResolvedValue(null),
      getByProcedure: vi.fn().mockResolvedValue(null),
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
    // Phase 7 / Plan 07-05 — BackupRestore page tests mock
    // pickDestination / pickZip to drive the file-picker branches;
    // create / preview / unpack reject when called without seeding so
    // accidental flows surface. reveal / revealStaging resolve to
    // { ok: true } (no-op reveal) so the success toast path is reachable.
    backup: {
      create: vi.fn(),
      reveal: vi.fn().mockResolvedValue({ ok: true }),
      pickDestination: vi.fn().mockResolvedValue(null),
    },
    restore: {
      preview: vi.fn(),
      unpack: vi.fn(),
      pickZip: vi.fn().mockResolvedValue(null),
      revealStaging: vi.fn().mockResolvedValue({ ok: true }),
    },
    // Phase 8 / Plan 08-06 — Default license.status() resolves to the
    // 'unactivated' state so any renderer test that mounts a page without
    // per-test seeding does not crash. The shape matches LicenseStatus
    // from @shared/ipc-contract; activate + pickAndActivate reject so an
    // accidental click surfaces as a test failure rather than a silent
    // success.
    license: {
      status: vi.fn().mockResolvedValue({
        state: 'unactivated',
        vendorId: null,
        licensedAt: null,
        expiresAt: null,
        trialStartedAt: null,
        trialDaysRemaining: null,
        machineId: 'a'.repeat(64),
      }),
      activate: vi.fn(),
      pickAndActivate: vi.fn().mockResolvedValue({
        ok: false,
        code: 'IPC_LICENSE_CANCELLED' as const,
      }),
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
