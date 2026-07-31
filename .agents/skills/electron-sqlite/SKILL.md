---
name: electron-sqlite
description: |
  Use SQLite locally inside an Electron app via better-sqlite3, with a sane
  schema migration strategy, encryption at rest via Electron `safeStorage`, and
  backup/restore flows. Use this skill whenever the user needs to store
  patient/business data locally, asks for "sqlite", "better-sqlite3", "local
  database", "schema migration", "encrypt the database", "backup the data", or
  needs help with native-module rebuild issues in Electron. Triggers on phrases
  like "patient database", "local storage", "migrations", "knex", "prisma
  sqlite", "backup restore", "encrypted db". Do NOT use this for cloud
  Postgres, server-side SQLite, in-memory caches, or vector/embedding storage.
---

# SQLite in Electron (better-sqlite3)

## Inputs to collect

- Data shape — what entities (patients, procedures, reports, users, audit log)
- Volume expectations — dozens of records or millions? (affects indexing strategy)
- Encryption requirement — medical/patient data should be encrypted at rest
- Backup strategy — manual, scheduled, or both

For the colonoscopy app: patient/procedure/report metadata is small (thousands of rows, not millions). Video files are separate, on disk. The SQLite file stays under 50 MB for years. This is the sweet spot for better-sqlite3.

## Procedure

### 1. Install and rebuild for Electron

```bash
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3 @electron/rebuild
```

Add to `package.json`:

```json
"scripts": {
  "postinstall": "electron-rebuild"
}
```

Why: better-sqlite3 is a native module with a prebuilt binary for Node. Electron uses a different Node ABI, so the binary must be rebuilt against Electron's Node version. The postinstall hook runs after every `npm install` and prevents the "invalid ELF / wrong architecture / cannot find module" crash on first launch.

For fresh clones and CI, also add:

```json
"scripts": {
  "rebuild:native": "electron-rebuild"
}
```

If `electron-rebuild` ever fails on Windows, the manual alternative is:

```bash
npm rebuild better-sqlite3 --build-from-source --runtime=electron --target=<electron version>
```

### 2. Database location — where the file actually lives

The DB must live in `app.getPath('userData')`, **never** inside the app bundle, ASAR, or a project subdirectory. Reasons:

- App bundle is read-only when installed
- ASAR is read-only and can't be opened by SQLite
- Project subdirs get wiped on uninstall
- `userData` survives updates, is per-OS-user, and is the correct location for user-generated state

```ts
// main/db/paths.ts
import { app } from 'electron'
import path from 'node:path'

export const dataDir = (): string => {
  const dir = path.join(app.getPath('userData'), 'data')
  // Ensure exists
  require('node:fs').mkdirSync(dir, { recursive: true })
  return dir
}

export const dbPath = (): string => path.join(dataDir(), 'app.db')
export const mediaDir = (): string => path.join(dataDir(), 'media')
```

### 3. Database singleton (open once, reuse forever)

```ts
// main/db/index.ts
import Database from 'better-sqlite3'
import { dbPath } from './paths'
import { runMigrations } from './migrations'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  db = new Database(dbPath(), {
    // WAL = better concurrency, fewer fsync stalls during writes
    // CRITICAL for medical apps that may write mid-recording
  })
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')  // enforce FK constraints
  db.pragma('synchronous = NORMAL')  // safer than OFF, faster than FULL
  runMigrations(db)
  return db
}
```

Why `WAL`: write-ahead logging lets readers not block writers and vice versa. For a medical app where the renderer might be reading patient data while a recording session is writing procedure records, this prevents UI freezes.

`foreign_keys = ON` is off by default in SQLite. Turn it on or your FK columns are decorative.

### 4. Migration strategy (this matters more than the schema)

Don't write a one-shot schema in `getDb()`. Use a versioned migrations table. Without this, schema changes break existing installs.

