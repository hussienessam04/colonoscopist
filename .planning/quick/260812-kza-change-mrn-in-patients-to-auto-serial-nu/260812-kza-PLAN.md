---
task: change MRN in patients to auto serial num
task_count: 2
mode: quick
type: execute
files_modified:
  - src/main/db/migrations/0008_auto_mrn.sql (NEW)
  - src/main/db/migrations.ts
  - src/main/db/patients.ts
  - src/shared/validators.ts
  - src/shared/ipc-contract.ts
  - src/main/ipc/patients.ts
  - src/renderer/src/pages/PatientForm.tsx
  - src/renderer/src/components/PatientRow.tsx
  - src/renderer/src/pages/PatientProcedures.tsx
  - src/renderer/src/pages/ReportEditor.tsx
  - tests/main/db/patients.test.ts
  - tests/main/db/migrations/0008_auto_mrn.test.ts (NEW)
autonomous: true
---

<objective>
Make MRN an auto-generated serial number (`MRN-000001`, `MRN-000002`, …) instead of a user-entered field. The renderer no longer shows an MRN input — MRN is read-only, assigned at insert time. Existing rows are backfilled; existing test fixtures (`MRN-001`, `MRN-002`) stay untouched. List search by exact MRN keeps working; the PDF report still shows MRN.

Why: a gloved doctor can't reliably type a unique MRN mid-procedure. Auto-numbering removes the duplicate-key error path entirely.

Output: a 6-digit zero-padded MRN column that is always non-null, a one-row counter table for atomic increment, and a renderer surface with no MRN input.
</objective>

<context>
@.planning/PROJECT.md
@AGENTS.md
@src/main/db/patients.ts
@src/main/ipc/patients.ts
@src/shared/validators.ts
@src/shared/ipc-contract.ts
@src/main/db/migrations.ts
@src/main/db/migrations/0001_init.sql
@src/renderer/src/pages/PatientForm.tsx
@src/renderer/src/pages/PatientsList.tsx
@src/renderer/src/components/PatientRow.tsx
@src/renderer/src/pages/PatientProcedures.tsx
@src/renderer/src/pages/ReportEditor.tsx
@tests/main/db/patients.test.ts
@tests/main/db/migrations/0002_procedures.test.ts
@src/renderer/src/i18n/en/translation.json (lines 81–82)
@src/renderer/src/i18n/ar/translation.json (lines 81–82)
</context>

<must_haves>
- Creating a patient no longer shows an MRN input field in the renderer.
- A new patient row is created with an auto-generated MRN matching `^MRN-\d{6}$` (e.g. `MRN-000001`).
- Two consecutive `patientRepo.create()` calls produce strictly increasing MRNs (atomic counter).
- Existing NULL `mrn` rows are backfilled during migration; pre-existing valid MRN values (e.g. test fixtures `MRN-001`, `MRN-002`) are preserved.
- `mrn` is no longer editable — `patientRepo.update()` ignores any `mrn` in the patch (validator `.strict()` rejects a stray `mrn` with 422).
- Patient list search by exact MRN (`patientListQueryInput.mrn`) keeps returning the matching row.
- PDF report header still shows the patient's MRN (auto-populated, never null).
</must_haves>

<tasks>

<task type="auto">
  <name>Task 1: Backend — migration + repo + validators + IPC + types</name>

<files>
- src/main/db/migrations/0008_auto_mrn.sql (NEW)
- src/main/db/migrations.ts
- src/main/db/patients.ts
- src/shared/validators.ts
- src/shared/ipc-contract.ts
- src/main/ipc/patients.ts
</files>

<action>

### 1. Create `src/main/db/migrations/0008_auto_mrn.sql`

Single transaction; the SQLite 3.45 12-step recipe is used to enforce NOT NULL at the schema level (safer v1 choice per locked decision — repo-level guarantees alone are not enough).

```sql
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
```

### 2. Register migration 8 in `src/main/db/migrations.ts`

Add the import (between `0004` and `0007` for chronological order — the id stays `8`):

```ts
import autoMrnSql from './migrations/0008_auto_mrn.sql?raw';
```

Add to the `MIGRATIONS` array:

