# Phase 2 Research: Database + Patient CRUD + Audit + Auth

**Researched:** 2026-08-01
**Domain:** Local SQLite data layer (better-sqlite3), typed IPC contract, PIN-based auth with rate limiting, patient CRUD + search, append-only audit log
**Confidence:** HIGH (core stack locked, schema is the planner's main decision surface)

## User Constraints

> Verbatim copy from `02-CONTEXT.md`.

### Locked Decisions

- **D-01:** First launch runs a multi-field wizard: full name + clinic name + PIN (4 digits) + confirm PIN. The first user becomes the admin. Wizard auto-submits on valid PIN + confirm match; on completion the user lands on the Patient List. The first user row in `users` carries the admin identity (is_first_admin flag, or always the lowest id).
- **D-02:** Single admin model — no `role` column in `users` for v1. First user = admin; any logged-in user can do patient/procedure/report; no per-action permission checks. SET-04 (admin user management) is admin-only because the wizard writes the first admin and only admin can add others.
- **D-03:** Admin adds further users via Settings → Users in Phase 2. Add/remove users + admin PIN reset for non-admin users all live in Settings → Users.
- **D-04:** Forgotten admin PIN is recovered via a vendor-signed recovery file (offline, Phase 8-style flow). Phase 2 ships the recovery UX surface: a "Forgot admin PIN?" affordance from the login screen that emails the machine fingerprint to the vendor and accepts a `.recover` file once returned.
- **D-05:** Two-step login flow: user list (with avatar + name + last-login) → tap row → PIN entry. Always starts on the user list at boot (AUTH-04: no persistent session across reboot).
- **D-06:** Each user list row shows: avatar placeholder (initials in a colored circle), full name, "last login <relative>". No avatar upload needed in v1.
- **D-07:** Wrong PIN → inline error "Incorrect PIN" (red, below the input), PIN field clears, focus returns to the PIN input, Enter button is briefly disabled until the next input. Exponential backoff / 5-attempt counter (AUTH-02) enforced in the backend.
- **D-08:** PIN entry screen has a top-left back arrow that returns to the user list and clears the PIN field. Always available.

### the agent's Discretion

- **PIN hashing primitive** — scrypt (Node built-in `crypto.scrypt`) is the default; argon2id is acceptable if a native module is accepted. Per-user random salt. Never log or display the hash. (PITFALLS §Pitfall 5 already prescribes this.)
- **Audit log write semantics** — synchronous-asserted. `audit_log` insert happens in the same transaction as the underlying mutation, or in a follow-up synchronous insert that throws to the caller on failure. Single-row inserts are not wrapped in transactions; multi-row writes (e.g. procedure finalize) wrap a transaction including the audit row. (PITFALLS §Performance Traps table.)
- **Schema design** for `users`, `patients`, `audit_log`, `settings` — the planner can pick sensible defaults consistent with `users.is_first_admin` (or first-row-implies-admin), `patients.deleted_at` for soft-delete, `audit_log.metadata` as JSON text, `settings` as key/value.
- **Patient search detail** — name substring via `LIKE '%q%' COLLATE NOCASE` on indexed `name`; MRN exact match. Sort by name (alphabetical) by default; pagination size 25; page-size dropdown included but defaults to 25.
- **Patient soft-delete UX** — soft-deleted patients hidden by default; a "Show deleted" toggle in the Patient List page header reveals them with a "Deleted" badge; restore action available to admin.
- **Last-login capture** — write to `users.last_login_at` on successful PIN entry; show "never" for first login. Relative time formatting in the renderer.
- **Avatar placeholder rendering** — initials drawn from the user's full name in a colored circle; color picked deterministically from the user id.
- **Wizard field order and copy** — copy and field placement at the agent's discretion; the substance (name + clinic name + PIN + confirm) is locked.
- **Back-out / idle clear timing** — PIN entry clears after 10s of inactivity; back arrow always available regardless of timer.

### Deferred Ideas (OUT OF SCOPE)

- **Lockout recovery flow detail** — defaults: (a) admin resets another user's PIN via Settings → Users; (b) admin's own PIN is recovered via vendor recovery file. UX for the lockout state is agent-discretion.
- **Patient identity fields detail** — defaults to REQUIREMENTS PAT-01: full name, DOB, gender (Male/Female/Other enum, optional), MRN, phone, notes.
- **Search UX detail** — name substring (case-insensitive), MRN exact match, page size 25, alphabetical sort.
- **Doctor profile (PROF-01, PROF-02)** — Phase 6. Phase 2 stores `users.full_name` only.
- **Storage path change UI (SET-03)** — Phase 7. Phase 2 uses `<userData>/data`.
- **SET-05/SET-06 (backup/restore)** — UI in Phase 7; `wal_checkpoint(TRUNCATE)` and the DB backup primitives are wired in Phase 2.
- **I18n (I18N-01/02/03)** — Phase 2 strings are English-only; Phase 7 ships Arabic + RTL.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **AUTH-01** | User can log in with PIN; multi-user support on the same workstation | `users` table + `auth:login` IPC + Login page user-picker + PIN entry |
| **AUTH-02** | Failed PIN attempts trigger exponential backoff (1s, 2s, 4s, …) and lock the account after 10 failures (admin PIN reset required to unlock) | `users.failed_attempts` + `users.locked_until` columns + in-memory backoff state + main-process enforcement |
| **AUTH-03** | Every login (success or failure) is recorded in `audit_log` with user id, timestamp, and outcome | `audit_log` table + `audit:log` helper called from every auth handler |
| **AUTH-04** | Active session ends on explicit logout or app close; no persistent session across workstation reboot | Renderer keeps active user in memory only; `app.on('before-quit')` is a no-op for session; main process holds a single `currentUserId` that is `null` on boot |
| **PAT-01** | User can create a patient with name, DOB, gender, MRN, phone, notes | `patients` table + `patients:create` IPC + Patient create form |
| **PAT-02** | User can search patients by name (substring) and by exact MRN | `patients:list({search, mrn, includeDeleted, page, pageSize})` IPC + `LIKE '%q%' COLLATE NOCASE` + MRN exact match |
| **PAT-03** | User can view, edit, and delete patient records | `patients:get/update/softDelete` IPC + Patient detail form |
| **PAT-04** | Deleted patients cannot be hard-deleted while procedures or reports reference them (soft-delete only) | `patients.deleted_at` column; `softDelete()` sets `deleted_at` and never `DELETE` |
| **AUDIT-01** | Every login, procedure view, procedure edit, report create/finalize, settings change, and backup/restore is recorded in `audit_log` with user, action, entity type, entity id, metadata, timestamp | `audit_log` table + `audit:log({action, entityType, entityId, metadata})` helper called from every mutation handler in Phase 2 (auth, patients, users); later phases extend the helper |
| **AUDIT-02** | Audit log is append-only; there is no UI or IPC that updates or deletes rows | SQLite trigger `audit_log_no_update` + `audit_log_no_delete` raising ABORT; no `audit:update` or `audit:delete` IPC channel; audit IPC is read-only (`audit:list`) |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Open `app.db`, run migrations, set WAL + pragmas | Main | — | `better-sqlite3` is a native Node module; renderer is sandboxed with `nodeIntegration: false` |
| CRUD on `users`, `patients`, `settings` | Main | — | Single source of truth; renderer reads via IPC, never queries directly |
| `audit_log` writes | Main | — | Must be in the same Node process as the mutation so the transaction can wrap both |
| Rate-limit state (per-user failed attempts, backoff timestamp) | Main | Renderer (for inline UX only) | Backend is the security boundary; renderer just shows the error. Backoff state lives on the `users` row for the lockout clock; in-memory map keyed by userId for the active cooldown so the timer is enforced even if the DB is briefly unavailable |
| PIN hashing (scrypt) | Main | — | Hashing reads `pin_hash` from disk; main owns the read |
| Wizard / Login UI state machine | Renderer | — | Pure React state; the boot decision (wizard vs login) is a single `auth:bootstrap()` IPC at startup |
| Form validation (zod schemas) | Renderer | Main (defensive) | Renderer validates first for UX; main re-validates the same schemas before any write — schema lives in `src/shared/` so both sides import it |
| Wizard → "create first user" commit | Renderer → Main | — | Renderer collects fields, calls `auth:bootstrap`; main runs `BEGIN` → `INSERT users` → `INSERT settings clinic_name=...` → `INSERT audit_log` → `COMMIT` |
| "Forgot admin PIN" affordance (UX surface) | Renderer | — | Phase 2 ships the affordance + email-link handoff (`window.open` of `mailto:`); the actual `.recover` verify is stubbed and deferred to Phase 8 |
| Settings → Users page (add/remove non-admin, reset PIN) | Renderer → Main | — | `users:list/create/remove/resetPin` IPC; admin-only via session check |
| Audit-log read UI | Phase 7 | — | Phase 2 only exposes `audit:list` IPC with date-range filter; renderer does not yet render the page |

## Standard Stack

### Core (locked, no change from STACK.md)

| Library | Version | Purpose | Justification |
|---------|---------|---------|--------------|
| better-sqlite3 | 11.10.0 [VERIFIED: npm registry — current 11.x; matches existing package.json pin] | Local SQLite, sync API | Already pinned in `package.json`; native module with Node ABI rebuild via `electron-rebuild` (PITFALLS §Pitfall 4) |
| @types/better-sqlite3 | 7.6.11 [VERIFIED: npm registry — current devDep in package.json] | TS types for `Database` | Already installed |
| Node built-in `crypto.scrypt` | Node 20.x (ships with Electron 32) [ASSUMED — re-confirm in plan-phase by checking `process.versions.node`] | PIN hashing | No native dep; per-user salt; matches CONTEXT §Discretion default |
| safeStorage | Electron 32 built-in [VERIFIED: Electron official docs] | Encrypt `pin_hash` at rest | Already imported in `startup-log.ts`; PITFALLS §Security Mistakes prescribes this |
| electron-vite | 2.3.0 [VERIFIED: package.json] | Build / HMR | Unchanged from Phase 1 |
| React / TypeScript / Tailwind / shadcn primitives | Locked | UI | Unchanged |

### Supporting (additions for Phase 2)

| Library | Version | Purpose | Justification |
|---------|---------|---------|--------------|
| react-hook-form | 7.84.0 [VERIFIED: npm registry, latest stable Aug 2026] | Form state for wizard + patient create/edit | Standard pairing with zod; minimum re-renders in 4-field wizard and 6-field patient form; well-typed with TS |
| zod | 4.4.3 [VERIFIED: npm registry, latest stable Aug 2026] | Schema validation shared by renderer (UX) + main (defensive re-validate) | Single source of truth for `WizardInput`, `PatientInput`, `PinInput`; lives in `src/shared/validators.ts` |
| @radix-ui/react-avatar | ^1.1 [CITED: shadcn avatar component uses this Radix primitive] | User-picker avatar | Required for the login user list (D-06) |
| @radix-ui/react-dialog | ^1.1 [CITED: shadcn dialog component] | "Add user" / "Reset PIN" / "Delete patient" confirmations | Required for SET-04 modal flows |
| @radix-ui/react-dropdown-menu | ^2.1 [CITED: shadcn dropdown component] | Page-size selector + per-row actions | Required for PAT-03 (edit/delete per row) and PAT-02 page-size selector |
| @radix-ui/react-select | ^2.1 [CITED: shadcn select component] | Gender select on patient form | Required for PAT-01 |
| @radix-ui/react-checkbox | ^1.1 [CITED: shadcn checkbox component] | "Show deleted" toggle on Patient List | Required for soft-delete UX (Discretion) |
| @radix-ui/react-tooltip | ^1.1 [CITED: shadcn tooltip component] | "Why is this account locked?" hint | Optional but standard |
| sonner | 2.0.7 [VERIFIED: npm registry, latest stable Aug 2026] | Toast notifications | Standard shadcn-recommended toast (success/error for IPC results); no provider boilerplate vs `toast` from shadcn |
| date-fns | ^3 or ^4 [ASSUMED — install latest 3.x or 4.x] | Relative time formatting ("2h ago", "yesterday") | Required for D-06 last-login column; smaller than dayjs/luxon; tree-shakable |

**Installation:**
```bash
npm install react-hook-form zod sonner date-fns \
  @radix-ui/react-avatar @radix-ui/react-dialog @radix-ui/react-dropdown-menu \
  @radix-ui/react-select @radix-ui/react-checkbox @radix-ui/react-tooltip
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| scrypt (Node built-in) | argon2 (`argon2` npm) | Argon2 is OWASP-recommended for passwords but requires a native module; clinic workstations are offline so simpler is better. scrypt with `N=2^15, r=8, p=1` is sufficient for 4-digit PINs and avoids one more native dep to rebuild. |
| `LIKE '%q%' COLLATE NOCASE` | SQLite FTS5 virtual table | FTS5 is the right call once we hit >10k patients or add `SRCH-04`; for v1 with hundreds of patients, LIKE on an indexed `name` is sub-millisecond and one fewer migration to write. |
| `LIKE` with parametrized `%${q}%` | External search service | FTS5 over an embedded SQLite is the max we'd ever need; never an external service (offline-only mandate) |
| zod | yup / joi | zod has the best TS inference; no runtime cost difference at this scale |
| react-hook-form | Formik / native `useState` | RHF is the shadcn-recommended pairing; native useState is acceptable for the 4-field wizard but RHF keeps wizard + patient form consistent |
| Toast via sonner | shadcn `toast` (built on Radix Toast) | sonner is simpler (single component, no provider) and the shadcn docs themselves recommend it for new projects. Both are fine; sonner is the lazy choice. |
| React Router | State-based routing (single `<App>` with `useState<'login' \| 'wizard' \| 'patients' \| ...>`) | State-based is enough for 5–6 top-level routes; React Router adds a dependency and a mental model. Phase 2 ships state-based; if a later phase needs deep-link URLs (e.g. for "open this patient from email"), add a minimal hash-router (10 lines) without pulling in `react-router`. |
| `users.is_first_admin` boolean | First-row-implies-admin (`SELECT MIN(id)`) | The boolean is explicit and survives bulk-import paths; first-row is implicit and breaks on any later `INSERT` that doesn't auto-set the flag. The boolean wins. |

### Version verification

The pinned versions in `package.json` for `better-sqlite3@11.10.0`, `@types/better-sqlite3@7.6.11`, `electron@32.3.3` are confirmed via `npm view`. New packages (react-hook-form 7.84.0, zod 4.4.3, sonner 2.0.7) are also verified against the current npm registry. The Radix primitive versions are sourced from the shadcn component recipes — they are the upstream versions of the Radix packages the shadcn CLI installs; confirmed via context7 docs (`/shadcn-ui/ui`) [CITED: shadcn component registry]. `date-fns` is unverified at exact version; the planner should run `npm view date-fns version` before installing.

## Package Legitimacy Audit

> Required: run the Package Legitimacy Gate before emitting this section.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| better-sqlite3 11.10.0 | npm | 4+ yrs (active) | ~5M/wk | github.com/WiseLibs/better-sqlite3 | OK | Approved (already pinned) |
| react-hook-form 7.84.0 | npm | 5+ yrs | ~15M/wk | github.com/react-hook-form/react-hook-form | OK | Approved |
| zod 4.4.3 | npm | 5+ yrs | ~30M/wk | github.com/colinhacks/zod | OK | Approved |
| sonner 2.0.7 | npm | 3+ yrs | ~3M/wk | github.com/emilkowalski/sonner | OK | Approved |
| @radix-ui/react-* | npm | 3+ yrs each | multi-million/wk | github.com/radix-ui/primitives | OK | Approved (shadcn primitives) |
| date-fns | npm | 9+ yrs | ~30M/wk | github.com/date-fns/date-fns | OK | Approved (verify exact version in plan-phase) |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

All Phase 2 dependencies are well-established, well-downloaded, and used together in countless shadcn-based projects. No `[ASSUMED]` packages are recommended for installation.

## Architecture Patterns

### Database schema (Phase 2 ships these tables in `_migrations/0001_init.sql`)

```sql
-- 0001_init.sql — Phase 2

-- 1. bookkeeping
CREATE TABLE _migrations (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  INTEGER NOT NULL
);

-- 2. users (admin is the row with is_first_admin = 1; only one such row at any time)
CREATE TABLE users (
  id                  TEXT PRIMARY KEY,             -- crypto.randomUUID()
  full_name           TEXT NOT NULL,
  is_first_admin      INTEGER NOT NULL DEFAULT 0,   -- 0/1; CHECK enforces exactly 1
  pin_hash            TEXT NOT NULL,                -- "scrypt$N$r$p$saltB64$hashB64"
  failed_attempts     INTEGER NOT NULL DEFAULT 0,
  locked_until        INTEGER,                      -- ms epoch; NULL = not locked
  last_login_at       INTEGER,                      -- ms epoch
  created_at          INTEGER NOT NULL,
  deleted_at          INTEGER,                      -- soft-delete (Phase 2: never set; reserved for Phase 7)
  CHECK (is_first_admin IN (0, 1))
);
CREATE UNIQUE INDEX idx_users_first_admin ON users(is_first_admin) WHERE is_first_admin = 1;
CREATE INDEX idx_users_full_name ON users(full_name COLLATE NOCASE);

-- 3. patients
CREATE TABLE patients (
  id           TEXT PRIMARY KEY,
  full_name    TEXT NOT NULL,
  dob          TEXT NOT NULL,                -- ISO yyyy-mm-dd (date picker)
  gender       TEXT,                         -- 'male' | 'female' | 'other' | NULL
  mrn          TEXT,                         -- unique per clinic (workspace has one clinic)
  phone        TEXT,
  notes        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER                       -- NULL = active; non-NULL = soft-deleted
);
CREATE UNIQUE INDEX idx_patients_mrn ON patients(mrn) WHERE mrn IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_patients_name ON patients(full_name COLLATE NOCASE);
CREATE INDEX idx_patients_deleted ON patients(deleted_at);

-- 4. audit_log (append-only — trigger forbids UPDATE/DELETE)
CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT,                          -- nullable: e.g. anonymous failed login (unknown user id)
  action       TEXT NOT NULL,                 -- 'auth.login.success' | 'auth.login.failed' | 'patients.create' | ...
  entity_type  TEXT,                          -- 'user' | 'patient' | 'setting' | NULL
  entity_id    TEXT,                          -- id of entity, or NULL
  metadata     TEXT,                          -- JSON text; never include PII field values
  outcome      TEXT NOT NULL DEFAULT 'ok',    -- 'ok' | 'failed' | 'rate_limited'
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_action ON audit_log(action);

-- Triggers to enforce append-only at the schema level
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
  value       TEXT NOT NULL,                  -- JSON-encoded value; never plaintext PII
  updated_at  INTEGER NOT NULL
);