```ts
// main/db/migrations.ts
import type Database from 'better-sqlite3'

type Migration = {
  id: number
  name: string
  up: (db: Database.Database) => void
}

const migrations: Migration[] = [
  {
    id: 1,
    name: 'initial_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE patients (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          dob TEXT NOT NULL,
          gender TEXT,
          mrn TEXT UNIQUE,
          phone TEXT,
          notes TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE procedures (
          id TEXT PRIMARY KEY,
          patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
          doctor_id TEXT NOT NULL,
          procedure_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'recording',
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          duration_seconds INTEGER,
          video_path TEXT,
          device_name TEXT,
          resolution TEXT,
          framerate INTEGER,
          notes TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX idx_procedures_patient ON procedures(patient_id);
        CREATE INDEX idx_procedures_started ON procedures(started_at);

        CREATE TABLE screenshots (
          id TEXT PRIMARY KEY,
          procedure_id TEXT NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
          timestamp_in_video REAL,
          file_path TEXT NOT NULL,
          annotation TEXT,
          created_during TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE reports (
          id TEXT PRIMARY KEY,
          procedure_id TEXT NOT NULL UNIQUE REFERENCES procedures(id) ON DELETE CASCADE,
          findings TEXT,
          diagnosis TEXT,
          recommendations TEXT,
          procedure_details TEXT,
          pdf_path TEXT,
          finalized_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE report_screenshots (
          report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
          screenshot_id TEXT NOT NULL REFERENCES screenshots(id) ON DELETE CASCADE,
          sort_order INTEGER NOT NULL,
          PRIMARY KEY (report_id, screenshot_id)
        );

        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'doctor',
          pin_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT,
          action TEXT NOT NULL,
          entity_type TEXT,
          entity_id TEXT,
          metadata_json TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX idx_audit_user ON audit_log(user_id);
        CREATE INDEX idx_audit_created ON audit_log(created_at);
      `)
    },
  },
  // Future migrations: { id: 2, name: '...', up: (db) => { ... } }
]

export function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `)

  const applied = new Set(
    db.prepare('SELECT id FROM _migrations').all().map((r: any) => r.id)
  )

  const pending = migrations.filter((m) => !applied.has(m.id))
  if (pending.length === 0) return

  // Each migration in its own transaction; if it fails, the DB stays consistent
  const insertMigration = db.prepare(
    'INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)'
  )
  for (const m of pending) {
    const txn = db.transaction(() => {
      m.up(db)
      insertMigration.run(m.id, m.name, Date.now())
    })
    txn()
  }
}
```

Rules for adding new migrations:
- Never edit a migration that has shipped. Add a new one with the next `id`.
- Each migration runs in a transaction. If it fails partway, the DB is unchanged.
- Migrations are append-only. The order they appear in the array is the order they run.

### 5. Repositories (one per entity, plain functions)

```ts
// main/db/patient-repo.ts
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { getDb } from './index'

export type Patient = {
  id: string
  name: string
  dob: string
  gender?: string | null
  mrn?: string | null
  phone?: string | null
  notes?: string | null
  created_at: number
}

export const patientRepo = {
  create(input: Omit<Patient, 'id' | 'created_at'>): Patient {
    const db = getDb()
    const patient: Patient = {
      id: randomUUID(),
      ...input,
      created_at: Date.now(),
    }
    db.prepare(`
      INSERT INTO patients (id, name, dob, gender, mrn, phone, notes, created_at)
      VALUES (@id, @name, @dob, @gender, @mrn, @phone, @notes, @created_at)
    `).run(patient)
    return patient
  },

  list(): Patient[] {
    return getDb().prepare('SELECT * FROM patients ORDER BY name COLLATE NOCASE').all() as Patient[]
  },

  get(id: string): Patient | undefined {
    return getDb().prepare('SELECT * FROM patients WHERE id = ?').get(id) as Patient | undefined
  },

  search(q: string): Patient[] {
    return getDb().prepare(`
      SELECT * FROM patients
      WHERE name LIKE ? OR mrn LIKE ?
      ORDER BY name COLLATE NOCASE
    `).all(`%${q}%`, `%${q}%`) as Patient[]
  },
}
```

Why repositories: the rest of the app never writes SQL. Repositories make the renderer→main IPC handlers trivial, give you one place to enforce invariants, and make the data layer unit-testable.

### 6. Encryption at rest (using Electron safeStorage)

`better-sqlite3` doesn't have built-in encryption. The pragmatic Electron approach:

1. Generate or load a per-install encryption key
2. Store the key in OS keychain via `safeStorage` (Windows DPAPI, macOS Keychain, Linux libsecret)
3. Encrypt the DB file at rest using the key + a SQLCipher-style approach, OR more simply: encrypt sensitive fields (PINs, names) at the application level

For medical apps the second approach is faster to ship and covers the threat model (someone copies `app.db` off disk):

```ts
// main/services/encryption.ts
import { safeStorage } from 'electron'

const APP_KEY = 'colonoscoPII_v1'

export function encryptString(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    // Linux without keyring — log warning, fall back to plaintext
    console.warn('safeStorage unavailable; sensitive fields not encrypted at rest')
    return plain
  }
  return safeStorage.encryptString(plain).toString('base64')
}

export function decryptString(cipher: string): string {
  if (!safeStorage.isEncryptionAvailable()) return cipher
  try {
    return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
  } catch {
    return cipher  // already plaintext (dev mode)
  }
}
```