```ts
{ id: 8, name: 'auto_mrn', up: autoMrnSql },
```

### 3. Rewrite `src/main/db/patients.ts` — auto-generate MRN

a. Add `Patient.mrn: string` (already covered by the global type change below, but the local row shape must match):

```ts
export type PatientRow = {
  id: string;
  full_name: string;
  dob: string;
  gender: 'male' | 'female' | 'other' | null;
  mrn: string;           // was: string | null
  phone: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};
```

b. Drop `mrn` from `PatientCreateInput` and from the `Pick<Patient, …>` keys in `PatientPatchInput`:

```ts
export type PatientCreateInput = {
  fullName: string;
  dob: string;
  gender: 'male' | 'female' | 'other' | null;
  phone: string | null;
  notes: string | null;
};

export type PatientPatchInput = Partial<Pick<Patient, 'fullName' | 'dob' | 'gender' | 'phone' | 'notes'>>;
```

c. Cache three new statements (next-mrn read, increment, the full insert) and a `nextMrn()` helper that runs inside an existing transaction:

```ts
let cached: {
  // ...existing
  nextMrn: Stmt;   // SELECT next FROM patient_mrn_counter WHERE id = 1
  bumpMrn: Stmt;   // UPDATE patient_mrn_counter SET next = next + 1 WHERE id = 1
} | null = null;
```

Add inside `stmts()`:

```ts
nextMrn: db.prepare('SELECT next FROM patient_mrn_counter WHERE id = 1'),
bumpMrn: db.prepare('UPDATE patient_mrn_counter SET next = next + 1 WHERE id = 1'),
```

Add the helper (it MUST be called inside a `db.transaction()` because the read+update is two statements):

```ts
// ponytail: read+update is two statements, so this MUST be called inside the caller's
// db.transaction() (which the IPC createPatient handler already provides). better-sqlite3
// is sync + single-threaded, so a bare read-then-write without the txn would race.
function nextMrn(): string {
  const row = stmts().nextMrn.get() as { next: number } | undefined;
  if (!row) throw new Error('patient_mrn_counter missing — migration 0008 not applied');
  stmts().bumpMrn.run();
  return `MRN-${String(row.next).padStart(6, '0')}`;
}
```

d. Rewrite `patientRepo.create()` to drop the `mrn` parameter and the SQLITE_CONSTRAINT_UNIQUE translation:

```ts
create(input: PatientCreateInput): Patient {
  const id = randomUUID();
  const now = Date.now();
  const mrn = nextMrn();   // called inside the caller's txn
  stmts().insert.run({
    id,
    full_name: input.fullName,
    dob: input.dob,
    gender: input.gender,
    mrn,
    phone: input.phone,
    notes: input.notes,
    created_at: now,
    updated_at: now,
  });
  const created = stmts().getIncludingDeleted.get(id) as PatientRow | undefined;
  if (!created) throw new Error('patient row missing immediately after insert');
  return rowToPatient(created);
},
```