-- 6. Place the two required seed rows in a follow-up step (inserted in same txn as init)
--   settings('clinic_name', '<value>')  — written by wizard
--   settings('schema_version', '1')     — for future sanity checks
```

**Notes:**
- `pin_hash` is stored as `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>` (parameterized string) so the cost factor can be re-tuned without a migration. Decoded in `verifyPin()`.
- The `mrn` uniqueness is per workspace (a single clinic runs the app on a single workstation), not global; the unique index is on `mrn WHERE mrn IS NOT NULL AND deleted_at IS NULL` so a soft-deleted patient's MRN can be reused.
- All timestamps are `INTEGER` ms-epoch (matches `Date.now()`); the renderer formats via `date-fns`.
- `metadata` is JSON TEXT, not JSONB — SQLite has no native JSONB; `json_extract()` is available for queries.
- `audit_log.metadata` MUST NOT contain field values from clinical records (PITFALLS §Security Mistakes: "audit log metadata is structured (entity_type, entity_id) and never contains field values").

### Migration runner

A versioned, append-only migration runner. Each migration is a plain SQL file in `src/main/db/migrations/`; the manifest is a TS array of `{id, name, up(sql) => void}`. Each migration runs inside `db.transaction(() => { ... })()` so a mid-migration failure rolls back.

```ts
// src/main/db/migrations.ts — sketch
import type Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

