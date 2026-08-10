// Single source of truth for IPC channel names and contract types.
// Imported by main, preload, and renderer (via global Window augmentation).
//
// Phase 2 expands the AUTH_STATUS shape and adds the full auth/users/audit/patients surface.
// Plan 02-02 adds the patients.* channels and Plan 02-03 wires the renderer.

export const IPC = {
  // Auth
  AUTH_STATUS: 'auth:status',
  AUTH_BOOTSTRAP: 'auth:bootstrap',
  AUTH_WIZARD: 'auth:wizard-bootstrap',
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_USERS_LIST: 'auth:users-list',
  AUTH_RECOVERY_REQUEST: 'auth:recovery-request',
  AUTH_ACCEPT_RECOVERY_FILE: 'auth:accept-recovery-file',
  // Users
  USERS_CREATE: 'users:create',
  USERS_REMOVE: 'users:remove',
  USERS_RESET_PIN: 'users:reset-pin',
  // Patients (Plan 02-02 wires the handlers; constants declared here so IpcContract compiles)
  PATIENTS_LIST: 'patients:list',
  PATIENTS_GET: 'patients:get',
  PATIENTS_CREATE: 'patients:create',
  PATIENTS_UPDATE: 'patients:update',
  PATIENTS_SOFT_DELETE: 'patients:soft-delete',
  PATIENTS_RESTORE: 'patients:restore',
  // Audit
  AUDIT_LIST: 'audit:list',
  // Capture (Plan 03-01)
  CAPTURE_LIST_DEVICES: 'capture:list-devices',
  CAPTURE_GET_DEFAULT_DEVICE: 'capture:get-default-device',
  CAPTURE_SET_DEFAULT_DEVICE: 'capture:set-default-device',
  CAPTURE_GET_PRESET: 'capture:get-preset',
  CAPTURE_SET_PRESET: 'capture:set-preset',
  CAPTURE_NO_DEVICE_AUDIT: 'capture:no-device-audit',
  // Procedures (Plan 04-01)
  PROCEDURES_CREATE: 'procedures:create',
  PROCEDURES_GET: 'procedures:get',
  PROCEDURES_LIST: 'procedures:list',
  PROCEDURES_FINALIZE: 'procedures:finalize',
  // Procedure notes (declared here; Plan 02-of-phase-04 wires the handler)
  PROCEDURE_NOTES_CREATE: 'procedure-notes:create',
  PROCEDURE_NOTES_LIST: 'procedure-notes:list',
  // Recording (Plan 04-01)
  RECORDING_START: 'recording:start',
  RECORDING_STOP: 'recording:stop',
  // Plan 04-03 — Pause/Resume handlers. `recording.onStatus` push event already
  // carries the `paused` + `resumed` arms.
  RECORDING_PAUSE: 'recording:pause',
  RECORDING_RESUME: 'recording:resume',
  // Force-cleanup: renderer unmounts ProcedureRoom while recording is
  // active (e.g. doctor clicks "Back to Preview" mid-recording). Main
  // kills any active recorder for the given procedureId so the next
  // session isn't blocked by a stale registry entry.
  RECORDING_FORCE_CLEANUP: 'recording:force-cleanup',
  // Push event channel — value is the channel string the renderer subscribes to.
  RECORDING_STATUS: 'recording:status',
  // Phase 5 / Plan 03 — long-lived media server URL for the renderer's
  // <video> element to compose /media/<patientId>/<procedureId>/<file>.
  RECORDING_GET_MEDIA_URL: 'recording:get-media-url',
  // Phase 5 / Plan 01 — screenshots + trim surface. Trim/restore handlers
  // throw IPC_NOT_IMPLEMENTED in Plan 01; Plan 03 fills them.
  SCREENSHOTS_ADD: 'screenshots:add',
  SCREENSHOTS_LIST: 'screenshots:list',
  SCREENSHOTS_DELETE: 'screenshots:delete',
  SCREENSHOTS_UPDATE_ANNOTATION: 'screenshots:update-annotation',
  PROCEDURES_TRIM: 'procedures:trim',
  PROCEDURES_RESTORE: 'procedures:restore',
  // Phase 5 / Plan 02 — pause markers from procedure_segments. Renderer
  // fetches the segments list so the Scrubber can render D-11 ticks.
  PROCEDURES_LIST_SEGMENTS: 'procedures:list-segments',
  // Phase 6 / Plan 01 — Doctor profile + report editor + PDF generation.
  // PROFILE_GET/UPDATE/UPLOAD_SIGNATURE/UPLOAD_LOGO per PROF-01;
  // REPORTS_* per RPT-01..05 + RPT-07 (RPT-06 deferred to Phase 7 i18n).
  PROFILE_GET: 'profile:get',
  PROFILE_UPDATE: 'profile:update',
  PROFILE_UPLOAD_SIGNATURE: 'profile:upload-signature',
  PROFILE_UPLOAD_LOGO: 'profile:upload-logo',
  PROFILE_GET_ASSET_DATA_URL: 'profile:get-asset-data-url',
  REPORTS_GET_OR_CREATE: 'reports:get-or-create',
  REPORTS_GET: 'reports:get',
  REPORTS_UPDATE_DRAFT: 'reports:update-draft',
  REPORTS_UPDATE_FINALIZED: 'reports:update-finalized',
  REPORTS_FINALIZE: 'reports:finalize',
  REPORTS_OPEN_PDF: 'reports:open-pdf',
  REPORTS_REGEN_PDF: 'reports:regen-pdf',
  REPORTS_ATTACH_SCREENSHOT: 'reports:attach-screenshot',
  REPORTS_DETACH_SCREENSHOT: 'reports:detach-screenshot',
  REPORTS_REORDER_SCREENSHOTS: 'reports:reorder-screenshots',
  REPORTS_LIST_SCREENSHOTS: 'reports:list-screenshots',
  // Phase 6 UAT G-06-11 — return the PDF bytes as a Uint8Array so the
  // renderer can build a blob: URL and load it in an iframe for the
  // Print preview button. The MediaServer only serves /media/...
  // (patient/procedure media files), not the report PDF (which lives
  // under data/reports/), so the renderer can't fetch the file via
  // the MediaServer. The data bridge IPC is the cleanest path.
  REPORTS_GET_PDF_BLOB: 'reports:get-pdf-blob',
  // Phase 7 / Plan 07-01 — Backup/Restore + audit.log channels
  // (SET-05, SET-06, AUDIT-01). The audit:log channel is the
  // renderer-side write path for "audit-on-every-read" patterns
  // (D-08) — every renderer-initiated read of patient data writes a
  // row. The backup:* / restore:* channels wrap the main-side module
  // in src/main/backup/.
  BACKUP_CREATE: 'backup:create',
  BACKUP_REVEAL: 'backup:reveal',
  RESTORE_PREVIEW: 'restore:preview',
  RESTORE_UNPACK: 'restore:unpack',
  AUDIT_LOG: 'audit:log',
} as const;

