# Phase 2: Database + Patient CRUD + Audit + Auth - Context

**Gathered:** 2026-08-01
**Status:** Ready for planning

## Phase Boundary

Ship the data layer (SQLite + migrations + WAL), patient CRUD + search, audit log infrastructure, and PIN-based auth with rate limiting + audit integration. The static Login placeholder from Phase 1 becomes real; `users`, `patients`, `audit_log`, `settings` tables are created so later phases layer in procedures/screenshots/reports without migration conflicts. Daily-use features (recording, reports, search, backup/restore, i18n, licensing) ship in later phases.

## Implementation Decisions

### First-time setup & first admin

- **D-01:** First launch runs a multi-field wizard: full name + clinic name + PIN (4 digits) + confirm PIN. The first user becomes the admin. Wizard auto-submits on valid PIN + confirm match; on completion the user lands on the Patient List — **Reversibility:** **costly** — the first user row in `users` carries the admin identity (is_first_admin flag, or always the lowest id); the wizard's multi-field shape is a UX one-shot, but the data it writes is the seed for `users` + `settings` and the schema decision is one-way.
- **D-02:** Single admin model — no `role` column in `users` for v1. First user = admin; any logged-in user can do patient/procedure/report; no per-action permission checks. SET-04 (admin user management, e.g. add/remove users, PIN reset) is admin-only because the wizard writes the first admin and only admin can add others — **Reversibility:** **one-way** — adding a `roles` column later requires a migration plus per-action permission checks throughout the IPC boundary. v1 deliberately keeps the model flat.
- **D-03:** Admin adds further users via Settings → Users in Phase 2 (matches REQUIREMENTS SET-04 phase mapping; Phase 1 only shipped a stub UI). Add/remove users + admin PIN reset for non-admin users all live in Settings → Users — **Reversibility:** **reversible** — UI surface; can be retired or moved to a later phase if it slips.
- **D-04:** Forgotten admin PIN is recovered via a vendor-signed recovery file (offline, Phase 8-style flow). Phase 2 ships the recovery UX surface: a "Forgot admin PIN?" affordance from the login screen that emails the machine fingerprint to the vendor and accepts a `.recover` file once returned. The actual `.recover` file flow (signing, verification, fingerprint hashing) ships in Phase 8 (Licensing) per the architecture — **Reversibility:** **costly** — once a user is locked out, the recovery path is the only escape; the UX surface designed in Phase 2 must stay compatible with whatever Phase 8 implements (shared fingerprint + Ed25519 verify path).

### Login user-picker UX

- **D-05:** Two-step login flow: user list (with avatar + name + last-login) → tap row → PIN entry. Always starts on the user list at boot (AUTH-04: no persistent session across reboot) — **Reversibility:** **reversible** — UI flow only.
- **D-06:** Each user list row shows: avatar placeholder (initials in a colored circle), full name, "last login <relative>" (e.g. "last seen 2h ago", "never"). No avatar upload needed in v1 — **Reversibility:** **reversible**.
- **D-07:** Wrong PIN → inline error "Incorrect PIN" (red, below the input), PIN field clears, focus returns to the PIN input, Enter button is briefly disabled until the next input. The exponential backoff / 5-attempt counter rules (AUTH-02) are still enforced in the backend; this is the visible UX when the count is below the threshold — **Reversibility:** **reversible**.
- **D-08:** PIN entry screen has a top-left back arrow that returns to the user list and clears the PIN field. Always available — **Reversibility:** **reversible**.

### the agent's Discretion