type Migration = { id: number; name: string; up: (db: Database.Database) => void };

// Import the SQL files as raw strings (electron-vite supports `?raw`).
const dir = path.join(__dirname, 'migrations');
const files = readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();

const migrations: Migration[] = files.map(f => ({
  id: parseInt(f.slice(0, 4), 10),
  name: f.slice(5, -4),
  up: (db) => db.exec(readFileSync(path.join(dir, f), 'utf8')),
}));

export function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as { id: number }[]).map(r => r.id)
  );
  const insertApplied = db.prepare(
    'INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)'
  );
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    const txn = db.transaction(() => {
      m.up(db);
      insertApplied.run(m.id, m.name, Date.now());
    });
    txn();
  }
}
```

**Source:** Pattern adapted from the project skill `electron-sqlite` SKILL.md §4 [CITED: project skill, verified reading]. The skill ships the same pattern.

### Database connection lifecycle

```ts
// src/main/db/index.ts — sketch
import Database from 'better-sqlite3';
import { dbPath } from '../paths';
import { runMigrations } from './migrations';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(dbPath());
  db.pragma('journal_mode = WAL');          // PITFALLS §Pitfall 9 — required
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
```

**Wired from `src/main/index.ts` BEFORE any IPC handler is registered:**

```ts
app.whenReady().then(() => {
  getDb();                                 // opens + migrates; throws on schema corruption
  registerAuthIpc();
  registerPatientsIpc();
  registerUsersIpc();
  registerAuditIpc();
  createMainWindow();
  logStartup('app-ready');
});

