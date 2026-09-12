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
  // Phase 8 / Plan 14 — permanent crop. The renderer does the pixel work
  // on a canvas and ships the cropped JPEG bytes; main validates the rect
  // against the original dimensions and overwrites the source file.
  SCREENSHOTS_CROP: 'screenshots:crop',
  // Phase 8 / Plan 15 (G-08-8) — return raw screenshot JPEG bytes so the
  // renderer can build a `blob:` URL and bypass CORS/canvas-taint on the
  // crop modal. Reads the row, resolves the userData-relative path to an
  // absolute path (Anti-Pattern 2), reads the file once, returns the
  // bytes + MIME type. EXEMPT from the license gate (read-only on
  // already-captured data).
  SCREENSHOTS_GET_BLOB: 'screenshots:get-blob',
  // Phase 8 / Plan 15 (G-08-8) — main-process clipboard write. Avoids
  // `navigator.clipboard.writeText` which is unreliable in the sandboxed
  // renderer. Returns {ok:true}. EXEMPT (routine copy action).
  CLIPBOARD_COPY_TEXT: 'clipboard:copy-text',
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
  PROFILE_UPLOAD_HEADER: 'profile:upload-header',
  PROFILE_UPLOAD_FOOTER: 'profile:upload-footer',
  PROFILE_GET_ASSET_DATA_URL: 'profile:get-asset-data-url',
  // Quick task 260812-ns0 — used-devices CRUD.
  USED_DEVICES_LIST: 'used-devices:list',
  USED_DEVICES_ADD: 'used-devices:add',
  USED_DEVICES_REMOVE: 'used-devices:remove',
  REPORTS_GET_OR_CREATE: 'reports:get-or-create',
  REPORTS_GET: 'reports:get',
  // Phase 7 / Plan 07-02 — SRCH-03 + D-03: read-only lookup of a
  // report by its procedureId so the Patient List accordion can show
  // the report status (Draft / Finalized / No report yet) without
  // creating a draft as a side effect. Returns null when the
  // procedure has no report row yet (vs REPORTS_GET_OR_CREATE which
  // auto-creates a draft).
  REPORTS_GET_BY_PROCEDURE: 'reports:get-by-procedure',
  REPORTS_UPDATE_DRAFT: 'reports:update-draft',
  REPORTS_UPDATE_FINALIZED: 'reports:update-finalized',
  REPORTS_FINALIZE: 'reports:finalize',
  // Quick task 20260812-redesign-report — procedure-type toggle
  // (immutable after first non-empty edit) + instrument picker +
  // per-report premedication override.
  REPORTS_SET_PROCEDURE_TYPE: 'reports:set-procedure-type',
  REPORTS_SET_INSTRUMENT: 'reports:set-instrument',
  REPORTS_SET_PREMEDICATION_OVERRIDE: 'reports:set-premedication-override',
  // Quick task 20260812-redesign-report — global saved-text-templates
  // library for each of the 8 report boxes. Workstation-wide (no
  // per-doctor scope).
  REPORT_TEMPLATES_LIST_BY_SCOPE: 'report-templates:list-by-scope',
  REPORT_TEMPLATES_LIST_ALL: 'report-templates:list-all',
  REPORT_TEMPLATES_ADD: 'report-templates:add',
  REPORT_TEMPLATES_REMOVE: 'report-templates:remove',
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
  // Phase 7 / Plan 07-05 — D-11 verbatim: Backup button invokes
  // `dialog.showSaveDialog` (per RESEARCH.md Pattern 3) → calls
  // BACKUP_CREATE. Plan 07-05 adds BACKUP_PICK_DESTINATION so the
  // renderer never constructs absolute paths directly; the only
  // legitimate path comes from Electron's file picker. Returns null
  // when the user cancels the dialog.
  BACKUP_PICK_DESTINATION: 'backup:pick-destination',
  // Phase 7 / Plan 07-05 — D-13 verbatim: Restore flow = (1) pick zip
  // → (2) preview → (3) explicit Restore. The picker wraps
  // `dialog.showOpenDialog({properties:['openFile'], filters:[zip]})`.
  RESTORE_PICK_ZIP: 'restore:pick-zip',
  // Phase 7 / Plan 07-05 — Reveal the staging directory in the OS
  // file manager (NOT a specific file). Wraps `shell.openPath(staging)`
  // so the doctor can inspect a freshly-staged backup without
  // picking any other path.
  RESTORE_REVEAL_STAGING: 'restore:reveal-staging',
  AUDIT_LOG: 'audit:log',
  // Phase 8 / Plan 01 — license verify path (LIC-02/03/04).
  // Both channels are EXEMPT from the IPC gate (Plan 03 ships the gate).
  // Renderer reads `license.status()` on every App.tsx mount and after
  // `license.activate()` to decide whether to render <LicenseGate>.
  LICENSE_STATUS: 'license:status',
  LICENSE_ACTIVATE: 'license:activate',
  // Phase 8 / Plan 04 — picker + activate one-shot (D-06 verbatim).
  // Renderer invokes this with NO arguments; main opens the file dialog
  // and, on user-confirmed path, calls loadAndVerifyLicense(). On cancel
  // (user closed the dialog), returns {ok:false, code:'IPC_LICENSE_CANCELLED'}.
  // This channel is EXEMPT from the IPC gate (Plan 04 also adds it to
  // EXEMPT_CHANNELS in src/main/license/gate.ts).
  LICENSE_PICK_AND_ACTIVATE: 'license:pick-and-activate',
  // Quick task 20260912-shared-database-optional — three
  // channels that drive the opt-in shared-database toggle. The
  // renderer hits GET on mount; SET writes the JSON config and
  // the toggle takes effect on the next app launch (the IPC
  // contract returns `requiresRestart: true` so the renderer
  // can show the warning banner); PICK_FOLDER opens the OS
  // folder picker and returns the chosen absolute path (or
  // null on cancel). All three are EXEMPT from the gate (set
  // in src/main/license/gate.ts) so the doctor can configure
  // storage without an active session.
  STORAGE_GET_LOCATION: 'storage:get-location',
  STORAGE_SET_LOCATION: 'storage:set-location',
  STORAGE_PICK_FOLDER: 'storage:pick-folder',
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
  // Quick task 20260812 — mrn is auto-generated by the repo at insert
  // time (migration 0008 enforces NOT NULL). The renderer never sends
  // it on create or update.
  mrn: string;
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