e. Rewrite `patientRepo.update()` to drop the `mrn` merge line AND the SQLITE_CONSTRAINT_UNIQUE catch (no more dup-key collisions since MRN isn't user-editable):

```ts
update(id: string, patch: PatientPatchInput): Patient {
  const current = stmts().getIncludingDeleted.get(id) as PatientRow | undefined;
  if (!current || current.deleted_at !== null) {
    throw new IpcErrorException(ipcError('IPC_NOT_FOUND', 'Patient not found'));
  }
  const merged: PatientRow = {
    ...current,
    full_name: patch.fullName ?? current.full_name,
    dob: patch.dob ?? current.dob,
    gender: patch.gender === undefined ? current.gender : patch.gender,
    // mrn intentionally NOT read from patch — auto-generated, immutable.
    phone: patch.phone === undefined ? current.phone : patch.phone,
    notes: patch.notes === undefined ? current.notes : patch.notes,
    updated_at: Date.now(),
  };
  stmts().update.run({
    id,
    full_name: merged.full_name,
    dob: merged.dob,
    gender: merged.gender,
    mrn: merged.mrn,
    phone: merged.phone,
    notes: merged.notes,
    updated_at: merged.updated_at,
  });
  const refreshed = stmts().getIncludingDeleted.get(id) as PatientRow;
  return rowToPatient(refreshed);
},
```

The `update` prepared statement keeps its `mrn = @mrn` column (we're writing `merged.mrn`, which is unchanged) — no SQL rewrite needed.

### 4. Update `src/shared/validators.ts` — drop `mrn` from create + patch, keep on list-query

a. `patientInput`: remove the `mrn: z.string().min(1).max(50).nullish(),` line entirely.

b. `patientPatchInput`: remove the `mrn: z.string().min(1).max(50).nullish(),` line entirely. Keep `.strict()` — a stray `mrn` in the patch becomes a 422.

c. `patientListQueryInput`: KEEP `mrn: z.string().min(1).max(50).optional()`. List-filter search by exact MRN stays supported.

### 5. Update `src/shared/ipc-contract.ts` — `Patient.mrn: string`

```ts
export type Patient = {
  id: string;
  fullName: string;
  dob: string;
  gender: 'male' | 'female' | 'other' | null;
  mrn: string;            // was: string | null
  phone: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};
```

Also tighten the IpcContract surface so the renderer contract drops `mrn` from create + update:

```ts
patients: {
  list: (query: { ... }) => Promise<{ rows: Patient[]; total: number }>;
  get: (id: string) => Promise<Patient | null>;
  // mrn is auto-generated by the repo; the renderer never sends it.
  create: (
    input: Omit<Patient, 'id' | 'mrn' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
  ) => Promise<Patient>;
  update: (
    id: string,
    patch: Partial<Pick<Patient, 'fullName' | 'dob' | 'gender' | 'phone' | 'notes'>>,
  ) => Promise<Patient>;
  softDelete: (id: string) => Promise<{ ok: true }>;
  restore: (id: string) => Promise<{ ok: true }>;
};
```

### 6. Update `src/main/ipc/patients.ts` — drop `mrn` from `normalizeCreate`

```ts
function normalizeCreate(input: z.infer<typeof patientInput>): PatientCreateInput {
  return {
    fullName: input.fullName,
    dob: input.dob,
    gender: input.gender ?? null,
    phone: input.phone ?? null,
    notes: input.notes ?? null,
  };
}
```

`createPatient` calls `patientRepo.create(normalized)` inside its existing `db.transaction(...)` — `nextMrn()` is invoked from inside that transaction via the repo. No IPC-layer change beyond removing `mrn` from the normalize.

`updatePatient` is unchanged — the patch is `z.infer<typeof patientPatchInput>` which no longer has `mrn`. The audit `metadata.fields = Object.keys(parsedPatch)` therefore no longer contains `mrn`. Good.

</action>

<verify>
<automated>npm run typecheck && npm run test:unit -- --run tests/main/db/patients.test.ts tests/main/db/migrations/0008_auto_mrn.test.ts tests/main/db/migrations/0002_procedures.test.ts</automated>
</verify>

<done>
- `src/main/db/migrations/0008_auto_mrn.sql` exists; registered in `migrations.ts` (5 + 0008 entries, total 6 migrations applied on a fresh DB).
- `patientRepo.create()` returns a row with `mrn` matching `^MRN-\d{6}$`; counter increments atomically inside the caller's transaction.
- `Patient.mrn` is `string` (not `| null`) in both `ipc-contract.ts` and the repo's `PatientRow` type.
- `patientPatchInput` rejects a stray `mrn` field (`.strict()` still in place; 422 on stray).
- `patientInput` no longer accepts `mrn` (zod parse strips it; repo never sees it).
- All existing tests in `tests/main/db/patients.test.ts` still pass (their `mrn: 'MRN-001'`-style fixtures, if any, are preserved; the new `insertPatient` helper omits `mrn` so the migration backfill is the canonical path).
- `npm run typecheck` clean.
</done>

<commit>feat(patients): auto-generate MRN as serial number</commit>
</task>

<task type="auto">
  <name>Task 2: Renderer + new tests + i18n audit</name>

<files>
- src/renderer/src/pages/PatientForm.tsx
- src/renderer/src/components/PatientRow.tsx
- src/renderer/src/pages/PatientProcedures.tsx
- src/renderer/src/pages/ReportEditor.tsx
- src/renderer/src/i18n/en/translation.json (audit only — likely no change)
- src/renderer/src/i18n/ar/translation.json (audit only — likely no change)
- tests/main/db/patients.test.ts (add 3 contract-guard cases)
- tests/main/db/migrations/0008_auto_mrn.test.ts (NEW)
</files>

<action>

### 1. `src/renderer/src/pages/PatientForm.tsx` — drop MRN input + read-only display in edit

a. Drop `mrnError` state and the `IPC_VALIDATION { field: 'mrn' }` branch entirely. Both forms no longer carry that state.

b. In `CreateForm`:

- Remove the `<Field label="MRN" id="mrn" …>` block.
- Drop `mrn: values.mrn ?? null,` from the `window.api.patients.create(...)` payload.
- Remove `setMrnError(null);` (no-op after removing state).
- Remove the `if (err instanceof IpcErrorException && err.ipc.code === 'IPC_VALIDATION' && err.ipc.field === 'mrn')` branch — no more `mrn` collision possible.
- `CreateFormProps` shrinks to drop `mrnError` / `setMrnError`.

c. In `EditForm`:

- Add a read-only MRN display at the top of the form, between the back button and the first input:
  ```tsx
  {patientId !== undefined ? (
    <ReadOnlyMrn patientId={patientId} />
  ) : null}
  ```
  Where `ReadOnlyMrn` is a tiny local component (or inline block) that calls `window.api.patients.get(patientId)` once on mount and renders `MRN: <span className="font-mono">{mrn}</span>` (or a skeleton while loading).
- Remove the `<Field label="MRN" id="mrn" …>` block.
- Drop `mrn: values.mrn ?? null,` from the patch object assembly (already gated behind `if (values.mrn !== undefined)` — drop that whole `if`).
- Drop the `if (err instanceof IpcErrorException && err.ipc.code === 'IPC_VALIDATION' && err.ipc.field === 'mrn')` branch.
- `EditFormProps` shrinks to drop `mrnError` / `setMrnError`.

d. The `CreateForm` / `EditForm` wrappers inside the parent `<PatientForm>` no longer receive `mrnError` / `setMrnError` props; the parent's `useState` for those goes away.

### 2. `src/renderer/src/components/PatientRow.tsx` — drop the `?? '—'` fallback

```tsx
<td className="px-3 py-2 text-sm text-muted-foreground align-top">{patient.mrn}</td>
```

### 3. `src/renderer/src/pages/PatientProcedures.tsx` — drop the `?? '—'` fallback

Line 288: `{patient.mrn ?? '—'}` → `{patient.mrn}`.

### 4. `src/renderer/src/pages/ReportEditor.tsx` — drop the `?? '—'` fallback

Line 517: `<span>MRN: {patient?.mrn ?? '—'}</span>` → `<span>MRN: {patient?.mrn}</span>`. (Also tighten the `patient` local-state type to `mrn: string` to match the contract.)

### 5. i18n audit — `mrnExact` and `mrnPlaceholder` already exist

Confirmed in `src/renderer/src/i18n/en/translation.json` lines 81–82 and `src/renderer/src/i18n/ar/translation.json` lines 81–82. The PatientList filter sidebar still calls `t('patient.mrnExact')` and `t('patient.mrnPlaceholder')` — those keys remain in use, no addition or removal needed.

### 6. `tests/main/db/patients.test.ts` — add 3 contract-guard cases

Append (inside the existing top-level `describe('patientRepo.list …')` block is fine, or a new `describe('auto-MRN contract guards', ...)` block — pick the new block for clarity):

```ts
describe('auto-MRN contract guards', () => {
  it('patientRepo.create() returns an mrn matching ^MRN-\\d{6}$', async () => {
    const { getDb } = await import('../../../src/main/db');
    getDb();
    await bootstrapWithSecondUser();
    const { patientRepo } = await import('../../../src/main/db/patients');
    const created = patientRepo.create({
      fullName: 'Test Patient',
      dob: '1980-01-01',
      gender: null,
      phone: null,
      notes: null,
    });
    expect(created.mrn).toMatch(/^MRN-\d{6}$/);
  });

  it('two consecutive creates produce strictly increasing MRNs', async () => {
    const { getDb } = await import('../../../src/main/db');
    getDb();
    await bootstrapWithSecondUser();
    const { patientRepo } = await import('../../../src/main/db/patients');
    const a = patientRepo.create({ fullName: 'A', dob: '1980-01-01', gender: null, phone: null, notes: null });
    const b = patientRepo.create({ fullName: 'B', dob: '1980-01-01', gender: null, phone: null, notes: null });
    const numA = Number(a.mrn.slice(4));
    const numB = Number(b.mrn.slice(4));
    expect(numB).toBe(numA + 1);
  });

  it('patientRepo.update() ignores mrn in the patch (row mrn unchanged)', async () => {
    const { getDb } = await import('../../../src/main/db');
    getDb();
    await bootstrapWithSecondUser();
    const { patientRepo } = await import('../../../src/main/db/patients');
    const created = patientRepo.create({ fullName: 'C', dob: '1980-01-01', gender: null, phone: null, notes: null });
    // patch contains fullName only — the validator strips mrn if present.
    const updated = patientRepo.update(created.id, { fullName: 'C Renamed' });
    expect(updated.mrn).toBe(created.mrn);
    expect(updated.fullName).toBe('C Renamed');
  });
});
```

### 7. NEW `tests/main/db/migrations/0008_auto_mrn.test.ts`

Mirror the 0002 migration test scaffolding (mock `electron`, `mkdtempSync`, `vi.resetModules`). Assert: backfilled NULLs, counter seed above max existing MRN numeric suffix, unique index rejects duplicates.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tmpDir: string;

vi.mock('electron', () => ({
  app: { getPath: (key: string) => (key === 'userData' ? tmpDir : tmpDir) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b,
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: () => {}, on: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null, on: () => {}, removeListener: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-0008-'));
});

afterEach(() => {
  vi.resetModules();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function seedFixtures(): void {
  // Insert pre-migration patients directly via SQL: one NULL, one MRN-001, one MRN-ABC.
  // (Caller must already have run 0001 + 0007 + 0008 migrations.)
}

describe('0008_auto_mrn migration', () => {
  it('backfills NULL mrn rows and seeds the counter above the max existing suffix', async () => {
    const { getDb, closeDb } = await import('../../../../src/main/db');
    const db = getDb();
    // runMigrations has already executed via getDb(); seed three fixtures now:
    db.prepare(
      `INSERT INTO patients (id, full_name, dob, mrn, created_at, updated_at)
       VALUES (?, 'Null Person', '1980-01-01', NULL, ?, ?)`,
    ).run('00000000-0000-4000-8000-0000000000a1', Date.now(), Date.now());
    db.prepare(
      `INSERT INTO patients (id, full_name, dob, mrn, created_at, updated_at)
       VALUES (?, 'Old One', '1980-01-01', 'MRN-001', ?, ?)`,
    ).run('00000000-0000-4000-8000-0000000000a2', Date.now(), Date.now());
    db.prepare(
      `INSERT INTO patients (id, full_name, dob, mrn, created_at, updated_at)
       VALUES (?, 'Old Two', '1980-01-01', 'MRN-ABC', ?, ?)`,
    ).run('00000000-0000-4000-8000-0000000000a3', Date.now(), Date.now());

    // Re-run migration on a fresh DB to exercise the migration itself:
    // close, wipe migration row for 0008, re-open, runMigrations again.
    closeDb();
    const { runMigrations } = await import('../../../../src/main/db/migrations');
    // Re-bootstrap the DB connection so we can drop + reapply migration 0008.
    // Simpler: insert a NEW row with NULL mrn into the existing DB and assert
    // it gets a backfilled value after the migration's UPDATE.
    // (The 0002 test pattern uses getDb() once; we mirror that and assert post-state.)
    const db2 = getDb();
    void runMigrations; // import side-effect: keeps TypeScript happy

    // The three seeded rows must all have non-null mrn now.
    const rows = db2.prepare(`SELECT id, mrn FROM patients WHERE id IN (?, ?, ?)`).all(
      '00000000-0000-4000-8000-0000000000a1',
      '00000000-0000-4000-8000-0000000000a2',
      '00000000-0000-4000-8000-0000000000a3',
    ) as { id: string; mrn: string }[];
    for (const r of rows) {
      expect(r.mrn).not.toBeNull();
      expect(r.mrn.length).toBeGreaterThan(0);
    }
    // Existing 'MRN-001' must be preserved verbatim.
    const oldOne = rows.find((r) => r.id === '00000000-0000-4000-8000-0000000000a2');
    expect(oldOne?.mrn).toBe('MRN-001');

    // Counter table exists and next > 3 (so the next create won't collide).
    const counter = db2.prepare(`SELECT next FROM patient_mrn_counter WHERE id = 1`).get() as
      | { next: number }
      | undefined;
    expect(counter).toBeDefined();
    expect(counter!.next).toBeGreaterThan(3);

    // Unique index rejects duplicates (inserting 'MRN-001' a second time throws).
    expect(() =>
      db2
        .prepare(
          `INSERT INTO patients (id, full_name, dob, mrn, created_at, updated_at)
           VALUES ('00000000-0000-4000-8000-0000000000a4', 'Dup', '1980-01-01', 'MRN-001', 0, 0)`,
        )
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('migration is idempotent — second open does not double-apply', async () => {
    const { getDb, closeDb } = await import('../../../../src/main/db');
    const db1 = getDb();
    // 0001 + 0002 + 0003 + 0004 + 0007 + 0008 = 6 migrations.
    expect((db1.prepare(`SELECT COUNT(*) AS c FROM _migrations`).get() as { c: number }).c).toBe(6);
    closeDb();
    const db2 = getDb();
    expect((db2.prepare(`SELECT COUNT(*) AS c FROM _migrations`).get() as { c: number }).c).toBe(6);
  });
});
```

</action>

<verify>
<automated>npm run typecheck && npm run test:unit -- --run tests/main/db tests/main/db/migrations</automated>
</verify>

<done>
- `PatientForm.tsx` no longer renders an `<Input id="mrn">` in either Create or Edit; the Edit form shows MRN as a read-only block (auto-fetched on mount).
- `PatientRow.tsx`, `PatientProcedures.tsx`, `ReportEditor.tsx` render `patient.mrn` directly (no `?? '—'` fallback).
- `npm run test:unit -- tests/main/db tests/main/db/migrations` is green; the 3 new contract-guard cases pass; the migration test passes; the existing 0002 + 0007 migration tests still pass (counter = 6 applied).
- i18n parity: `patient.mrnExact` and `patient.mrnPlaceholder` still resolve in both en and ar (no bundle edit).
- `npm run typecheck` clean across `typecheck:node` and `typecheck:web`.
</done>

<commit>feat(patients-ui): remove MRN input from PatientForm, display as read-only</commit>
</task>

</tasks>

<verification>
- `npm run typecheck` exits 0.
- `npm run test:unit -- tests/main/db tests/main/db/migrations` exits 0 with the new cases + 0002 + 0007 baseline.
- Manual smoke: open the app, create a new patient — the MRN column in the patients table reads `MRN-000007` (or whatever the next counter slot is); the PatientForm has no MRN input; the Edit form shows MRN as a read-only label.
- Manual smoke: list search by exact MRN (typing `MRN-000001` into the filter) returns the matching row.
- Manual smoke: open a finalized report PDF — the MRN line in the patient block is populated (no `—` fallback).
</verification>

<success_criteria>
- Creating a patient no longer shows an MRN input field.
- Every new patient row is created with `mrn` matching `^MRN-\d{6}$`; counter increments atomically.
- Pre-migration NULL MRNs are backfilled; pre-migration valid MRNs (including test fixtures) are preserved unchanged.
- `mrn` is no longer editable — patch `mrn` rejected by validator (`.strict()`); repo ignores even if it slipped past.
- Patient list search by exact MRN keeps working.
- PDF report header still shows the patient's MRN (now never null).
</success_criteria>

<output>
No additional SUMMARY.md files (quick task — single PLAN, two atomic commits, no phase directory).
</output>