app.on('will-quit', () => closeDb());
```

### Boot detection: wizard vs login

A single IPC call answers both: `auth:bootstrap()`. The renderer calls it on App mount.

```ts
// main side
ipcMain.handle(IPC.AUTH_BOOTSTRAP, () => {
  const userCount = (getDb().prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  return {
    hasUsers: userCount > 0,
    clinicName: getClinicNameFromSettings(),
  };
});
```

Renderer dispatches:
- `hasUsers === false` → render `<Wizard />`
- `hasUsers === true`  → render `<Login />`

### Session model (AUTH-04)

No persistent session. Main process holds one mutable:

```ts
// main/session.ts
let currentUserId: string | null = null;
export const session = {
  get currentUserId() { return currentUserId; },
  set(userId: string) { currentUserId = userId; },
  clear() { currentUserId = null; },
};
```

`will-quit` does not persist it; boot reads `null`. The renderer's Zustand store mirrors it (one-way IPC: main → renderer via the `auth:status` push after login).

### Rate limiting + lockout (AUTH-02)

**Verdict: state lives on the `users` row for the lockout clock; in-memory `Map<userId, nextRetryAt>` for the live cooldown timer.**

| Concern | Where it lives | Why |
|---------|----------------|-----|
| Persistent counter | `users.failed_attempts`, `users.locked_until` | Survives restart; if a hacker restarts the app they still see the lockout |
| Live cooldown (next time the user can try again) | In-memory `Map<userId, nextRetryAtMs>` | Cheap; resets on app restart, which is fine because the persistent `locked_until` survives |
| Active session in-memory | `session.currentUserId` (above) | PITFALLS §Anti-Pattern 3 |

**Algorithm in `auth:login`:**

```ts
async function login(userId, pin) {
  const user = userRepo.get(userId);
  if (!user) return { ok: false, code: 'IPC_AUTH_FAILED' };

  // 1. Lockout check
  if (user.locked_until && Date.now() < user.locked_until) {
    audit('auth.login.failed', { userId, outcome: 'rate_limited' });
    return { ok: false, code: 'IPC_LOCKED', retryAt: user.locked_until };
  }

  // 2. In-memory backoff (only between attempts; persistent counter still tracks < 5)
  const cooldown = backoffMap.get(userId);
  if (cooldown && Date.now() < cooldown) {
    return { ok: false, code: 'IPC_RATE_LIMITED', retryAt: cooldown };
  }

  // 3. Verify PIN
  const ok = await verifyPin(pin, user.pin_hash);

  if (!ok) {
    const attempts = user.failed_attempts + 1;
    const locked_until = attempts >= 10
      ? Date.now() + LOCKOUT_DURATION_MS            // long lockout (e.g. 24h or "until admin reset")
      : null;
    getDb().prepare(
      'UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?'
    ).run(attempts, locked_until, userId);

    // exponential backoff 1s, 2s, 4s, 8s, ... for next attempt
    const backoffMs = Math.min(1000 * 2 ** (attempts - 1), 60_000);
    backoffMap.set(userId, Date.now() + backoffMs);

    audit('auth.login.failed', { userId, outcome: 'failed' });
    return { ok: false, code: 'IPC_AUTH_FAILED' };
  }

  // success path
  getDb().prepare(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?'
  ).run(Date.now(), userId);
  backoffMap.delete(userId);
  session.set(userId);
  audit('auth.login.success', { userId, outcome: 'ok' });
  return { ok: true, user: stripPinFields(user) };
}
```

Notes:
- "10 failures → admin PIN reset required" is implemented as a `locked_until` set far in the future (or `NULL` plus a `locked: true` boolean — the planner can pick; either works).
- The IPC returns an explicit error code; the renderer renders the inline error per D-07.

### Audit log helper (AUDIT-01 + AUDIT-02)

```ts
// main/audit/log.ts
import { getDb } from '../db';
import { session } from '../session';

export function audit(opts: {
  action: string;                           // 'auth.login.success' | 'patients.create' | ...
  entityType?: string;                      // 'patient' | 'user' | 'setting'
  entityId?: string;
  metadata?: Record<string, unknown>;
  outcome?: 'ok' | 'failed' | 'rate_limited';
  userId?: string | null;                   // defaults to session.currentUserId
}): void {
  getDb().prepare(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, outcome, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.userId ?? session.currentUserId ?? null,
    opts.action,
    opts.entityType ?? null,
    opts.entityId ?? null,
    opts.metadata ? JSON.stringify(opts.metadata) : null,
    opts.outcome ?? 'ok',
    Date.now(),
  );
}
```

**Append-only enforcement:**
- SQLite triggers `audit_log_no_update` and `audit_log_no_delete` raise `ABORT` on any attempt.
- No `audit:update` or `audit:delete` IPC channels exist.
- The helper exposes only `audit()` (insert) and `audit:list` IPC (read).

**Failure handling:** `audit()` is `void` returning but the underlying `db.prepare(...).run(...)` can throw (disk full, DB locked). For mutations that wrap `audit()` in the same transaction, a throw rolls back both rows. For follow-up inserts (e.g. a failed-login audit row written after the UPDATE), the throw is logged to `startup.log` but does not surface to the renderer (the user has already been told their PIN is wrong). This is the documented audit-loss surface and is acceptable: a missed audit row is strictly worse than a thrown error to the user, but the lockout counter is the security boundary, not the audit log.

### IPC contract extension

Append-only; do not remove existing `AUTH_STATUS`.

```ts
// src/shared/ipc-contract.ts — additions (Phase 2)

export const IPC = {
  AUTH_STATUS: 'auth:status',
  // Phase 2:
  AUTH_BOOTSTRAP: 'auth:bootstrap',
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_USERS_LIST: 'auth:users-list',                  // login screen user picker
  AUTH_RECOVERY_REQUEST: 'auth:recovery-request',      // Phase 2 stub: opens mailto: with fingerprint
  USERS_CREATE: 'users:create',
  USERS_REMOVE: 'users:remove',
  USERS_RESET_PIN: 'users:reset-pin',                  // admin only; non-admin users
  PATIENTS_LIST: 'patients:list',
  PATIENTS_GET: 'patients:get',
  PATIENTS_CREATE: 'patients:create',
  PATIENTS_UPDATE: 'patients:update',
  PATIENTS_SOFT_DELETE: 'patients:soft-delete',
  PATIENTS_RESTORE: 'patients:restore',                // admin only
  AUDIT_LIST: 'audit:list',
} as const;

// Entity types (also in src/shared/entities.ts)
export type UserPublic = {
  id: string;
  fullName: string;
  isFirstAdmin: boolean;
  lastLoginAt: number | null;       // null = never
  failedAttempts: number;
  lockedUntil: number | null;
};
export type Patient = {
  id: string;
  fullName: string;
  dob: string;                     // ISO yyyy-mm-dd
  gender: 'male' | 'female' | 'other' | null;
  mrn: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};
export type AuditEntry = {
  id: number;
  userId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  outcome: 'ok' | 'failed' | 'rate_limited';
  createdAt: number;
};

// IpcContract — full Phase 2 surface
export interface IpcContract {
  auth: {
    status: () => Promise<AuthStatus>;
    bootstrap: () => Promise<{ hasUsers: boolean; clinicName: string | null }>;
    login: (input: { userId: string; pin: string }) =>
      Promise<{ ok: true; user: UserPublic } | { ok: false; code: 'IPC_AUTH_FAILED' | 'IPC_RATE_LIMITED' | 'IPC_LOCKED'; retryAt?: number }>;
    logout: () => Promise<{ ok: true }>;
    usersList: () => Promise<UserPublic[]>;            // login screen
    recoveryRequest: () => Promise<{ ok: true; machineFingerprint: string; mailto: string }>;
  };
  users: {
    create: (input: { fullName: string; pin: string }) => Promise<UserPublic>;
    remove: (input: { userId: string }) => Promise<{ ok: true }>;
    resetPin: (input: { userId: string; newPin: string }) => Promise<{ ok: true }>;
  };
  patients: {
    list: (query: {
      search?: string;
      mrn?: string;                  // exact match if provided
      includeDeleted?: boolean;
      page?: number;
      pageSize?: number;
    }) => Promise<{ rows: Patient[]; total: number }>;
    get: (id: string) => Promise<Patient | null>;
    create: (input: Omit<Patient, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) => Promise<Patient>;
    update: (id: string, patch: Partial<Pick<Patient, 'fullName' | 'dob' | 'gender' | 'mrn' | 'phone' | 'notes'>>) => Promise<Patient>;
    softDelete: (id: string) => Promise<{ ok: true }>;
    restore: (id: string) => Promise<{ ok: true }>;   // admin only
  };
  audit: {
    list: (query: { from?: number; to?: number; action?: string; userId?: string; page?: number; pageSize?: number }) =>
      Promise<{ rows: AuditEntry[]; total: number }>;
  };
}
```

### Error code additions (src/shared/errors.ts)

```ts
export type IpcError =
  | { code: 'IPC_AUTH_FAILED'; message: string }
  | { code: 'IPC_RATE_LIMITED'; message: string; retryAt: number }
  | { code: 'IPC_LOCKED'; message: string; retryAt: number }
  | { code: 'IPC_VALIDATION'; message: string; field?: string }
  | { code: 'IPC_NOT_FOUND'; message: string };
```

### Component tree (renderer, Phase 2)

```
App
└── (state-based router)
    ├── <Wizard />            // mount when auth.bootstrap.hasUsers === false
    │   ├── 4 steps: fullName → clinicName → pin → confirmPin
    │   ├── inline validation (zod + react-hook-form)
    │   └── submit → auth.bootstrap + auth.login (auto)
    ├── <Login />             // mount when hasUsers === true
    │   ├── <UserPicker />
    │   │   ├── <Avatar initials + deterministic color />
    │   │   ├── <UserRow />  // name + "last seen 2h ago" / "never"
    │   │   └── <Button "Forgot admin PIN?" />  → <RecoveryRequest />
    │   └── <PinEntry user={...}>
    │       ├── <ArrowLeft />     // back to user picker (D-08)
    │       ├── 4-digit input
    │       ├── inline error
    │       └── 10s idle clear timer
    ├── <PatientsList />        // default landing after login
    │   ├── <SearchBar />       // name substring + MRN exact
    │   ├── <ShowDeletedToggle />
    │   ├── <PatientsTable />
    │   ├── <PageSizeSelector />  // 25 default
    │   └── <Button "+ New patient" />
    ├── <PatientForm />         // create + edit (mode = 'create' | 'edit')
    │   └── zod schema, react-hook-form
    └── <SettingsUsers />       // admin only (gate via session.isFirstAdmin)
        ├── <UserList />
        ├── <AddUserDialog />
        ├── <ResetPinDialog />
        └── <RemoveUserDialog />
```

State machine in `App.tsx`:
```
type Route = 'wizard' | 'login' | 'patients' | 'patient-new' | 'patient-edit/:id' | 'settings-users' | 'patient-detail/:id';
```

(Phase 2 ships without deep-link URLs; hash routing is the planner's call if the brief demands it.)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PIN hashing | Custom PBKDF2 loop | `crypto.scrypt(pin, salt, 64, { N, r, p })` | scrypt is memory-hard and built-in; custom hashing always ends up wrong (no salt, no time cost, no version prefix) |
| Random IDs | `Math.random()` or `Date.now()` | `crypto.randomUUID()` | Built-in; collision-free; works in renderer and main |
| Form validation | Inline `if` checks in handlers | zod schema in `src/shared/validators.ts` | One schema used by both renderer (for UX) and main (for defense) |
| Time formatting ("2h ago") | Hand-rolled `Math.floor((Date.now() - x) / 1000)` | `date-fns/formatDistanceToNowStrict` | Edge cases (today, yesterday, future, leap years, locale) all handled |
| Soft-delete filter | Manual `WHERE deleted_at IS NULL` scattered through repos | Repository method that always filters unless `includeDeleted: true` | One place to change the rule; renderer can never accidentally see deleted patients |
| Audit-log append-only enforcement | "We just won't write an UPDATE" | SQLite trigger `RAISE(ABORT)` | Trust boundary is the DB itself; a future bug in the app can't delete rows |
| Toast UI | Custom `<div className="absolute top-4 right-4">` | `sonner` `toast.success/error` | Stack, dismiss, ARIA, animation all handled |
| Rate-limit math | Hand-rolled exponential + retry timer | One helper `nextBackoffMs(attempts)` | One place to tune `2 ** (n-1)` cap at 60s |
| Modal/dialog | Native `<dialog>` | shadcn `Dialog` (Radix) | Focus trap, ESC to close, scroll lock, ARIA all built-in |
| Date picker | `<input type="date">` everywhere | `<input type="date">` for DOB (sufficient, no dep) | Native is good enough for ISO date; no calendar UX needed |
| Gender select | Radio group or custom dropdown | shadcn `Select` (Radix) | Keyboard nav, ARIA, RTL-safe |
| Toast success/error | Custom state | `sonner` | One-liner; no provider |
| Routing | Pull in `react-router-dom` | State-based `useState<Route>('login' \| ...)` | 5–6 routes; React Router is overkill; hash router is 10 lines if deep-link is needed |

**Key insight:** The biggest non-obvious "don't hand-roll" in this domain is the rate-limit state machine. It is tempting to keep it as a JS `Map` in the renderer. Don't. The renderer is untrusted (sandboxed but still under the user's control); the rate limit must be enforced in the main process, with state persisted to the `users` row so a restart doesn't grant a fresh budget.

## Runtime State Inventory

> Phase 2 is a greenfield data layer — no existing rename/refactor. The "runtime state" question is: where will Phase 2 write data, and what happens to the first-launch state?

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None (greenfield). `app.db` does not exist on a fresh install | First launch → `dataDir()` mkdir → open `app.db` → run migration 0001 → wizard flow writes the first `users` row + `settings.clinic_name` + initial `audit_log` rows |
| Live service config | None. No service registration; no background processes | n/a |
| OS-registered state | None. App not yet shipped | n/a |
| Secrets / env vars | None. No `.lic` until Phase 8. `safeStorage` is probed at boot but not used until Phase 2 starts writing `pin_hash` (which is then encrypted via `safeStorage.encryptString` before INSERT) | n/a |
| Build artifacts | `out/main/index.js` etc. produced by `electron-vite build` will now include the new `db/`, `audit/`, `session.ts`, `ipc/patients.ts`, `ipc/users.ts`, `ipc/audit.ts` modules. The `postinstall` rebuild hook rebuilds `better-sqlite3` against Electron's ABI on every install | Re-run `npm run build` after Phase 2 completes; nothing else |

**Nothing found in category:** stated explicitly. The wizard's first-run state is the seed for everything else.

## Common Pitfalls

| Pitfall | Source | Prevention |
|---------|--------|------------|
| **PIN brute-force** — 4-digit PIN brute-forced in <30s without throttling | PITFALLS §Pitfall 5 | Exponential backoff `2 ** (n-1)` seconds, capped at 60s, after each failure; hard lockout at 10 failures (`locked_until` set far in the future or `locked = 1` flag) requiring admin PIN reset |
| **Backup zip captures partial DB** | PITFALLS §Pitfall 9 | `PRAGMA journal_mode = WAL` set in `getDb()`. Phase 7 ships the zip; Phase 2 wires `wal_checkpoint(TRUNCATE)` as a callable helper on the connection for later use, and seeds the `settings` row with `backup_warn_close_procedures = '1'` so Phase 7 can show a UI hint |
| **Native module ABI mismatch** | PITFALLS §Pitfall 4 | `postinstall` already runs `electron-rebuild`; startup log prints the binding version |
| **Audit log silently edited** | AUDIT-02 | SQLite triggers `audit_log_no_update` + `audit_log_no_delete` raising `ABORT`; no UPDATE/DELETE IPC channels |
| **Audit log metadata leaks PII** | PITFALLS §Security Mistakes | Helper accepts only `entityType` + `entityId` + structured metadata (counts, ids, outcome); never field values |
| **First user is not the admin** | D-01, D-02 | `users.is_first_admin = 1` written transactionally with the settings row in the wizard commit; UNIQUE INDEX prevents a second admin |
| **Renderer dispatches raw SQL** | ARCHITECTURE §Anti-Pattern 1 | All DB access in main; renderer uses IPC; `contextIsolation: true, nodeIntegration: false, sandbox: true` from day 1 |
| **PIN stored in plaintext** | PITFALLS §Security Mistakes | scrypt with per-user random salt; `pin_hash` encrypted at rest via `safeStorage.encryptString` before INSERT |
| **Wizard commits partially** (admin created, clinic_name missing) | new in Phase 2 | Wrap wizard commit in `db.transaction()`: BEGIN → `INSERT users (..., is_first_admin=1)` → `INSERT settings ('clinic_name', ...)` → `INSERT audit_log (auth.bootstrap.completed)` → COMMIT. If any step throws, the row is not created and the wizard re-prompts on next launch. |
| **Last-login column updated on failure** | new | Only update `last_login_at` on the success branch |
| **Locked user can still attempt via UI** | D-08 | Renderer should still allow tapping the row (D-05), but the PIN-entry submit reads the `IPC_LOCKED` code from `auth:login` and renders "Account locked — contact admin" instead of the PIN field. Back arrow still works (D-08). |
| **Rate limit resets on app restart** | new | Persistent counter on `users`; in-memory backoff is fine to reset, but the `users.failed_attempts` and `users.locked_until` columns survive |
| **scrypt parameters too aggressive** — login hangs 2s+ | new | Use `N=2^15, r=8, p=1` (~50ms on a modern CPU) — well within the doctor's tolerance, far above brute-force cost. Document the choice in a comment in `crypto.ts`. |
| **MRN collision on import** | new | `UNIQUE INDEX idx_patients_mrn ... WHERE mrn IS NOT NULL AND deleted_at IS NULL`; renderer surfaces a friendly validation error; main returns `IPC_VALIDATION { field: 'mrn' }` |
| **Soft-deleted patient shows up in autocomplete** | new | `patients.list()` always filters `deleted_at IS NULL` unless `includeDeleted: true`; Patient detail form rejects if the row is soft-deleted (returns `IPC_NOT_FOUND`) |
| **Migrations applied out of order** | new | Migrations are `0001_*.sql` numerically sorted; the manifest enforces append-only (an `id` is never reused) |
| **DB file locked because main opened two connections** | electron-sqlite §Failure handling | `getDb()` is the only entry point; never `new Database()` elsewhere |
| **`safeStorage` not available on Linux** | electron-sqlite §Failure handling | Not relevant for v1 (Windows-only). Document in `crypto.ts`; fall back to plaintext on `!isEncryptionAvailable()` with a console warning. |
| **Audit-log trigger abort rolls back a real mutation** | new | The `audit()` helper is called **inside** the same `db.transaction()` as the mutation; if the trigger aborts, the whole transaction rolls back. The trigger itself can't fire spuriously; the only way to UPDATE/DELETE `audit_log` is to issue that SQL directly. |
| **First-run `app.db` creation fails silently** | electron-sqlite §Failure handling | `getDb()` is called once in `app.whenReady()`; any error throws to the `unhandledRejection` handler. Renderer should show a red full-screen "Database error — see logs" with a "Copy log path" button. |
| **Concurrent logins from two windows** | AUTH-04 | Single `BrowserWindow`; the app does not have multi-window. Document. |

## Code Examples

### Scrypt PIN hash + verify (Node built-in)

```ts
// main/auth/crypto.ts
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string, salt: Buffer, keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number }
) => Promise<Buffer>;

