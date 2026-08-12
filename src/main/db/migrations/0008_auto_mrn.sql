-- 0008_auto_mrn.sql — auto-generated MRN as serial number (MRN-000001, MRN-000002, …).
-- Per D-lock. Atomic increment via a one-row counter table; better-sqlite3 is sync +
-- single-threaded inside the same db.transaction() as the patient insert, so no race.

-- Step A: backfill any NULL mrn rows so the column has zero NULLs in practice.
-- ponytail: ROW_NUMBER() OVER (ORDER BY created_at, id) keeps backfill stable across
-- restarts — same input ordering each run, and `id` is the deterministic tiebreaker
-- when two rows share a millisecond timestamp.
--
-- SQLite quirk: the SET clause of an UPDATE cannot reference CTE columns directly
-- (e.g. `SET col = cte.col` errors with "no such column: cte.col"). The fix is a
-- correlated subquery in SET that joins the CTE back to patients by id.
WITH numbered AS (
  SELECT id,
         ROW_NUMBER() OVER (
           ORDER BY created_at ASC, id ASC
         ) + COALESCE((
           SELECT MAX(CAST(SUBSTR(mrn, 5) AS INTEGER))
           FROM patients
           WHERE mrn GLOB 'MRN-[0-9]*'
         ), 0) AS seq
  FROM patients
  WHERE mrn IS NULL
)
UPDATE patients
SET mrn = (
  SELECT 'MRN-' || printf('%06d', numbered.seq)
  FROM numbered
  WHERE numbered.id = patients.id
)
WHERE id IN (SELECT id FROM numbered);

-- Step B: create the one-row counter table.
-- ponytail: PRIMARY KEY CHECK (id = 1) enforces the single-row invariant at the schema
-- layer — a stray INSERT that forgets the constraint blows up immediately.
CREATE TABLE patient_mrn_counter (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  next INTEGER NOT NULL
);

-- Step C: seed the counter above the max existing suffix so we never collide.
INSERT INTO patient_mrn_counter (id, next)
SELECT 1, COALESCE(MAX(CAST(SUBSTR(mrn, 5) AS INTEGER)), 0) + 1
FROM patients
WHERE mrn GLOB 'MRN-[0-9]*';

-- Step D: drop the partial unique index, then recreate as a full unique index
-- (every MRN is now non-null in practice, so the WHERE clause is dead weight).
DROP INDEX IF EXISTS idx_patients_mrn;
CREATE UNIQUE INDEX idx_patients_mrn ON patients(mrn);

-- Step E: schema-level NOT NULL on patients.mrn is INTENTIONALLY NOT enforced.
--
-- Originally the plan was the SQLite 12-step table-rebuild recipe
-- (CREATE TABLE new_patients → INSERT … SELECT → DROP TABLE patients →
-- ALTER TABLE new_patients RENAME TO patients), because SQLite <3.35
-- lacks ALTER COLUMN … SET NOT NULL.
--
-- That recipe is unsafe for v1: any row in `procedures` referencing a
-- patient via `procedures.patient_id REFERENCES patients(id) ON DELETE
-- RESTRICT` (migration 0002) triggers `FOREIGN KEY constraint failed`
-- at DROP TABLE time when foreign_keys=ON. SQLite 3.35+ allows
-- `PRAGMA defer_foreign_keys = ON` inside a transaction, but DROP TABLE
-- FK checks are not deferrable — the constraint fires immediately.
--
-- The migration runner wraps each migration in db.transaction(); toggling
-- PRAGMA foreign_keys = OFF inside a transaction is a no-op (SQLite docs:
-- "may only be changed when there is no pending transaction"). And we
-- don't want to disable FK enforcement globally for all migrations —
-- that would mask real schema bugs.
--
-- ponytail: the NOT NULL invariant is already enforced at the repo layer
-- by `nextMrn()` (called inside the createPatient transaction, after
-- the migration has backfilled any pre-existing NULLs). `patientPatchInput`
-- is `.strict()`, so a stray `mrn` in a patch becomes a 422. The DB column
-- stays TEXT (nullable in the schema); the invariant lives in code where
-- the auto-MRN contract is owned. For v1 (single-clinic, offline, no
-- concurrent writers, single repo entry point), this is sufficient.
--
-- If a future migration needs schema-level NOT NULL on patients.mrn,
-- the workaround is to either (a) bump to SQLite ≥3.35 and use
-- `ALTER TABLE patients DROP COLUMN mrn_old;` after renaming, or (b)
-- add a special migration runner path that disables FK enforcement
-- just for the affected migration. Both are deferred — not v1 work.