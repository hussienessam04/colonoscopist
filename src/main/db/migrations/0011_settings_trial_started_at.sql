-- 0011_settings_trial_started_at.sql — Phase 8 / Plan 01 (LIC-01 foundation).
-- Per CONTEXT D-02: trial clock lives on `settings` table as `trial_started_at INTEGER NULL`.
-- The column is read by `src/main/license/trial.ts:readTrialStartedAt()` on every boot.
-- The wizardBootstrap transaction (Plan 02) writes the row on the FIRST wizard run;
-- this migration just adds the column.
ALTER TABLE settings ADD COLUMN trial_started_at INTEGER NULL;