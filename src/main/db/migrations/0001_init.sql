-- 0001_init.sql — Phase 2 baseline schema.
-- Per D-01 + D-02 + AUDIT-01 + AUDIT-02.

-- _migrations bookkeeping table is created by the migrations runner
-- (CREATE TABLE IF NOT EXISTS) before this script runs; do not recreate here.

-- 2. users (admin is the row with is_first_admin = 1; only one such row at any time)
-- ponytail: single admin per D-02; adding permissions requires a migration + per-action RBAC
CREATE TABLE users (
  id                  TEXT PRIMARY KEY,
  full_name           TEXT NOT NULL,
  is_first_admin      INTEGER NOT NULL DEFAULT 0,
  pin_hash            TEXT NOT NULL,
  failed_attempts     INTEGER NOT NULL DEFAULT 0,
  locked_until        INTEGER,
  is_locked           INTEGER NOT NULL DEFAULT 0,
  last_login_at       INTEGER,
  created_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  CHECK (is_first_admin IN (0, 1))
);
CREATE UNIQUE INDEX idx_users_first_admin ON users(is_first_admin) WHERE is_first_admin = 1;
CREATE INDEX idx_users_full_name ON users(full_name COLLATE NOCASE);

-- 3. patients (Phase 2-02 adds the CRUD repo + IPC; columns ship here so Phase 2-02 doesn't migrate)
CREATE TABLE patients (
  id           TEXT PRIMARY KEY,
  full_name    TEXT NOT NULL,
  dob          TEXT NOT NULL,
  gender       TEXT,
  mrn          TEXT,
  phone        TEXT,
  notes        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);
CREATE UNIQUE INDEX idx_patients_mrn ON patients(mrn) WHERE mrn IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_patients_name ON patients(full_name COLLATE NOCASE);
CREATE INDEX idx_patients_deleted ON patients(deleted_at);

-- 4. audit_log (append-only — trigger forbids UPDATE/DELETE)
CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  metadata     TEXT,
  outcome      TEXT NOT NULL DEFAULT 'ok',
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_action ON audit_log(action);

CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

-- 5. settings (key/value)
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);