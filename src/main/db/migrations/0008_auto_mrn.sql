-- 0008_auto_mrn.sql — auto-generated MRN as serial number (MRN-000001, MRN-000002, …).
-- Per D-lock. Atomic increment via a one-row counter table; better-sqlite3 is sync +
-- single-threaded inside the same db.transaction() as the patient insert, so no race.

-- Step A: backfill any NULL mrn rows so the NOT NULL constraint below has zero violations.
-- ponytail: ROW_NUMBER() OVER (ORDER BY created_at, id) keeps backfill stable across
-- restarts — same input ordering each run, and `id` is the deterministic tiebreaker
-- when two rows share a millisecond timestamp.
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
SET mrn = 'MRN-' || printf('%06d', numbered.seq)
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
-- (every MRN is now non-null, so the WHERE clause is dead weight).
DROP INDEX IF EXISTS idx_patients_mrn;
CREATE UNIQUE INDEX idx_patients_mrn ON patients(mrn);

-- Step E: enforce NOT NULL via the 12-step recipe.
-- SQLite <3.35 lacks ALTER COLUMN … SET NOT NULL. We rebuild the table.
CREATE TABLE new_patients (
  id           TEXT PRIMARY KEY,
  full_name    TEXT NOT NULL,
  dob          TEXT NOT NULL,
  gender       TEXT,
  mrn          TEXT NOT NULL,
  phone        TEXT,
  notes        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);

INSERT INTO new_patients
  (id, full_name, dob, gender, mrn, phone, notes, created_at, updated_at, deleted_at)
SELECT id, full_name, dob, gender, mrn, phone, notes, created_at, updated_at, deleted_at
FROM patients;

DROP TABLE patients;
ALTER TABLE new_patients RENAME TO patients;

-- Re-attach indexes that lived on `patients` and were dropped with the table.
CREATE UNIQUE INDEX idx_patients_mrn ON patients(mrn);
CREATE INDEX idx_patients_name ON patients(full_name COLLATE NOCASE);
CREATE INDEX idx_patients_deleted ON patients(deleted_at);