// Phase 8 / Plan 14 + Plan 15 — screenshot crop (SCRN-02 extended). The
// renderer crops on a canvas and sends the encoded JPEG bytes;
// `originalDimensions` is carried for main-side bounds validation and
// the `screenshot.cropped` audit row. The crop shape is EITHER a polygon
// (Plan 15 — free-form, min 3 vertices) OR a legacy bounding rectangle
// (Plan 14 — backward compat). One of the two MUST be supplied; the
// handler rejects calls with neither. The handler collapses the polygon
// to its bounding box for v1 (documented deviation — see SUMMARY.md).
//
// `croppedBase64` rides the channel as base64 for the same reason
// `screenshots.add` does — structured clone of a large Uint8Array across
// contextBridge is lossy in some Electron versions, base64 is the shape
// already proven in Phase 5.
export type CropRect = { x: number; y: number; width: number; height: number };
export type CropPolygon = { x: number; y: number }[];

export type ScreenshotCropInput = {
  id: number;
  croppedBase64: string;
  originalDimensions: { width: number; height: number };
  cropPolygon?: CropPolygon;
  cropRect?: CropRect;
};

export type ScreenshotCropResult =
  | { ok: true; newDimensions: { width: number; height: number }; byteSize: number }
  | { ok: false; code: 'IPC_SCREENSHOT_NOT_FOUND' | 'IPC_INVALID_CROP' | string };