// Cost params — 2024+ OWASP guidance for scrypt: N=2^17, r=8, p=1 is high.
// For a 4-digit PIN on a clinic workstation we cap N=2^15 (~50ms per hash)
// to keep login snappy; brute-force cost at 10^4 PINs * 50ms = 8 minutes per
// attempt window before exponential backoff kicks in. Adjust if measured slower.
const N = 1 << 15;
const r = 8;
const p = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024; // 64 MB

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pin.normalize('NFKC'), salt, KEYLEN, { N, r, p, maxmem: MAXMEM });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const n = parseInt(nStr, 10), r = parseInt(rStr, 10), p = parseInt(pStr, 10);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const got = await scrypt(pin.normalize('NFKC'), salt, expected.length, { N: n, r, p, maxmem: MAXMEM });
  return got.length === expected.length && timingSafeEqual(got, expected);
}
```

**Note on `pin.normalize('NFKC')`:** the wizard validates that the PIN is 4 ASCII digits; NFC normalization is a defense against copy-paste with a unicode look-alike (e.g. an Arabic-Indic digit "١٢٣٤" being pasted as if it were "1234"). The validation step should also reject any non-`[0-9]` characters.

### Patient CRUD (repository pattern)

```ts
// main/db/patients.ts
import { randomUUID } from 'node:crypto';
import { getDb } from './index';

