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
} as const;

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
}

declare global {
  interface Window {
    api: IpcContract;
  }
}