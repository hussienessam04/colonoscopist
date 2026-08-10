-- 0007_doctor_profile_language_and_users_language.sql — Phase 7.
-- Per CONTEXT.md D-17 + D-18.
--
-- Two columns in one migration (per agent discretion in 07-CONTEXT.md):
--   users.language         — workstation default; set on wizard bootstrap
--   doctor_profile.language — per-doctor override; read first by the i18n resolver
--
-- `users.language` defaults to 'en' (existing wizards do not backfill — the silent
-- default is 'en' per D-18). `doctor_profile.language` is NULLable: NULL means
-- "follow the workstation default" (doctor has not picked a language yet).
--
-- Per Phase 2 D-04 first-launch atomicity — both ALTER TABLEs run inside the
-- migration's transaction (the runner wraps `db.exec(m.up)` in `db.transaction`).
-- If the column already exists (re-applied migration) SQLite raises
-- `duplicate column` and the transaction rolls back; the runner's _migrations
-- table guards against re-execution on subsequent launches.

ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en';

ALTER TABLE doctor_profile ADD COLUMN language TEXT NULL;