// Phase 7 / Plan 07-01 — Restore preview shape returned by
// restore:preview (RESTORE_PREVIEW). Declared at the bottom of the
// file so the IpcContract interface can reference it.
export type RestorePreview = {
  filename: string;
  totalSize: number;
  dbIntegrityCheck: string;
  procedureCount: number;
};

// CAPT-10 / D-11 — canonical dshow device. `deviceId` is the canonical form
// (NFC + trim + collapse-spaces) used everywhere; `rawName` is the original
// ffmpeg string, kept for audit only.
export type CaptureDevice = {
  deviceId: string;
  rawName: string;
  index: number;
  type: 'dshow';
};

// SET-02 / D-05 — discriminated preset. Custom exposes exactly the two
// fields the spec locks (resolution + framerate); bitrate/pixel-format/GOP
// are Phase 4 ffmpeg concerns.
export type QualityPreset =
  | { preset: 'sd' }
  | { preset: 'hd' }
  | { preset: 'custom'; resolution: string; framerate: number };

// Authoritative auth state — single source of truth shared across main + preload + renderer.
// Per Fix 4. Renderer mirrors this shape; main owns the truth.
export type AuthStatus = {
  hasUsers: boolean;
  authenticated: boolean;
  userId: string | null;
  clinicName: string | null;
  isFirstAdmin: boolean;
};

// Login response discriminated union.
export type LoginResult =
  | { ok: true; user: UserPublic }
  | { ok: false; code: 'IPC_AUTH_FAILED' | 'IPC_RATE_LIMITED' | 'IPC_LOCKED'; retryAt?: number };

// UserPublic — shape returned by auth.listUsers + login + users.create.
// Phase 7 / Plan 07-01 — I18N-01: includes the workstation-level
// language default (per D-18). The renderer can use this to set up the
// initial i18n context before the per-doctor doctor_profile.language
// has been resolved.
export type UserPublic = {
  id: string;
  fullName: string;
  isFirstAdmin: boolean;
  lastLoginAt: number | null;
  failedAttempts: number;
  lockedUntil: number | null;
  language: 'en' | 'ar';
};

