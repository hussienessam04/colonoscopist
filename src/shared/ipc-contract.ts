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
  // Phase 5 / Plan 01 — screenshots + trim surface. Trim/restore handlers
  // throw IPC_NOT_IMPLEMENTED in Plan 01; Plan 03 fills them.
  SCREENSHOTS_ADD: 'screenshots:add',
  SCREENSHOTS_LIST: 'screenshots:list',
  SCREENSHOTS_DELETE: 'screenshots:delete',
  SCREENSHOTS_UPDATE_ANNOTATION: 'screenshots:update-annotation',
  PROCEDURES_TRIM: 'procedures:trim',
  PROCEDURES_RESTORE: 'procedures:restore',
} as const;

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
export type UserPublic = {
  id: string;
  fullName: string;
  isFirstAdmin: boolean;
  lastLoginAt: number | null;
  failedAttempts: number;
  lockedUntil: number | null;
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
export type WizardSubmitInput = {
  fullName: string;
  clinicName: string;
  pin: string;
  confirmPin: string;
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
    create: (input: { fullName: string; pin: string }) => Promise<UserPublic>;
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
  recording: {
    start: (input: { patientId: string; procedureId?: string; deviceId: string; preset: QualityPreset }) => Promise<{ procedureId: string; startedAt: number; previewUrl: string }>;
    stop: (input: { procedureId: string }) => Promise<void>;
    pause: (input: { procedureId: string }) => Promise<void>;
    resume: (input: { procedureId: string }) => Promise<void>;
    forceCleanup: (input: { procedureId: string }) => Promise<void>;
    onStatus: (cb: (status: RecordingStatus) => void) => () => void;
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
}

declare global {
  interface Window {
    api: IpcContract;
  }
}