- **PIN hashing primitive** — scrypt (Node built-in `crypto.scrypt`) is the default; argon2id is acceptable if a native module is accepted. Per-user random salt. Never log or display the hash. (PITFALLS §Pitfall 5 already prescribes this.)
- **Audit log write semantics** — synchronous-asserted (`audit_log` insert happens in the same transaction as the underlying mutation, or in a follow-up synchronous insert that throws to the caller on failure). Single-row inserts are not wrapped in transactions; multi-row writes (e.g. procedure finalize) wrap a transaction including the audit row. (PITFALLS §Performance Traps table.)
- **Schema design** for `users`, `patients`, `audit_log`, `settings` — the planner can pick sensible defaults consistent with `users.is_first_admin` (or first-row-implies-admin), `patients.deleted_at` for soft-delete, `audit_log.metadata` as JSON text, `settings` as key/value. Reverse-engineered SCHEMA in the RESEARCH.md / PLAN.md.
- **Patient search detail** — name substring via `LIKE '%q%' COLLATE NOCASE` on indexed `name`; MRN exact match. Sort by name (alphabetical) by default; pagination size 25; page-size dropdown included but defaults to 25. (Not discussed in detail; carrying the SPEC's behavior forward.)
- **Patient soft-delete UX** — soft-deleted patients hidden by default; a "Show deleted" toggle in the Patient List page header reveals them with a "Deleted" badge; restore action available to admin (lives in Settings → Users or Patient List action menu). Final decision agent-discretion.
- **Last-login capture** — write to `users.last_login_at` on successful PIN entry; show "never" for first login. Relative time formatting in the renderer (e.g. "2h ago", "yesterday").
- **Avatar placeholder rendering** — initials drawn from the user's full name (first letters of first + last word) in a colored circle; color picked deterministically from the user id. (No avatar upload in v1.)
- **Wizard field order and copy** — copy and field placement are at the agent's discretion; the substance (name + clinic name + PIN + confirm) is locked.
- **Back-out / idle clear timing** — PIN entry clears after 10s of inactivity; back arrow always available regardless of timer.

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §Phase 2 — Goal, success criteria, pitfalls addressed, notes
- `.planning/REQUIREMENTS.md` §AUTH-01, §AUTH-02, §AUTH-03, §AUTH-04, §PAT-01, §PAT-02, §PAT-03, §PAT-04, §AUDIT-01, §AUDIT-02, §SET-04 (Traceability row)
- `.planning/PROJECT.md` §Constraints, §Key Decisions (stack + security baseline)
- `.planning/STATE.md` §Current Focus, §Phases, §Open Questions

### Technical research (stack, pitfalls, architecture)
- `.planning/research/STACK.md` — better-sqlite3 11 + hand-rolled migrations + WAL (locked)
- `.planning/research/PITFALLS.md` §Pitfall 5 (PIN brute-force — Phase 2), §Pitfall 9 (backup captures partial DB — `PRAGMA wal_checkpoint(TRUNCATE)` wired from day 1)
- `.planning/research/ARCHITECTURE.md` — Three-process model, IPC contract pattern, project structure, audit-log-on-every-mutation pattern, paths relative to `userData`
- `.planning/research/SUMMARY.md` §Phase 2 implications (migrations + CRUD + search + Patient List page)

### Phase 1 context (carry forward)
- `.planning/phases/01-scaffold/01-CONTEXT.md` — D-01..D-08 (app identity, window defaults, login placeholder feel), Canonical refs §Skills
- `.planning/phases/01-scaffold/01-DISCUSSION-LOG.md` — Discussion history (login placeholder UX baseline)

### Skills & procedures (how to ship Phase 2)
- `.opencode/skills/electron-sqlite/SKILL.md` — better-sqlite3 patterns, schema migration, encryption at rest via `safeStorage`, backup/restore flows
- `.opencode/skills/electron-vite/SKILL.md` — Three-process model, IPC contract pattern, security baseline (re-confirmed)

### Vendor recovery file (deferred to Phase 8, but Phase 2 UX surface mentions it)
- ROADMAP.md §Phase 8 — Ed25519-signed `.lic` flow + fingerprint hashing

## Existing Code Insights

### Reusable Assets
- `src/main/paths.ts:dataDir()` — already wraps `userData/data`; extend with `dbPath()` returning `path.join(dataDir(), 'app.db')`. Phase 2 also adds `mediaDir()` ahead of Phase 4 (still a no-op folder create for now).
- `src/shared/ipc-contract.ts` — `IpcContract` interface and `IPC` channel-name constants. Phase 2 extends `IpcContract` with `auth: { login, logout, listUsers, … }`, `patients: { list, get, create, update, softDelete }`, `users: { create, update, remove, resetPin }`, `audit: { list }` (Phase 2 read-only filter; full UI in Phase 7). Never invents a new bridge.
- `src/shared/errors.ts:IpcError` — tagged union shape; Phase 2 expands with `IPC_AUTH_FAILED`, `IPC_RATE_LIMITED`, `IPC_LOCKED`, `IPC_VALIDATION`, `IPC_NOT_FOUND` variants. Renderer can `switch (e.code)` reliably.
- `src/main/startup-log.ts` — already logs `better-sqlite3` version + `safeStorage` availability at boot; Phase 2 extends with `db-opened` + `migrations-applied` events.
- `src/main/ipc/auth.ts` — placeholder `registerAuthIpc()`; Phase 2 replaces with the real handler.
- `src/preload/index.ts` — exposes `window.api` via contextBridge; Phase 2 extends the `api` object.
- `src/renderer/src/pages/Login.tsx` — Phase 1 placeholder; Phase 2 replaces with the two-step login flow + multi-field wizard.
- `src/renderer/src/components/ui/{button,input,label}.tsx` — shadcn primitives; Phase 2 likely adds `Card`, `Dialog`, `Toast` (or `sonner`), `Avatar`, `Form` (via react-hook-form + zod) for the wizard + patient list.
- `src/renderer/src/App.tsx` — single-route shell; Phase 2 upgrades to a router (state-based or react-router) with `/login`, `/wizard`, `/dashboard`, `/patients`, `/patients/:id`, `/settings/users`.

### Established Patterns
- **Typed IPC contract via contextBridge** — every renderer-callable method is defined once in `src/shared/ipc-contract.ts`. Main side registers `ipcMain.handle`; preload imports the types and exposes the matching object. Phase 2 extends, never invents.
- **One-way renderer → main for mutations** — no optimistic UI for clinical data; renderer awaits the IPC round-trip and shows inline spinner / error. (ARCHITECTURE §Anti-pattern 4.)
- **Paths relative to `userData`** — DB path is absolute at runtime; `app.db` lives inside `dataDir()`. Future procedure screenshots / videos also store paths relative to `userData` (Phase 4+).
- **wal_checkpoint(TRUNCATE) wired from day 1** — connection setup runs `PRAGMA journal_mode = WAL`; the backup/restore module (Phase 7) calls `wal_checkpoint(TRUNCATE)` before zipping. (PITFALLS §Pitfall 9.)
- **No `any` in IPC contracts** — TS strict mode continues; per-method arg + return types on `IpcContract`.

### Integration Points
- `src/main/index.ts` — Phase 2 wires `initDatabase()` → `runMigrations()` → `registerAuthIpc()` → `registerPatientsIpc()` → `registerUsersIpc()` → `registerAuditIpc()` before window creation. Order matters: DB must be open before any IPC handler can read.
- `src/preload/index.ts` — `api` object grows; `contextBridge.exposeInMainWorld('api', api)` stays the single exposure point.
- `src/renderer/src/App.tsx` — routes add Wizard, Dashboard, Patient List, Patient Detail, Settings → Users.
- `src/main/paths.ts` — `dbPath()` joins onto existing `dataDir()`; no new dependency injection.
- `src/shared/ipc-contract.ts` — `IPC` constant object grows; `IpcContract` interface grows; no breaking changes to existing `auth:status` channel.
- `src/main/startup-log.ts` — logs `db-opened` + `migrations-applied` events so the boot log shows the schema version.

## Specific Ideas

- **Multi-field wizard** — name + clinic name + PIN + confirm. (Substance locked in D-01; full copy and field order at agent discretion.)
- **Two-step login** — user list → PIN entry. Both steps always start fresh on app boot (persistence forbidden per AUTH-04).
- **Avatar placeholder** — initials in a colored circle, no upload in v1.
- **Settings → Users** — admin adds/removes users, resets PIN for non-admin users. Admin's own PIN reset is the vendor recovery file path (D-04).
- **Vendor recovery file** — placeholder UX in Phase 2; the actual signing/verification lives in Phase 8 (Licensing). The recovery file uses the same fingerprint + Ed25519 verify path as the license file (architecture reuse).

## Deferred Ideas

- **Lockout recovery flow detail** — not deep-dived in this discussion. Defaults: (a) admin resets another user's PIN via Settings → Users; (b) admin's own PIN is recovered via vendor recovery file (D-04). UX for the lockout state (toast on the user list? inline error on the PIN entry screen?) is agent-discretion; non-functional behavior is locked by AUTH-02.
- **Patient identity fields detail** — not deep-dived. Defaults to REQUIREMENTS PAT-01: full name, DOB (date picker; not age), gender (Male/Female/Other enum, optional), MRN (free text, unique per clinic), phone (free text), notes (free text, optional). Adjustable during planning.
- **Search UX detail** — not deep-dived. Defaults: name substring (case-insensitive), MRN exact match, page size 25, alphabetical sort by name, empty-state copy "No patients found".
- **Doctor profile (PROF-01, PROF-02)** — explicitly out of Phase 2 scope; ships in Phase 6. Phase 2 stores `users.full_name` (used for the wizard and login list) but defers the full clinic-info + signature + logo editor.
- **Storage path change UI (SET-03)** — Phase 2 uses `<userData>/data`; the UI to change the storage path lives in Phase 7 (Settings) or later. Audit log infrastructure is in place from Phase 2 either way.
- **SET-05/SET-06 (backup/restore)** — UI ships in Phase 7; `wal_checkpoint(TRUNCATE)` and the DB backup primitives are wired in Phase 2 so the Phase 7 UI doesn't have to retrofit.
- **I18n (I18N-01/02/03)** — Phase 2 strings are English-only; Phase 7 ships Arabic + RTL. Phase 2 still uses shadcn primitives consistently so the Phase 7 RTL pass is incremental, not a rewrite.

---

*Phase: 2-database-patient-audit-auth*
*Context gathered: 2026-08-01*