export type Patient = {
  id: string;
  fullName: string;
  dob: string;
  gender: 'male' | 'female' | 'other' | null;
  mrn: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type AuditEntry = {
  id: number;
  userId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  outcome: 'ok' | 'failed' | 'rate_limited';
  createdAt: number;
};

export type RecoveryResponse = {
  accepted: true;
  verificationDeferred: true;
  machineFingerprint: string;
  mailto: string;
};

// Wizard bootstrap submit shape (per D-01). Renderer submits this once on first launch.
// Main registers the channel under IPC.AUTH_WIZARD (auth:wizard-bootstrap) and returns
// { accepted: true, userId, clinicName } but does NOT log the user in — the renderer
// then calls auth.login() to land on the patient list.
//
// Phase 7 / Plan 07-01 — I18N-01: optional `language` field (default 'en').
// Persisted to users.language (per D-18). Per-doctor overrides live on
// doctor_profile.language (D-17).
export type WizardSubmitInput = {
  fullName: string;
  clinicName: string;
  pin: string;
  confirmPin: string;
  language?: 'en' | 'ar';
};

export type WizardSubmitResult = {
  accepted: true;
  userId: string;
  clinicName: string;
};

// Phase 4 — Procedure + related domain types (CAPT-04/05/06/07).

// Snapshot of the recording-time preset for the procedure row.
export type PresetSummary = {
  kind: 'sd' | 'hd' | 'custom';
  resolution: string;
  framerate: number;
  bitrate: string;
};

export type ProcedureStatus = 'recording' | 'completed' | 'partial' | 'crashed';

export type Procedure = {
  id: string;
  patientId: string;
  doctorId: string;
  startedAt: number;
  endedAt: number | null;
  durationSeconds: number;
  status: ProcedureStatus;
  videoPath: string;
  // D-07 — populated on the first trim and never overwritten. The trim
  // IPC handler reads this column to decide the canonical restore source;
  // the renderer uses it to gate the "Restore original" button.
  videoPathOriginal: string | null;
  presetSummary: PresetSummary;
  audioDeviceName: string | null;
  createdAt: number;
};

export type ProcedureNote = {
  id: number;
  procedureId: string;
  body: string;
  createdAt: number;
};

export type ProcedureSegment = {
  id: number;
  procedureId: string;
  segmentIndex: number;
  filePath: string;
  startedAt: number;
  endedAt: number;
};

// Phase 5 / Plan 01 / D-04 + D-05 — single screenshot row. `filePath` is
// stored as a userData-relative path per Anti-Pattern 2; the absolute path
// is resolved at read time.
export type Screenshot = {
  id: number;
  procedureId: string;
  timestampInVideoMs: number;
  filePath: string;
  annotation: string | null;
  createdAt: number;
};

// Phase 6 / Plan 01 — Doctor profile (PROF-01). Per CONTEXT.md D-02 the
// bilingual EN+AR fields are parallel nullable columns; AR columns are
// NULL until Phase 7 lands the per-doctor language preference. The
// signature + logo paths are userData-relative per Anti-Pattern 2.
//
// Phase 7 / Plan 07-01 — I18N-01: `language` is the per-doctor
// override (per D-17). NULL means "follow users.language".
export type DoctorProfile = {
  id: string;
  userId: string;
  fullNameEn: string;
  fullNameAr: string | null;
  clinicNameEn: string;
  clinicNameAr: string | null;
  address: string | null;
  phone: string | null;
  signaturePath: string | null;
  logoPath: string | null;
  language: 'en' | 'ar' | null;
  createdAt: number;
  updatedAt: number;
};

// Phase 6 / Plan 01 — Report (RPT-01..05). Per D-05 the procedure FK is
// UNIQUE (1:1 reports-per-procedure); per D-06 finalized_at is frozen
// after Finalize; per D-07 the four free-text fields are the only
// patchable columns. pdfPath is userData-relative per Anti-Pattern 2.
export type Report = {
  id: string;
  procedureId: string;
  doctorId: string;
  findings: string;
  diagnosis: string;
  recommendations: string;
  procedureDetails: string;
  status: 'draft' | 'finalized';
  finalizedAt: number | null;
  pdfPath: string | null;
  pdfGeneratedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

// Phase 6 / Plan 01 — Join row from report_screenshots (RPT-03).
export type ReportScreenshot = {
  reportId: string;
  screenshotId: number;
  sortOrder: number;
};

// Discriminated union for the recording:status push event.
// Plan 04-01 only emits `started` and `stopped`; paused/resumed are Plan 03,
// lost is Plan 04. The shape is fixed now so the renderer's store is final.
export type RecordingStatus =
  | { status: 'started'; startedAt: number; currentSegmentIndex: number }
  | { status: 'paused'; startedAt: number; currentSegmentIndex: number }
  | { status: 'resumed'; startedAt: number; currentSegmentIndex: number }
  | { status: 'stopped'; startedAt: number; procedureId: string }
  | { status: 'lost'; startedAt: number; lastKnownTimestampMs: number; deviceName: string };

// Partial metadata stored when a recording terminates with status='partial'
// (device lost). Plan 04 fills this; declared here so the IPC contract is final.
export type ProcedurePartialJson = {
  lastKnownTimestampMs: number;
  deviceLostAt: number;
  deviceName: string;
};

// What `contextBridge.exposeInMainWorld('api', api)` exposes to the renderer.
export interface IpcContract {
  auth: {
    status: () => Promise<AuthStatus>;
    bootstrap: () => Promise<{ hasUsers: boolean; clinicName: string | null; userId: string | null }>;
    wizard: (input: WizardSubmitInput) => Promise<WizardSubmitResult>;
    login: (input: { userId: string; pin: string }) => Promise<LoginResult>;
    logout: () => Promise<{ ok: true }>;
    usersList: () => Promise<UserPublic[]>;
    recoveryRequest: () => Promise<RecoveryResponse>;
    acceptRecoveryFile: () => Promise<{ accepted: true; verificationDeferred: true }>;
  };
  users: {
    // Phase 7 / Plan 07-01 — I18N-01: optional `language` field on
    // users.create. Persisted to users.language (default 'en').
    create: (input: { fullName: string; pin: string; language?: 'en' | 'ar' }) => Promise<UserPublic>;
    remove: (input: { userId: string }) => Promise<{ ok: true }>;
    resetPin: (input: { userId: string; newPin: string }) => Promise<{ ok: true }>;
  };
  patients: {
    list: (query: {
      search?: string;
      mrn?: string;
      includeDeleted?: boolean;
      page?: number;
      pageSize?: number;
    }) => Promise<{ rows: Patient[]; total: number }>;
    get: (id: string) => Promise<Patient | null>;
    create: (
      input: Omit<Patient, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
    ) => Promise<Patient>;
    update: (id: string, patch: Partial<Pick<Patient, 'fullName' | 'dob' | 'gender' | 'mrn' | 'phone' | 'notes'>>) => Promise<Patient>;
    softDelete: (id: string) => Promise<{ ok: true }>;
    restore: (id: string) => Promise<{ ok: true }>;
  };
  audit: {
    list: (query: {
      from?: number;
      to?: number;
      action?: string;
      userId?: string;
      page?: number;
      pageSize?: number;
    }) => Promise<{ rows: AuditEntry[]; total: number }>;
    // Phase 7 / Plan 07-01 — AUDIT-01: renderer-initiated audit row
    // for "audit-on-every-read" patterns (D-08). The handler routes
    // through the audit() helper in main; no other write surface
    // exists for audit_log.
    log: (input: {
      action: string;
      entityType?: string;
      entityId?: string;
      metadata?: Record<string, unknown>;
    }) => Promise<{ ok: true }>;
  };
  // Per D-01 + BLOCKER 4: setPreset / setDefaultDevice payloads do NOT include
  // a doctorId field. Main derives the doctorId from `requireSession()` and
  // the renderer cannot impersonate another doctor.
  capture: {
    listDevices: () => Promise<CaptureDevice[]>;
    getDefaultDevice: () => Promise<string | null>;
    setDefaultDevice: (input: { deviceId: string }) => Promise<{ ok: true }>;
    getPreset: (input: { deviceId: string }) => Promise<QualityPreset | null>;
    setPreset: (input: { deviceId: string; preset: QualityPreset }) => Promise<{ ok: true }>;
    noDeviceAudit: () => Promise<{ ok: true }>;
  };
  // Per BLOCKER 4 + D-01: procedure payloads do NOT include a doctorId field.
  // Main derives the doctorId from `requireSession()` exclusively.
  procedures: {
    create: (input: { patientId: string }) => Promise<Procedure>;
    get: (input: { id: string }) => Promise<Procedure | null>;
    list: (input: {
      patientId?: string;
      status?: ProcedureStatus;
      page?: number;
      pageSize?: number;
    }) => Promise<{ rows: Procedure[]; total: number }>;
    finalize: (input: {
      id: string;
      status: 'completed' | 'partial';
      endedAt: number;
      durationSeconds: number;
      videoPath: string;
      partialJson?: ProcedurePartialJson;
    }) => Promise<Procedure>;
    // Phase 5 / Plan 01 — Trim + Restore are declared in Plan 01 so the
    // renderer contract doesn't shift. The handlers throw IPC_NOT_IMPLEMENTED
    // in Plan 01; Plan 03 fills them. @plan Implemented in Plan 03/05-03.
    trim: (input: { id: string; inMs: number; outMs: number }) => Promise<Procedure>;
    restore: (input: { id: string }) => Promise<Procedure>;
    // Phase 5 / Plan 02 — pause-marker source. Returns the procedure_segments
    // rows for the scrubber (D-11).
    listSegments: (input: { procedureId: string }) => Promise<ProcedureSegment[]>;
  };
  // Plan 02-of-phase-04 fills the main handlers. Preload bridge is final here
  // so the renderer contract never needs to change shape in Plan 02.
  procedureNotes: {
    create: (input: { procedureId: string; body: string }) => Promise<ProcedureNote>;
    list: (input: { procedureId: string }) => Promise<ProcedureNote[]>;
  };
  // Plan 04-01 ships start + stop + onStatus (push event). pause/resume land
  // in Plan 03; lost + scanForOrphans land in Plan 04.
  // Plan live-preview-tee: `start` returns previewUrl (http://127.0.0.1:<port>/preview)
  // pointing at the MJPEG-tee stream that ffmpeg writes alongside the mp4.
  // Renderer's <img src=previewUrl> subscribes while isRecording===true so
  // the doctor sees the camera feed during recording (ffmpeg holds the
  // DirectShow device lock so renderer's getUserMedia can't get a stream).
  // Plan 05-03 adds getMediaUrl(): long-lived localhost URL that the renderer
  // composes with `/media/<patientId>/<procedureId>/<videoFile>` for the
  // <video> element. Stays bound across ProcedureReview sessions.
  recording: {
    start: (input: { patientId: string; procedureId?: string; deviceId: string; preset: QualityPreset }) => Promise<{ procedureId: string; startedAt: number; previewUrl: string }>;
    stop: (input: { procedureId: string }) => Promise<void>;
    pause: (input: { procedureId: string }) => Promise<void>;
    resume: (input: { procedureId: string }) => Promise<void>;
    forceCleanup: (input: { procedureId: string }) => Promise<void>;
    onStatus: (cb: (status: RecordingStatus) => void) => () => void;
    getMediaUrl: () => Promise<string>;
  };
  // Phase 5 / Plan 01. `add` takes the base64 JPEG inline so the renderer
  // doesn't need an extra file-write round-trip; the IPC handler writes the
  // JPEG to disk itself after validating payload size. `list` returns
  // rows ASC by `timestampInVideoMs` for the timeline query.
  screenshots: {
    add: (input: { procedureId: string; timestampInVideoMs: number; jpegBase64: string }) => Promise<Screenshot>;
    list: (input: { procedureId: string }) => Promise<Screenshot[]>;
    delete: (input: { id: number }) => Promise<{ ok: true }>;
    updateAnnotation: (input: { id: number; annotation: string | null }) => Promise<Screenshot>;
  };
  // Phase 6 / Plan 01 — Doctor profile (PROF-01). Per Phase 2 BLOCKER 4
  // + D-07, the renderer never sends a `userId` or `doctorId` field — main
  // derives them from `requireSession()`. `uploadSignature` and
  // `uploadLogo` accept EITHER `{ jpegBase64 }` OR `{ pngBase64 }`
  // (validated at the IPC boundary via magic-byte sniff in Plan 02).
  profile: {
    get: () => Promise<DoctorProfile | null>;
    update: (input: {
      fullNameEn: string;
      fullNameAr: string | null;
      clinicNameEn: string;
      clinicNameAr: string | null;
      address: string | null;
      phone: string | null;
      // Phase 7 / Plan 07-01 — I18N-01: per-doctor language override.
      // NULL means "follow users.language" (the doctor has not picked
      // their own preference yet). The i18n resolver reads this column
      // first, then falls back to the session's users.language.
      language?: 'en' | 'ar' | null;
    }) => Promise<DoctorProfile>;
        uploadSignature: (input: { jpegBase64?: string; pngBase64?: string }) => Promise<{ signaturePath: string }>;
        uploadLogo: (input: { jpegBase64?: string; pngBase64?: string }) => Promise<{ logoPath: string }>;
        // Phase 6 UAT G-06-3 — image preview. Returns a data URL the
        // renderer can drop straight into <img src=...> for the
        // signature + logo previews. Returns { dataUrl: null } if the
        // asset is unset or the file is missing.
        getAssetDataUrl: (input: { kind: 'signature' | 'logo' }) => Promise<{ dataUrl: string | null }>;
  };
  // Phase 6 / Plan 01 — Reports (RPT-01..05 + RPT-07). Per D-05 +
  // BLOCKER 4, no method accepts a `doctorId` field — main derives it from
  // `requireSession()`. `regenPdf` writes a fresh PDF to
  // `<userData>/data/reports/<reportId>.pdf`; `openPdf` shells out via
  // electron.shell.openPath (RPT-07).
  reports: {
    getOrCreate: (input: { procedureId: string }) => Promise<Report>;
    get: (input: { id: string }) => Promise<Report | null>;
    updateDraft: (input: {
      id: string;
      findings?: string;
      diagnosis?: string;
      recommendations?: string;
      procedureDetails?: string;
    }) => Promise<Report>;
    updateFinalized: (input: {
      id: string;
      findings?: string;
      diagnosis?: string;
      recommendations?: string;
      procedureDetails?: string;
    }) => Promise<Report>;
    finalize: (input: { id: string }) => Promise<Report>;
    regenPdf: (input: { id: string }) => Promise<{ pdfPath: string }>;
    // ponytail: `reveal: true` invokes `shell.showItemInFolder(abs)` —
    // highlights the PDF in the OS file manager instead of opening it.
    // Default (omit / false) preserves the "open in default viewer"
    // behavior so existing callers keep working.
    openPdf: (input: { id: string; reveal?: boolean }) => Promise<{ opened: true }>;
    // Phase 6 UAT G-06-11 — returns the raw PDF bytes for the
    // print-preview iframe. The renderer wraps the bytes in a blob: URL
    // and loads it in a hidden iframe so `contentWindow.print()` opens
    // the OS print dialog with the actual PDF as the print target.
    // Throws IPC_NOT_FOUND if the PDF hasn't been rendered yet
    // (report.pdfPath === null).
    getPdfBlob: (input: { id: string }) => Promise<{ bytes: Uint8Array; mime: 'application/pdf' }>;
    attachScreenshot: (input: { id: string; screenshotId: number; sortOrder: number }) => Promise<{ ok: true }>;
    detachScreenshot: (input: { id: string; screenshotId: number }) => Promise<{ ok: true }>;
    reorderScreenshots: (input: { id: string; orderedIds: number[] }) => Promise<{ ok: true }>;
    listScreenshots: (input: { id: string }) => Promise<ReportScreenshot[]>;
  };
  // Phase 7 / Plan 07-01 — Backup/Restore IPC (SET-05, SET-06). The
  // renderer surfaces the user-data folder as the active `data/` is
  // byte-identical before and after the operation (D-13..D-16). Per
  // Phase 2 BLOCKER 4, the renderer never supplies a doctorId — main
  // derives it from `requireSession()` for the audit row.
  backup: {
    create: (input: { destPath: string }) => Promise<{
      path: string;
      sizeBytes: number;
      procedureCount: number;
    }>;
    reveal: (input: { path: string }) => Promise<{ ok: true }>;
  };
  restore: {
    preview: (input: { zipPath: string; stagingDir: string }) => Promise<RestorePreview>;
    unpack: (input: { zipPath: string; stagingDir: string }) => Promise<{
      fileCount: number;
      stagingDir: string;
    }>;
  };
  // Phase 7 / Plan 07-01 — Audit log write channel (AUDIT-01). The
  // renderer can write audit rows for "audit-on-every-read" patterns
  // (e.g. viewing a patient profile). All writes route through the
  // audit() helper in src/main/db/audit.ts — there is no other write
  // path. SQLite triggers reject any UPDATE/DELETE on audit_log.
  // NOTE: the `audit` namespace is already declared above (with
  // `list`); the `log` method was added in place to keep the surface
  // in one block. Plan 07-01 ships the AUDIT_LOG IPC channel as an
  // extension of the existing audit.* namespace.
}

declare global {
  interface Window {
    api: IpcContract;
  }
}