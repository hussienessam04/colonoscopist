// users table repository — cached prepared statements only (per anti-pattern: no raw SQL in repos).
// Per D-02 + AUTH-02/03 + AUDIT-01.

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getDb } from './index';

export type UserRow = {
  id: string;
  full_name: string;
  is_first_admin: number;
  pin_hash: string;
  failed_attempts: number;
  locked_until: number | null;
  is_locked: number;
  last_login_at: number | null;
  // Phase 7 / Plan 07-01 — I18N-01 (per D-18): workstation-level
  // language default. Set on wizard bootstrap; updated by users.create
  // for new doctors. Read by the i18n resolver when
  // doctor_profile.language IS NULL.
  language: 'en' | 'ar';
  created_at: number;
  deleted_at: number | null;
};

export type UserCreateInput = {
  fullName: string;
  pinHash: string;
  isFirstAdmin: boolean;
  // Phase 7 / Plan 07-01 — I18N-01. Default 'en' if omitted.
  language?: 'en' | 'ar';
};

type Stmt = Database.Statement;

let cached: {
  insert: Stmt;
  softDelete: Stmt;
  setPin: Stmt;
  bumpFailed: Stmt;
  setLockedUntil: Stmt;
  setIsLocked: Stmt;
  resetLock: Stmt;
  touchLastLogin: Stmt;
  get: Stmt;
  listActive: Stmt;
  countAll: Stmt;
  getFirstAdmin: Stmt;
} | null = null;

function stmts() {
  if (cached) return cached;
  const db = getDb();
  cached = {
    // Phase 7 / Plan 07-01 — I18N-01: include the language column on
    // insert. The migration 0007 default of 'en' is the safe fallback
    // if @language is somehow null (it shouldn't be — userRepo.create
    // defaults it to 'en' on the TS side).
    insert: db.prepare(
      `INSERT INTO users (id, full_name, is_first_admin, pin_hash, failed_attempts, is_locked, language, created_at)
       VALUES (@id, @full_name, @is_first_admin, @pin_hash, 0, 0, @language, @created_at)`,
    ),
    softDelete: db.prepare('UPDATE users SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'),
    setPin: db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?'),
    bumpFailed: db.prepare('UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ?'),
    setLockedUntil: db.prepare('UPDATE users SET locked_until = ? WHERE id = ?'),
    setIsLocked: db.prepare('UPDATE users SET is_locked = ? WHERE id = ?'),
    resetLock: db.prepare(
      'UPDATE users SET failed_attempts = 0, locked_until = NULL, is_locked = 0 WHERE id = ?',
    ),
    touchLastLogin: db.prepare(
      'UPDATE users SET failed_attempts = 0, locked_until = NULL, is_locked = 0, last_login_at = ? WHERE id = ?',
    ),
    get: db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL'),
    listActive: db.prepare(
      'SELECT * FROM users WHERE deleted_at IS NULL ORDER BY full_name COLLATE NOCASE',
    ),
    countAll: db.prepare('SELECT COUNT(*) AS c FROM users WHERE deleted_at IS NULL'),
    getFirstAdmin: db.prepare(
      'SELECT * FROM users WHERE is_first_admin = 1 AND deleted_at IS NULL LIMIT 1',
    ),
  };
  return cached;
}

function resetCache() {
  cached = null;
}

// ponytail: tests need to drop the cached statements when they swap DB instances.
export function __resetUserRepoCache(): void {
  resetCache();
}

export const userRepo = {
  create({ fullName, pinHash, isFirstAdmin, language }: UserCreateInput): UserRow {
    const id = randomUUID();
    // ponytail: default 'en' is the silent fallback per D-18. The
    // wizard bootstrap + users.create IPC handlers both default to 'en'
    // before reaching this layer, but the inline default here guards
    // against any other caller (tests, future code) skipping it.
    const resolvedLanguage: 'en' | 'ar' = language ?? 'en';
    const row: UserRow = {
      id,
      full_name: fullName,
      is_first_admin: isFirstAdmin ? 1 : 0,
      pin_hash: pinHash,
      failed_attempts: 0,
      locked_until: null,
      is_locked: 0,
      last_login_at: null,
      language: resolvedLanguage,
      created_at: Date.now(),
      deleted_at: null,
    };
    stmts().insert.run({
      id: row.id,
      full_name: row.full_name,
      is_first_admin: row.is_first_admin,
      pin_hash: row.pin_hash,
      language: row.language,
      created_at: row.created_at,
    });
    return row;
  },
  get(id: string): UserRow | undefined {
    return stmts().get.get(id) as UserRow | undefined;
  },
  listActive(): UserRow[] {
    return stmts().listActive.all() as UserRow[];
  },
  countActive(): number {
    return (stmts().countAll.get() as { c: number }).c;
  },
  getFirstAdmin(): UserRow | undefined {
    return stmts().getFirstAdmin.get() as UserRow | undefined;
  },
  setPin(id: string, pinHash: string): void {
    stmts().setPin.run(pinHash, id);
  },
  bumpFailed(id: string): void {
    stmts().bumpFailed.run(id);
  },
  setLockedUntil(id: string, ts: number | null): void {
    stmts().setLockedUntil.run(ts, id);
  },
  setIsLocked(id: string, locked: boolean): void {
    stmts().setIsLocked.run(locked ? 1 : 0, id);
  },
  resetLock(id: string): void {
    stmts().resetLock.run(id);
  },
  touchLastLogin(id: string, ts: number): void {
    stmts().touchLastLogin.run(ts, id);
  },
  remove(id: string): void {
    stmts().softDelete.run(Date.now(), id);
  },
};