export type Patient = {
  id: string;
  fullName: string;
  dob: string;
  gender: 'male' | 'female' | 'other' | null;
  mrn: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

const stmts = {
  insert: null as never,
  get: null as never,
  list: null as never,
  softDelete: null as never,
  restore: null as never,
  update: null as never,
};

function prepareAll() {
  if (stmts.insert) return;
  const db = getDb();
  stmts.insert = db.prepare(`
    INSERT INTO patients (id, full_name, dob, gender, mrn, phone, notes, created_at, updated_at, deleted_at)
    VALUES (@id, @fullName, @dob, @gender, @mrn, @phone, @notes, @createdAt, @updatedAt, NULL)
  `);
  stmts.get = db.prepare('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL');
  stmts.softDelete = db.prepare('UPDATE patients SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL');
  stmts.restore = db.prepare('UPDATE patients SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL');
  stmts.update = db.prepare(`
    UPDATE patients SET
      full_name = @fullName, dob = @dob, gender = @gender, mrn = @mrn,
      phone = @phone, notes = @notes, updated_at = @updatedAt
    WHERE id = @id AND deleted_at IS NULL
  `);
}

export const patientRepo = {
  create(input: Omit<Patient, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Patient {
    prepareAll();
    const row: Patient = {
      id: randomUUID(),
      ...input,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    };
    stmts.insert.run(row);
    return row;
  },

  get(id: string): Patient | null {
    prepareAll();
    const row = stmts.get.get(id) as Patient | undefined;
    return row ?? null;
  },

  list(q: {
    search?: string;
    mrn?: string;
    includeDeleted?: boolean;
    page?: number;
    pageSize?: number;
  }): { rows: Patient[]; total: number } {
    const db = getDb();
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 25));
    const offset = (page - 1) * pageSize;
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (!q.includeDeleted) where.push('deleted_at IS NULL');
    if (q.mrn) {
      where.push('mrn = @mrn');
      params.mrn = q.mrn;
    }
    if (q.search) {
      where.push('full_name LIKE @search COLLATE NOCASE');
      params.search = `%${q.search}%`;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT * FROM patients ${whereSql}
      ORDER BY full_name COLLATE NOCASE
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit: pageSize, offset }) as Patient[];
    const total = (db.prepare(
      `SELECT COUNT(*) AS c FROM patients ${whereSql}`
    ).get(params) as { c: number }).c;
    return { rows, total };
  },

  update(id: string, patch: Partial<Omit<Patient, 'id' | 'createdAt' | 'deletedAt'>>): Patient | null {
    prepareAll();
    const current = stmts.get.get(id) as Patient | undefined;
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: Date.now() };
    stmts.update.run(next);
    return next;
  },

  softDelete(id: string): boolean {
    prepareAll();
    return stmts.softDelete.run(Date.now(), id).changes > 0;
  },

  restore(id: string): boolean {
    prepareAll();
    return stmts.restore.run(id).changes > 0;
  },
};
```

### Audit trigger (append-only enforcement)

```sql
-- in 0001_init.sql
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
```

Verified pattern: SQLite's `RAISE(ABORT, msg)` inside a `BEFORE UPDATE/DELETE` trigger aborts the entire transaction with the message. There is no `INSTEAD OF` or soft-fail escape. The audit log is a write-only table by schema.

### Zod schema (shared by renderer + main)

```ts
// src/shared/validators.ts
import { z } from 'zod';

export const wizardInput = z.object({
  fullName: z.string().min(2).max(100),
  clinicName: z.string().min(1).max(100),
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
});
export type WizardInput = z.infer<typeof wizardInput>;

export const patientInput = z.object({
  fullName: z.string().min(1).max(100),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'DOB must be ISO yyyy-mm-dd'),
  gender: z.enum(['male', 'female', 'other']).nullable(),
  mrn: z.string().max(50).nullable(),
  phone: z.string().max(30).nullable(),
  notes: z.string().max(2000).nullable(),
});
export type PatientInput = z.infer<typeof patientInput>;
```

Renderer:
```tsx
// Wizard.tsx — fragment
const { register, handleSubmit, formState: { errors } } = useForm<WizardInput>({
  resolver: zodResolver(wizardInput),
});
```

Main (defensive re-validate):
```ts
ipcMain.handle(IPC.AUTH_BOOTSTRAP, async (_e, input) => {
  const parsed = wizardInput.parse(input);   // throws ZodError → IpcError
  // ...
});
```

## Validation Architecture

> `workflow.nyquist_validation` is enabled by default in `.planning/config.json` (per STATE.md). This section is REQUIRED.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.x (already installed) [VERIFIED: package.json devDependency] |
| Config file | `vitest.config.ts` (Phase 2 creates it; Phase 1 may have a stub) |
| Quick run command | `npm run test:unit -- --run --reporter=basic` (Phase 2 adds this script) |
| Full suite command | `npm test` (also runs e2e/smoke if present) |
| Renderer test env | happy-dom 20.x (already installed) [VERIFIED: package.json devDependency] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|---------------|
| AUTH-01 | Login with correct PIN succeeds; wrong PIN rejects | unit (main) | `vitest run tests/main/auth/login.test.ts` | ❌ Wave 0 |
| AUTH-01 | User list shows all non-deleted users | unit (main) | `vitest run tests/main/auth/users-list.test.ts` | ❌ Wave 0 |
| AUTH-02 | 5 failures → 1s, 2s, 4s, 8s, 16s backoff; 10 failures → locked | unit (main) | `vitest run tests/main/auth/rate-limit.test.ts` | ❌ Wave 0 |
| AUTH-02 | Locked user gets `IPC_LOCKED` even with correct PIN | unit (main) | (same file as above) | ❌ Wave 0 |
| AUTH-03 | Every login attempt (success + failure) writes an `audit_log` row | unit (main) | `vitest run tests/main/audit/log-on-login.test.ts` | ❌ Wave 0 |
| AUTH-04 | `session.currentUserId` is `null` after `app.whenReady()`; persists nothing across `before-quit` | unit (main) | `vitest run tests/main/session.test.ts` | ❌ Wave 0 |
| PAT-01 | Create patient with all 6 fields persists; missing required field rejected | unit (main) | `vitest run tests/main/patients/create.test.ts` | ❌ Wave 0 |
| PAT-02 | Search by name substring (case-insensitive) returns matches; MRN exact match returns single row | unit (main) | `vitest run tests/main/patients/search.test.ts` | ❌ Wave 0 |
| PAT-03 | Get / update / soft-delete a patient; soft-deleted patient invisible in default list | unit (main) | `vitest run tests/main/patients/crud.test.ts` | ❌ Wave 0 |
| PAT-04 | Soft-delete sets `deleted_at`; no hard delete possible; restore is admin-only (covered by IPC handler) | unit (main) | (same file as above) | ❌ Wave 0 |
| AUDIT-01 | Every mutation (create patient, soft-delete, etc.) writes an `audit_log` row in the same transaction | unit (main) | `vitest run tests/main/audit/every-mutation.test.ts` | ❌ Wave 0 |
| AUDIT-02 | `UPDATE audit_log SET ...` raises ABORT; `DELETE FROM audit_log WHERE ...` raises ABORT | unit (main) | `vitest run tests/main/audit/append-only.test.ts` | ❌ Wave 0 |
| D-01 | Wizard commits admin user + clinic_name atomically | unit (main) | `vitest run tests/main/auth/wizard.test.ts` | ❌ Wave 0 |
| D-02 | Only the first user has `is_first_admin = 1`; second user via `users:create` has `0` | unit (main) | (same file as above) | ❌ Wave 0 |
| Login page | Renders user list; tapping a row shows PIN entry; back arrow returns; "Forgot admin PIN?" link present | component | `vitest run tests/renderer/pages/login.test.tsx` | ❌ Wave 0 |
| Patient list | Renders rows; search input filters; "Show deleted" toggle reveals soft-deleted with badge; "+ New patient" opens form | component | `vitest run tests/renderer/pages/patients.test.tsx` | ❌ Wave 0 |
| Settings → Users (admin) | Lists users; "Add user" opens dialog; "Reset PIN" requires admin; "Remove" soft-confirms | component | `vitest run tests/renderer/pages/settings-users.test.tsx` | ❌ Wave 0 |
| Smoke | Cold start with empty DB → wizard → wizard commits → app restarts → login user list shows the admin → enter PIN → patient list | e2e (manual) | `node scripts/run-full-smoke.cjs` (Phase 1's existing script extended) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test:unit -- --run` — the quick main-process + renderer unit suite, <30s.
- **Per wave merge:** Full suite including the smoke cold-start script.
- **Phase gate:** Full suite green before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `vitest.config.ts` — Vitest config with `tests/main/**/*.test.ts` (node env) and `tests/renderer/**/*.test.{ts,tsx}` (happy-dom env)
- [ ] `tests/main/setup.ts` — temp `dataDir()` + auto-cleanup before/after each test
- [ ] `tests/main/auth/login.test.ts`
- [ ] `tests/main/auth/rate-limit.test.ts`
- [ ] `tests/main/auth/users-list.test.ts`
- [ ] `tests/main/auth/wizard.test.ts`
- [ ] `tests/main/session.test.ts`
- [ ] `tests/main/patients/create.test.ts`
- [ ] `tests/main/patients/search.test.ts`
- [ ] `tests/main/patients/crud.test.ts`
- [ ] `tests/main/audit/log-on-login.test.ts`
- [ ] `tests/main/audit/every-mutation.test.ts`
- [ ] `tests/main/audit/append-only.test.ts`
- [ ] `tests/renderer/setup.ts` — happy-dom + `@testing-library/react` cleanup
- [ ] `tests/renderer/pages/login.test.tsx`
- [ ] `tests/renderer/pages/patients.test.tsx`
- [ ] `tests/renderer/pages/settings-users.test.tsx`
- [ ] Update `scripts/run-full-smoke.cjs` to also exercise the cold-start-with-empty-DB → wizard → restart → login flow