// Phase 8 / Plan 15 (G-08-8) — screenshots:get-blob result. `bytes` is a
// fresh ArrayBuffer of the raw JPEG; `mimeType` is the file's MIME (always
// `image/jpeg` for v1 — the add path always writes JPEGs).
//
// Phase 8 / Plan 19 (G-08-12) — `ArrayBuffer` (was `Uint8Array`). The
// renderer wraps it in `new Uint8Array(buffer)` for BlobPart. A Buffer-
// backed Uint8Array view doesn't survive Electron's IPC structured clone
// cleanly — the browser rejects the resulting blob with "browser rejected
// blob". A fresh ArrayBuffer round-trips byte-for-byte and is the canonical
// pattern for binary IPC payloads in Electron.
export type ScreenshotGetBlobResult =
  | { ok: true; bytes: ArrayBuffer; mimeType: string }
  | { ok: false; code: 'IPC_SCREENSHOT_NOT_FOUND' | string };

// Phase 6 / Plan 01 — Doctor profile (PROF-01). Per CONTEXT.md D-02 the
// bilingual EN+AR fields are parallel nullable columns; AR columns are
// NULL until Phase 7 lands the per-doctor language preference. The
// signature + logo paths are userData-relative per Anti-Pattern 2.
//
// Phase 7 / Plan 07-01 — I18N-01: `language` is the per-doctor
// override (per D-17). NULL means "follow users.language".
//
// Quick task 260812-ns0 — report-branding + procedure-defaults fields:
//   - headerImagePath / footerImagePath: userData-relative paths to
//     the report header / footer image (PNG/JPEG); rendered as a top
//     band and bottom band on every PDF page.
//   - premedication: free-text clinic default; surfaces in the
//     patient block header above findings.
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
  headerImagePath: string | null;
  footerImagePath: string | null;
  premedication: string | null;
  language: 'en' | 'ar' | null;
  createdAt: number;
  updatedAt: number;
};

