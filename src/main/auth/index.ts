// Auth orchestration: wizard + login + user CRUD + recovery flow.
// Per D-01/02/03/04/05/07 + AUTH-01/02/03/04 + Fix 2/3/7.

import { randomUUID } from 'node:crypto';
import { getDb } from '../db';
import { userRepo, type UserRow } from '../db/users';
import { audit } from '../db/audit';
import { hashPin, verifyPin } from './pin';
import { session } from './session';
import { backoff, clearBackoff, LOCKOUT_THRESHOLD, SENTINEL_LOCKED_UNTIL, nextBackoffMs } from './rate-limit';
import { ipcError, IpcErrorException } from '@shared/errors';
import type { LoginResult, RecoveryResponse, UserPublic } from '@shared/ipc-contract';

function stripPin(row: UserRow): UserPublic {
  return {
    id: row.id,
    fullName: row.full_name,
    isFirstAdmin: row.is_first_admin === 1,
    lastLoginAt: row.last_login_at,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
  };
}

function rowToPublic(row: UserRow): UserPublic {
  return stripPin(row);
}

function currentUserIsAdmin(): boolean {
  const id = session.currentUserId;
  if (!id) return false;
  const row = userRepo.get(id);
  return row?.is_first_admin === 1;
}

export async function wizardBootstrap(input: { fullName: string; clinicName: string; pin: string }): Promise<{ accepted: true; userId: string; clinicName: string }> {
  // per D-01 — first launch only.
  if (userRepo.countActive() > 0) {
    throw new IpcErrorException(ipcError('IPC_VALIDATION', 'Wizard already completed; first launch only'));
  }

  const pinHash = await hashPin(input.pin);
  const userId = randomUUID();
  const clinicName = input.clinicName;
  const now = Date.now();

  // ponytail: single transaction wraps all four rows so any throw rolls back.
  const db = getDb();
  const txn = db.transaction(() => {
    // INSERT users (admin = first user)
    db.prepare(
      `INSERT INTO users (id, full_name, is_first_admin, pin_hash, failed_attempts, is_locked, created_at)
       VALUES (?, ?, 1, ?, 0, 0, ?)`,
    ).run(userId, input.fullName, pinHash, now);

    // INSERT settings clinic_name
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run('clinic_name', clinicName, now);

    // INSERT settings schema_version
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run('schema_version', '1', now);

    // INSERT audit_log auth.bootstrap.completed
    db.prepare(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, outcome, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(userId, 'auth.bootstrap.completed', 'user', userId, JSON.stringify({ clinicName }), 'ok', now);
  });
  txn();

  return { accepted: true, userId, clinicName };
}

export async function login(input: { userId: string; pin: string }): Promise<LoginResult> {
  // per Fix 3 — fail-closed on safeStorage-off. verifyPin throws before any side effect.
  const user = userRepo.get(input.userId);
  if (!user) {
    audit({ action: 'auth.login.failed', outcome: 'failed', userId: input.userId });
    return { ok: false, code: 'IPC_AUTH_FAILED' };
  }

  // Lockout check (persistent clock).
  if (user.locked_until && Date.now() < user.locked_until) {
    audit({ action: 'auth.login.locked', userId: user.id, outcome: 'rate_limited', metadata: { retryAt: user.locked_until } });
    return { ok: false, code: 'IPC_LOCKED', retryAt: user.locked_until };
  }

  // In-memory backoff (live cooldown).
  const cooldown = backoff.get(user.id);
  if (cooldown && Date.now() < cooldown) {
    return { ok: false, code: 'IPC_RATE_LIMITED', retryAt: cooldown };
  }

  // verifyPin may throw IPC_ENCRYPTION_UNAVAILABLE — fail-closed, no row written.
  const ok = await verifyPin(input.pin, user.pin_hash);
  if (!ok) {
    const attempts = user.failed_attempts + 1;
    userRepo.bumpFailed(user.id);
    if (attempts >= LOCKOUT_THRESHOLD) {
      userRepo.setLockedUntil(user.id, SENTINEL_LOCKED_UNTIL);
      userRepo.setIsLocked(user.id, true);
      audit({
        action: 'auth.login.locked',
        userId: user.id,
        outcome: 'rate_limited',
        metadata: { attempts, mode: 'indefinite_lock' },
      });
      backoff.set(user.id, Date.now() + SENTINEL_LOCKED_UNTIL);
      return { ok: false, code: 'IPC_LOCKED', retryAt: SENTINEL_LOCKED_UNTIL };
    }
    const backoffMs = nextBackoffMs(attempts);
    backoff.set(user.id, Date.now() + backoffMs);
    audit({ action: 'auth.login.failed', userId: user.id, outcome: 'failed', metadata: { attempts } });
    return { ok: false, code: 'IPC_AUTH_FAILED' };
  }

  // Success path.
  userRepo.touchLastLogin(user.id, Date.now());
  clearBackoff(user.id);
  session.set(user.id);
  audit({ action: 'auth.login.success', userId: user.id, outcome: 'ok' });
  const refreshed = userRepo.get(user.id)!;
  return { ok: true, user: stripPin(refreshed) };
}

export function logout(): { ok: true } {
  const prevId = session.currentUserId;
  session.clear();
  audit({ action: 'auth.logout', userId: prevId, outcome: 'ok' });
  return { ok: true };
}

export async function createUser(input: { fullName: string; pin: string }): Promise<UserPublic> {
  // per D-03 — admin only.
  if (!currentUserIsAdmin()) {
    throw new IpcErrorException(ipcError('IPC_VALIDATION', 'Only the first admin can create users'));
  }
  const pinHash = await hashPin(input.pin);
  const row = userRepo.create({ fullName: input.fullName, pinHash, isFirstAdmin: false });
  audit({ action: 'users.create', entityType: 'user', entityId: row.id, metadata: { hasFullName: true } });
  return rowToPublic(row);
}

export function removeUser(input: { userId: string }): { ok: true } {
  if (!currentUserIsAdmin()) {
    throw new IpcErrorException(ipcError('IPC_VALIDATION', 'Only the first admin can remove users'));
  }
  if (input.userId === session.currentUserId) {
    throw new IpcErrorException(ipcError('IPC_VALIDATION', 'Cannot remove the currently signed-in user'));
  }
  const target = userRepo.get(input.userId);
  if (!target) {
    throw new IpcErrorException(ipcError('IPC_NOT_FOUND', 'User not found'));
  }
  userRepo.remove(input.userId);
  audit({ action: 'users.remove', entityType: 'user', entityId: input.userId, outcome: 'ok' });
  return { ok: true };
}

export async function resetPin(input: { userId: string; newPin: string }): Promise<{ ok: true }> {
  if (!currentUserIsAdmin()) {
    throw new IpcErrorException(ipcError('IPC_VALIDATION', 'Only the first admin can reset PINs'));
  }
  const target = userRepo.get(input.userId);
  if (!target) {
    throw new IpcErrorException(ipcError('IPC_NOT_FOUND', 'User not found'));
  }
  const newHash = await hashPin(input.newPin);
  userRepo.setPin(input.userId, newHash);
  userRepo.resetLock(input.userId);
  clearBackoff(input.userId);
  audit({ action: 'users.reset_pin', entityType: 'user', entityId: input.userId, outcome: 'ok' });
  return { ok: true };
}

export function listUsers(): UserPublic[] {
  return userRepo.listActive().map(rowToPublic);
}

export function recoveryRequest(): RecoveryResponse {
  // per D-04 + Fix 7 — Phase 2 ships the surface; Phase 8 fills the actual Ed25519 verify.
  audit({ action: 'auth.recovery_request', outcome: 'ok' });
  return {
    accepted: true,
    verificationDeferred: true,
    machineFingerprint: 'tbd-phase-8',
    mailto: 'mailto:licensing@colonoscopist.example?subject=Admin%20PIN%20recovery&body=fingerprint:',
  };
}

export function acceptRecoveryFile(): { accepted: true; verificationDeferred: true } {
  // per Fix 7 — deferred to Phase 8.
  audit({ action: 'auth.recovery_file_accepted', outcome: 'ok' });
  return { accepted: true, verificationDeferred: true };
}

export function status(): { hasUsers: boolean; authenticated: boolean; userId: string | null; clinicName: string | null; isFirstAdmin: boolean } {
  const hasUsers = userRepo.countActive() > 0;
  const userId = session.currentUserId;
  const row = userId ? userRepo.get(userId) : undefined;
  const clinicRow = getDb()
    .prepare(`SELECT value FROM settings WHERE key = 'clinic_name'`)
    .get() as { value: string } | undefined;
  return {
    hasUsers,
    authenticated: !!row,
    userId: row?.id ?? null,
    clinicName: clinicRow?.value ?? null,
    isFirstAdmin: row?.is_first_admin === 1,
  };
}

export function bootstrapStatus(): { hasUsers: boolean; clinicName: string | null; userId: string | null } {
  const hasUsers = userRepo.countActive() > 0;
  const clinicRow = getDb()
    .prepare(`SELECT value FROM settings WHERE key = 'clinic_name'`)
    .get() as { value: string } | undefined;
  return {
    hasUsers,
    clinicName: clinicRow?.value ?? null,
    userId: session.currentUserId,
  };
}