Use on sensitive fields (PINs, anything matching `PII_*`):

```ts
// When writing
db.prepare('INSERT INTO users (id, name, pin_hash) VALUES (?, ?, ?)')
  .run(id, name, encryptString(pinHash))

// When reading
const row = db.prepare('SELECT pin_hash FROM users WHERE id = ?').get(id) as any
const pin = row ? decryptString(row.pin_hash) : null
```

For the file-level encryption of the whole DB (stronger, more work): use `better-sqlite3-multiple-ciphers` (drop-in replacement, SQLCipher). Worth it if the threat model is "attacker with disk access reads the file." For clinic workstations, application-level encryption of PII fields is usually sufficient.

### 7. Backup and restore

```ts
// main/services/backup.ts
import { app, dialog, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { dbPath, mediaDir } from '../db/paths'

export async function createBackup(parent: BrowserWindow): Promise<string | null> {
  const { filePath, canceled } = await dialog.showSaveDialog(parent, {
    title: 'Save backup',
    defaultPath: `backup-${new Date().toISOString().slice(0, 10)}.zip`,
    filters: [{ name: 'Zip', extensions: ['zip'] }],
  })
  if (canceled || !filePath) return null

  // Use system zip via child_process (no npm dep, no native module pain)
  const { execFile } = require('node:child_process')
  const util = require('node:util')
  const exec = util.promisify(execFile)
  await exec('powershell', [
    '-NoProfile', '-Command',
    `Compress-Archive -Path "${dbPath()}", "${mediaDir()}" -DestinationPath "${filePath}" -Force`
  ], { shell: true })

  return filePath
}
```

For restore, the inverse: extract the zip to a temp dir, validate the DB file, then atomic-replace the live data directory.

### 8. Performance basics

- `prepare()` once, reuse — better-sqlite3 caches prepared statements; calling `.prepare()` in a hot loop is wasteful
- Use transactions for bulk inserts (`db.transaction(() => { ... })()`)
- Add indexes for any column you filter or sort by frequently
- For full-text search on patient names/notes, add an FTS5 virtual table (SQLite has it built in):

```sql
CREATE VIRTUAL TABLE patients_fts USING fts5(name, mrn, notes, content='patients', content_rowid='rowid');
```

### 9. Connection lifecycle

- Open the DB once in `app.whenReady()`
- Close on `app.on('will-quit', () => db?.close())`
- Do NOT open a new connection per IPC call. Each `new Database()` is ~10ms and leaks file handles if not closed.

## Output contract

A working local data layer that:

- Stores all entities in a single `app.db` file in the user's data directory
- Migrates cleanly across versions without losing data
- Encrypts PII fields at rest using the OS keychain
- Exposes repository functions for the main process to call from IPC handlers
- Backs up to a zip including the DB and media folder
- Uses WAL mode so reads don't block writes (and vice versa)

## Failure handling

- **"Cannot find module 'better-sqlite3'" or "wrong architecture" on packaged app** → `electron-rebuild` wasn't run after install. Add the postinstall script and reinstall.
- **DB file is locked / "database is locked"** → you have multiple `new Database()` connections open. Make sure `getDb()` is the only entry point.
- **"Foreign key mismatch" on insert** → `PRAGMA foreign_keys = ON` is not set, OR you're inserting a `patient_id` that doesn't exist. Add the pragma, then check the parent row exists.
- **App starts but no data shows** → migration silently failed. Wrap `runMigrations` in try/catch and surface the error to the user, not just console.
- **Backup zip is empty** → paths have spaces and PowerShell didn't quote them; use the `execFile` array form (no shell interpolation).
- **Migration partially applied then crashes** → migrations run inside a transaction per migration; if the app crashes mid-migration, the transaction rolls back, the next launch retries it. Verified by checking `_migrations` table.
- **Linux without libsecret → `safeStorage` not available** → handled by the fallback warning; document this for clinic Linux machines and prefer Windows.

## Examples

**Input**: "Set up the patient database with migrations."

**Output**: Install better-sqlite3 + electron-rebuild, add the migrations skeleton in section 4, define the schema, write `getDb()` and `patientRepo` per sections 3 and 5.

**Input**: "Encrypt the patient PINs and any notes at rest."

**Output**: Use the `encryptString` / `decryptString` pattern from section 6, applied to `pin_hash` on insert and on read in the auth flow. Document the `safeStorage` Linux fallback in user-facing release notes.

**Input**: "Add a 'Search patients' feature."

**Output**: Add `patientRepo.search(q)` (already in section 5), expose via IPC, render in the UI. If performance is slow beyond ~10k patients, add the FTS5 virtual table from section 8.
