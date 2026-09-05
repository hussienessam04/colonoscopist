-- 0012_revert_report_redesign_drop_columns.sql
-- Quick task 2026-09 — restore the 4 columns that migration 0010 (the
-- untracked `redesign-report-procedure-type` overlay) dropped from the
-- user's DB. The new procedure-type-specific boxes from migration 0010
-- coexist with these classic columns; both schemas can be queried until
-- the redesign rollout is complete.
--
-- Why this lives in its own migration (Plan 15 — G-08-8):
--   Without these columns, the existing `reports_repo.ts` insert + update
--   paths fail with "table reports has no column named findings" / etc.,
--   which the patient list accordion (REPORTS_GET_BY_PROCEDURE) surfaces
--   as a silent UI failure. ID 11 was already taken by
--   settings_trial_started_at (Plan 01), so this lands as ID 12.
--
-- ponytail: NEW COLUMN COLUMNS ARE NOT NULL DEFAULT '' for backward-compat
-- with the existing rows-repo insert + update statements which assume
-- these columns exist. No-op on a DB that already has the columns
-- (idempotent: ALTER TABLE ADD COLUMN with a default never throws on
-- duplicate-column in better-sqlite3 because the runner guard skips the
-- migration once its _migrations row lands).

ALTER TABLE reports ADD COLUMN findings            TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN diagnosis           TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN recommendations     TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN procedure_details   TEXT NOT NULL DEFAULT '';