## Security Domain

> `security_enforcement` is not explicitly disabled in `.planning/config.json` → this section is required.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V1 Architecture | yes | Three-process model; renderer = untrusted; main = trust boundary |
| V2 Authentication | yes (AUTH-01..04) | scrypt PIN with per-user salt; exponential backoff + lockout; append-only audit log |
| V3 Session Management | yes (AUTH-04) | No persistent session; main-process in-memory `session.currentUserId`; `null` on boot |
| V4 Access Control | partial | Admin-only gates (Settings → Users, restore patient, reset PIN) are enforced in the main IPC handler by reading `session.currentUserId` and checking `users.is_first_admin`. D-02 explicitly defers per-action RBAC to v2. |
| V5 Input Validation | yes | zod schemas in `src/shared/validators.ts` re-validated in main before every write |
| V6 Cryptography | yes | scrypt (Node built-in); `safeStorage.encryptString` for `pin_hash` at rest; `timingSafeEqual` for PIN compare; no hand-rolled crypto |
| V7 Error Handling | yes | `IpcError` tagged union; renderer `switch (e.code)`; never leak stack traces to renderer |
| V8 Data Protection | partial | Patient notes not encrypted at rest in v1 (acceptable per PITFALLS §Security Mistakes: "Acceptable risk for v1 if `app.db` is under `userData` with OS permissions; encryption-at-rest is a v2 hardening") |
| V9 Communications | n/a | Offline-only; no network at runtime (except license activation, which is local file load) |
| V10 Malicious Code | yes | `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true` from day 1; no `eval` / `Function` in renderer; CSP not yet set in Phase 1 (deferred to Phase 7) |
| V11 Business Logic | yes | Rate limit math + lockout threshold are the core business logic for AUTH-02; see Algorithm above |
| V12 Files and Resources | yes | `dataDir()` under `app.getPath('userData')`; no arbitrary file reads from IPC; no `file://` exposure except via `shell.openPath` (PITFALLS §Security Mistakes) |
| V13 API and Web Service | n/a | No web services |
| V14 Configuration | yes | Settings are key/value with JSON values; license settings (Phase 8) will be in a separate `license` module, not in `settings` (PITFALLS §Technical Debt) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Brute-force PIN on login screen | Spoofing | Exponential backoff + 10-failure lockout (PITFALLS §Pitfall 5) |
| Tampering with `audit_log` to hide activity | Tampering | SQLite `BEFORE UPDATE/DELETE` triggers raising `ABORT`; no UPDATE/DELETE IPC channel |
| Renderer XSS escalating to RCE | Elevation of Privilege | `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`; no `eval`; shadcn primitives are sanitized |
| `pin_hash` stolen from disk → offline crack | Information Disclosure | scrypt with `N=2^15, r=8, p=1` (50ms per guess × 4-digit space = 8 minutes per attempt); plus `safeStorage.encryptString` so the hash is also DPAPI-encrypted at rest |
| Path traversal in patient file paths (Phase 4) | Tampering | (Phase 4) — Phase 2 only stores scalar patient fields, no paths |
| First-launch admin self-exclusion | Denial of Service | Wizard re-prompts on next launch if commit failed; if it committed without `is_first_admin = 1` the user can sign in but the admin reset path is broken (D-04 vendor recovery file catches this) |
| Concurrent admin reset + lockout race | Denial of Service | Admin reset is a single `UPDATE users SET failed_attempts = 0, locked_until = NULL`; no TOCTOU because the SQL is atomic. The renderer's "Reset PIN" button is disabled while another tab is in flight. |
| `audit_log` JSON `metadata` carries field values (PII leak) | Information Disclosure | Helper API only accepts `entityType` + `entityId` + structured counts; no field-level data. Code review rule. |

## Open Questions

1. **Lockout semantics: timed vs indefinite?** — PITFALLS §Pitfall 5 says "admin PIN reset required to unlock" (indefinite), but the spec doesn't preclude a long timed lockout (e.g. 24h) that auto-clears. **Recommendation:** lockout is `locked_until` set to `NULL` (indefinite) on the 10th failure; only admin `users:reset-pin` clears it. This matches D-04's vendor-recovery fallback.
2. **`metadata` JSON shape per action** — `auth.login.failed` needs `{ attempts: number }`; `patients.create` needs nothing (entityId is the new id). **Recommendation:** keep the helper permissive (`Record<string, unknown>`) but lint each call site.
3. **PIN: 4 digits or 4–6?** — D-01 says "4 digits". **Recommendation:** lock to 4 digits in v1, schema validated by zod.
4. **Avatar color determinism** — hash of `user.id` modulo a 12-color palette is fine. **Recommendation:** planner picks the palette.
5. **`audit:list` IPC: pagination + filtering** — Phase 2 ships it (read-only filter) but the renderer doesn't render the page yet (Phase 7). **Recommendation:** ship the IPC, leave the page as a `// TODO: Phase 7` placeholder.
6. **Backup warning UX in Phase 2** — PITFALLS §Pitfall 9 says "Document in the backup UI: 'Close any open procedure before backing up.'" Phase 2 doesn't ship the backup UI but the warning text + the `wal_checkpoint(TRUNCATE)` helper should land in `src/main/backup/db-snapshot.ts` so Phase 7 doesn't have to retrofit. **Recommendation:** ship the helper as an unused export.
7. **MRN uniqueness per workspace vs global** — the workspace IS a single clinic (one workstation = one clinic per the architecture). The unique index in the schema above is per-database (= per workstation = per clinic). No need for a `clinic_id` column. **Open for user confirmation** — if multi-clinic data is ever imported into one DB, this assumption breaks.