// Quick task 260812-ns0 — used devices (1:N with doctor_profile).
// `profileId` points at the parent doctor_profile row id; the renderer's
// API surface is keyed on `userId` (resolved server-side via the
// doctor_profile.id lookup in the IPC handler).
export type UsedDevice = {
  id: string;
  profileId: string;
  name: string;
  notes: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

// Phase 6 / Plan 01 — Report (RPT-01..05). Per D-05 the procedure FK is
// UNIQUE (1:1 reports-per-procedure); per D-06 finalized_at is frozen
// after Finalize; per D-07 the four free-text fields are the only
// patchable columns. pdfPath is userData-relative per Anti-Pattern 2.
//
// Quick task 20260812-redesign-report — replaced the four free-text
// fields with 8 procedure-type-specific boxes (esophagus / stomach /
// pylorus / duodenum / colon / ileum / conclusion / recommendation) +
// procedureType ('colon' | 'upper_gi') + instrument (used_devices.id
// pointer, NULL until chosen) + premedicationOverride (NULL = use
// profile default). procedureType is set ONCE on first edit; the repo's
// setProcedureType SQL guard rejects any update once the row has any
// non-empty box.
export type Report = {
  id: string;
  procedureId: string;
  doctorId: string;
  procedureType: 'colon' | 'upper_gi';
  instrument: string | null;
  premedicationOverride: string | null;
  esophagus: string;
  stomach: string;
  pylorus: string;
  duodenum: string;
  colon: string;
  ileum: string;
  conclusion: string;
  recommendation: string;
  status: 'draft' | 'finalized';
  finalizedAt: number | null;
  pdfPath: string | null;
  pdfGeneratedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

// Quick task 20260812-redesign-report — global saved-text-template
// row. Used for the editor's "Save current as template" + "Insert
// template" dropdowns. No per-doctor profile_id — workstation-wide
// library per the user's design decision.
export type ReportTemplate = {
  id: string;
  scope:
    | 'esophagus'
    | 'stomach'
    | 'pylorus'
    | 'duodenum'
    | 'colon'
    | 'ileum'
    | 'conclusion'
    | 'recommendation';
  label: string;
  body: string;
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

// Phase 8 / Plan 01 — license verify types (LIC-02/03).
// Per CONTEXT D-09 the verify path produces a discriminated state with
// four arms; the renderer mirrors this shape on the renderer side via
// `useLicenseStatus` (Plan 05).
export type LicenseState =
  | 'licensed'
  | 'trial'
  | 'expired'
  | 'unactivated';

export type LicenseStatus = {
  state: LicenseState;
  vendorId: string | null;
  licensedAt: number | null;
  expiresAt: number | null;
  trialStartedAt: number | null;
  trialDaysRemaining: number | null;
  machineId: string; // SHA-256 hex (first 16 chars displayed as 4-char grouped blocks)
};

export type LicenseActivateInput = {
  licPath: string; // absolute path from `dialog.showOpenDialog`
};

export type LicenseActivateResult =
  | { ok: true; vendorId: string; licensedAt: number }
  | { ok: false; code: 'IPC_LICENSE_INVALID'; reason: string };

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
      // Phase 7 / Plan 07-02 — SRCH-01..03 + D-02: AND-combined filters.
      // dateFrom/dateTo are yyyy-mm-dd strings parsed by main; doctorId is
      // a UUID; procedureStatus is a multi-select enum array.
      dateFrom?: string;
      dateTo?: string;
      doctorId?: string;
      procedureStatus?: ('recording' | 'completed' | 'partial' | 'crashed')[];
      page?: number;
      pageSize?: number;
    }) => Promise<{ rows: Patient[]; total: number }>;
    get: (id: string) => Promise<Patient | null>;
    // Quick task 20260812 — mrn is auto-generated by the repo; the
    // renderer never sends it on create or update.
    create: (
      input: Omit<Patient, 'id' | 'mrn' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
    ) => Promise<Patient>;
    update: (
      id: string,
      patch: Partial<Pick<Patient, 'fullName' | 'dob' | 'gender' | 'phone' | 'notes'>>,
    ) => Promise<Patient>;
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
      // Phase 7 / Plan 07-02 — D-04 verbatim: extend procedures.list
      // with the same date range + doctor filters as patients.list.
      dateFrom?: string;
      dateTo?: string;
      doctorId?: string;
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
    // Phase 8 / Plan 14 — permanent crop. Overwrites the source JPEG.
    crop: (input: ScreenshotCropInput) => Promise<ScreenshotCropResult>;
    // Phase 8 / Plan 15 (G-08-8) — read the JPEG bytes off disk so the
    // renderer can build a `blob:` URL (avoids canvas-taint on crop).
    getBlob: (input: { id: number }) => Promise<ScreenshotGetBlobResult>;
  };
  // Phase 8 / Plan 15 (G-08-8) — main-process clipboard write. Replaces
  // the unreliable navigator.clipboard.writeText for the License page
  // machine-id copy button (and any future clipboard use).
  clipboard: {
    copyText: (input: { text: string }) => Promise<{ ok: true }>;
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
      // Quick task 260812-ns0 — premedication (free-text clinic default;
      // surfaces in the PDF report header above findings).
      premedication?: string | null;
    }) => Promise<DoctorProfile>;
        uploadSignature: (input: { jpegBase64?: string; pngBase64?: string }) => Promise<{ signaturePath: string }>;
        uploadLogo: (input: { jpegBase64?: string; pngBase64?: string }) => Promise<{ logoPath: string }>;
        // Quick task 260812-ns0 — header / footer image uploads
        // (rendered as the top / bottom band on every PDF page).
        uploadHeader: (input: { jpegBase64?: string; pngBase64?: string }) => Promise<{ headerImagePath: string }>;
        uploadFooter: (input: { jpegBase64?: string; pngBase64?: string }) => Promise<{ footerImagePath: string }>;
        // Phase 6 UAT G-06-3 — image preview. Returns a data URL the
        // renderer can drop straight into <img src=...> for the
        // signature + logo previews. Returns { dataUrl: null } if the
        // asset is unset or the file is missing.
        getAssetDataUrl: (input: { kind: 'signature' | 'logo' | 'header' | 'footer' }) => Promise<{ dataUrl: string | null }>;
  };
  // Quick task 260812-ns0 — used-devices CRUD (1:N with doctor_profile).
  // The renderer keys by `userId` (server-side resolves to profile.id).
  usedDevices: {
    list: () => Promise<UsedDevice[]>;
    add: (input: { name: string; notes?: string | null; sortOrder?: number }) => Promise<UsedDevice>;
    remove: (input: { id: string }) => Promise<{ ok: true }>;
  };
  // Phase 6 / Plan 01 — Reports (RPT-01..05 + RPT-07). Per D-05 +
  // BLOCKER 4, no method accepts a `doctorId` field — main derives it from
  // `requireSession()`. `regenPdf` writes a fresh PDF to
  // `<userData>/data/reports/<reportId>.pdf`; `openPdf` shells out via
  // electron.shell.openPath (RPT-07).
  reports: {
    getOrCreate: (input: { procedureId: string }) => Promise<Report>;
    get: (input: { id: string }) => Promise<Report | null>;
    // Phase 7 / Plan 07-02 — SRCH-03 + D-03: read-only lookup of a
    // report by its procedureId. Returns null when the procedure has
    // no report row yet. Used by the Patient List accordion expansion
    // to render the report status chip + Open PDF button without
    // triggering the getOrCreate side effect.
    getByProcedure: (input: { procedureId: string }) => Promise<Report | null>;
    updateDraft: (input: {
      id: string;
      esophagus?: string;
      stomach?: string;
      pylorus?: string;
      duodenum?: string;
      colon?: string;
      ileum?: string;
      conclusion?: string;
      recommendation?: string;
    }) => Promise<Report>;
    updateFinalized: (input: {
      id: string;
      esophagus?: string;
      stomach?: string;
      pylorus?: string;
      duodenum?: string;
      colon?: string;
      ileum?: string;
      conclusion?: string;
      recommendation?: string;
    }) => Promise<Report>;
    // Quick task 20260812-redesign-report — sets procedure_type ONCE
    // on first edit. The repo throws IPC_VALIDATION if any box column
    // is non-empty ("Procedure type is locked once the report has any
    // content").
    setProcedureType: (input: { id: string; procedureType: 'colon' | 'upper_gi' }) => Promise<Report>;
    setInstrument: (input: { id: string; instrument: string | null }) => Promise<Report>;
    setPremedicationOverride: (input: { id: string; override: string | null }) => Promise<Report>;
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
  // Quick task 20260812-redesign-report — global saved-text-templates
  // library. Workstation-wide, scoped per box (esophagus / stomach /
  // pylorus / duodenum / colon / ileum / conclusion / recommendation).
  reportTemplates: {
    listByScope: (input: { scope: ReportTemplate['scope'] }) => Promise<ReportTemplate[]>;
    listAll: () => Promise<ReportTemplate[]>;
    add: (input: { scope: ReportTemplate['scope']; label: string; body: string }) => Promise<ReportTemplate>;
    remove: (input: { id: string }) => Promise<{ ok: true }>;
  };
  // Phase 7 / Plan 07-01 — Backup/Restore IPC (SET-05, SET-06). The
  // renderer surfaces the user-data folder as the active `data/` is
  // byte-identical before and after the operation (D-13..D-16). Per
  // Phase 2 BLOCKER 4, the renderer never supplies a doctorId — main
  // derives it from `requireSession()` for the audit row.
  //
  // Phase 7 / Plan 07-05 — D-11 / D-13: the renderer never builds
  // absolute paths; the picker channel wraps Electron's
  // dialog.showSaveDialog/showOpenDialog so the path the user picks
  // is the only path that ever reaches create/preview/unpack.
  backup: {
    create: (input: { destPath: string }) => Promise<{
      path: string;
      sizeBytes: number;
      procedureCount: number;
    }>;
    reveal: (input: { path: string }) => Promise<{ ok: true }>;
    pickDestination: () => Promise<string | null>;
  };
  restore: {
    preview: (input: { zipPath: string; stagingDir: string }) => Promise<RestorePreview>;
    unpack: (input: { zipPath: string; stagingDir: string }) => Promise<{
      fileCount: number;
      stagingDir: string;
    }>;
    pickZip: () => Promise<string | null>;
    revealStaging: (input: { stagingDir: string }) => Promise<{ ok: true }>;
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
  //
  // Phase 8 / Plan 01 — license verify path. status() returns the
  // cached LicenseStatus; activate() reads the .lic at input.licPath
  // and runs Ed25519 verify + audit row. Plan 04 fills activate()
  // with the real loadAndVerifyLicense; Plan 01 ships a stub that
  // throws IPC_NOT_IMPLEMENTED so the IPC surface compiles for
  // Plan 02/03 + downstream consumers.
  //
  // Phase 8 / Plan 04 — picker + activate. NO input arg — the IPC owns
  // the dialog. Returns LicenseActivateResult on success/failure or
  // {ok:false, code:'IPC_LICENSE_CANCELLED'} on dialog cancel.
  // Renderer never composes paths (Phase 7 D-13 verbatim); the dialog
  // picker is the only legitimate source of `.lic` paths.
  license: {
    status: () => Promise<LicenseStatus>;
    activate: (input: LicenseActivateInput) => Promise<LicenseActivateResult>;
    pickAndActivate: () => Promise<LicenseActivateResult | { ok: false; code: 'IPC_LICENSE_CANCELLED' }>;
  };
  // Quick task 20260912-shared-database-optional — opt-in
  // shared database across devices. `getLocation` returns the
  // current toggle + paths; `setLocation` writes the JSON
  // config (takes effect on next app launch); `pickFolder`
  // opens the OS folder picker for the doctor to choose a
  // shared SMB / NFS / OneDrive-mounted folder.
  storage: {
    getLocation: () => Promise<StorageLocationResult>;
    setLocation: (input: StorageSetLocationInput) => Promise<StorageSetLocationResult>;
    pickFolder: () => Promise<StoragePickFolderResult>;
  };
}

// Quick task 20260912-shared-database-optional — payload shapes
// for the storage IPC. Kept at module scope (not inside the
// IpcContract interface) so they can be reused by the main-side
// handler + renderer hook.
export type StorageLocationResult = {
  enabled: boolean;
  sharedPath: string | null;
  // Always populated — the resolved data root for the CURRENT
  // boot (i.e. based on the config that was on disk when main
  // started). Lets the renderer show a "currently using X"
  // banner next to the toggle for the soon-to-be-pending state.
  effectivePath: string;
  localPath: string;
};

export type StorageSetLocationInput = {
  enabled: boolean;
  sharedPath: string | null;
};

export type StorageSetLocationResult = {
  ok: boolean;
  reason?: 'missing' | 'not-directory' | 'not-writable';
  // Always true — the toggle takes effect on the next launch.
  // Returned so the renderer can show the warning banner even
  // if the doctor toggles and the success path doesn't include
  // any other signal.
  requiresRestart: true;
};

export type StoragePickFolderResult = {
  // null when the doctor cancels the OS picker.
  path: string | null;
};

declare global {
  interface Window {
    api: IpcContract;
  }
}