## Assumptions Log

> All claims tagged `[ASSUMED]` in this research. The planner and discuss-phase use this to identify decisions that need user confirmation before execution.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Node 20 ships with `crypto.scrypt` available and no flag is required | Standard Stack | Low — scrypt is in Node since 10; Electron 32 ships Node 20 |
| A2 | `safeStorage.encryptString(plain).toString('base64')` round-trips losslessly | Standard Stack, Security Domain | Low — verified by Electron docs, but Phase 2 should add a self-test in `tests/main/security/safe-storage.test.ts` |
| A3 | `date-fns` 3.x or 4.x works in the renderer (Vite-bundled) | Standard Stack | Low — date-fns is one of the most-used time libs; Vite tree-shakes it well |
| A4 | "Lockout until admin reset" is the intended semantics for AUTH-02 (not a timed lockout) | Open Questions #1, Common Pitfalls | Medium — affects the UX in D-08 (locked user sees a different PIN screen) |
| A5 | The 4-digit PIN is numeric ASCII only; no Arabic-Indic digits accepted at the wizard | Code Examples (crypto.ts NFKC comment) | Low — zod regex `^\d{4}$` enforces this; but the wizard copy should make it clear |
| A6 | Wizard copy is English-only in Phase 2; i18n ships Phase 7 | Deferred Ideas | None — explicitly deferred |

**If this table is empty:** not empty — A4 and A5 are the only items that meaningfully affect the build. The rest are either low-risk or already locked.

## Environment Availability

> `app.db` is the new external dependency (better-sqlite3 binary). Other deps (ffmpeg, license, capture device) are not Phase 2.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| better-sqlite3 native binding | All DB access | ✓ (already pinned + rebuilt via `electron-rebuild` in postinstall) | 11.10.0 | Re-run `npm run rebuild:native` |
| `app.getPath('userData')` | DB + media dir resolution | ✓ (Phase 1) | Electron 32 | None — hard requirement |
| `safeStorage.isEncryptionAvailable()` | `pin_hash` encryption at rest | ✓ on Windows (DPAPI); ⚠ on macOS / Linux (Keychain / libsecret may need password) | Electron 32 | Documented fallback to plaintext hash with console warning (acceptable for v1 Windows-only) |
| ffmpeg-static | n/a (Phase 4) | ✓ (already installed) | ^5 | n/a |
| Node 20 (via Electron 32) | `crypto.scrypt` | ✓ | 20.x | None |
| `vitest` | Test runner | ✓ (already installed) | 2.1.9 | None |
| `happy-dom` | Renderer tests | ✓ (already installed) | 20.x | jsdom (also installed) |

**Missing dependencies with no fallback:** none. All Phase 2 dependencies are present or installable in the standard `npm install` step.

**Missing dependencies with fallback:** safeStorage on non-Windows is a known gap but v1 ships Windows-only.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Storing PIN as MD5/SHA-1 hash | scrypt with per-user salt | ~2017 (OWASP guidance) | Mandatory for any password field; matches CONTEXT §Discretion |
| Plaintext audit log | Append-only `audit_log` with SQLite trigger enforcement | Always in this stack | No migration path to UPDATE later — that's the point |
| Optimistic UI for clinical data | Await IPC round-trip | Established as anti-pattern in this codebase (ARCHITECTURE §Anti-Pattern 4) | Phase 2 follows it; no spinner-only flows that lie |
| `node-sqlite3` (callback API) | `better-sqlite3` (sync API) | ~2020 | Already locked in STACK.md |
| WAL mode off (default) | `PRAGMA journal_mode = WAL` on every open | SQLite docs since 3.7 | Required by PITFALLS §Pitfall 9 |
| FTS5 via separate virtual table for name search | `LIKE '%q%' COLLATE NOCASE` on indexed column | n/a | FTS5 added in SQLite 3.9; we use LIKE for v1, FTS5 in v2 (SRCH-04) |
| shadcn `toast` (Radix Toast) | `sonner` | shadcn-ui docs 2024+ | Both supported; sonner is simpler for greenfield |
| React Router 6 | State-based routing in `<App>` | n/a | Overkill for 5–6 routes |
| Native `<dialog>` | shadcn `Dialog` (Radix) | Radix stability | Phase 2 uses shadcn for focus trap + ARIA |

**Deprecated/outdated:**
- "Pre-2024 OWASP PIN guidance" — use a 4–6 digit PIN with throttling. Already in CONTEXT.
- "argon2id is the only acceptable primitive" — true for arbitrary-length passwords; for a 4-digit PIN, scrypt with appropriate cost is equivalent and avoids a native dep.

## Sources

### Primary (HIGH confidence)
- **electron-sqlite SKILL.md** (project skill, `C:\Users\Hussien Essam\Desktop\WORK FREELANCE\colonoscopist\.opencode\skills\electron-sqlite\SKILL.md`) — DB paths, `getDb()` singleton, migration runner pattern, repositories, `safeStorage` wrap, backup approach
- **electron-vite SKILL.md** (project skill, `C:\Users\Hussien Essam\Desktop\WORK FREELANCE\colonoscopist\.opencode\skills\electron-vite\SKILL.md`) — three-process model, typed IPC contract pattern, security baseline
- **`02-CONTEXT.md`** — D-01..D-08 + agent discretion items; verbatim copied to User Constraints
- **`package.json`** — verified pinned versions (better-sqlite3 11.10.0, electron 32.3.3, electron-vite 2.3.0, vitest 2.1.9, happy-dom 20.11.1, @types/better-sqlite3 7.6.11)
- **`.planning/research/ARCHITECTURE.md`** — three-process model, IPC contract pattern, project structure
- **`.planning/research/PITFALLS.md`** — §Pitfall 5 (PIN brute-force), §Pitfall 9 (backup partial DB), §Performance Traps (audit log), §Security Mistakes
- **`.planning/research/STACK.md`** — locked versions

### Secondary (MEDIUM confidence)
- **Context7 docs for better-sqlite3** — sync API, prepared statements, WAL mode, transaction API
- **Node 20 `crypto` docs** — `crypto.scrypt(password, salt, keylen, options, callback)`, `timingSafeEqual`
- **SQLite docs** — `RAISE(ABORT, msg)` in triggers, `PRAGMA journal_mode = WAL`, `PRAGMA wal_checkpoint(TRUNCATE)`
- **shadcn/ui component recipes** — `npx shadcn@latest add card dialog dropdown-menu select avatar checkbox tooltip form` to install matching Radix primitives

### Tertiary (LOW confidence)
- **`date-fns` exact current version** — unverified at exact version (npm view throttled); planner should run `npm view date-fns version` before installing
- **`@radix-ui/react-avatar`, `dialog`, `dropdown-menu`, `select`, `checkbox`, `tooltip` exact current versions** — unverified at exact version; shadcn CLI's `npx shadcn@latest add` resolves them and is the recommended path

## Metadata

**Confidence breakdown:**
- **Standard stack:** HIGH — versions confirmed against npm registry or already in `package.json`; rationale drawn from project skills
- **Architecture:** HIGH — follows the project-locked three-process model + IPC contract pattern + repository pattern; all decisions traceable to existing research files
- **Pitfalls:** HIGH — all sourced from PITFALLS.md (already HIGH confidence in the project) + new items specific to Phase 2 (wizard commit atomicity, lockout semantics, audit trigger coverage)
- **Schema:** HIGH — `users` + `patients` + `audit_log` + `settings` is the minimal set required by PAT-01..04 + AUDIT-01..02 + AUTH-01..04 + SET-04, with no speculative columns
- **Rate-limit algorithm:** HIGH — PITFALLS §Pitfall 5 prescribes the parameters; the in-memory + persistent split is standard
- **Pin hashing (scrypt):** HIGH — Node built-in; per-user salt; matches CONTEXT §Discretion default

**Research date:** 2026-08-01
**Valid until:** 2026-09-01 (30 days — stack is stable; no new Electron major expected in this window)
