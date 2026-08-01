---
status: testing
phase: 02-database-patient-audit-auth
source:
  - 02-01-SUMMARY.md
  - 02-02-SUMMARY.md
  - 02-03-SUMMARY.md
started: 2026-08-01
updated: 2026-08-01
---

## Current Test

number: 13
name: Backend Lockout After 10 Wrong PINs
expected: |
  The 10th consecutive wrong PIN locks the account. A subsequent
  attempt — even with the correct PIN — shows "Account locked —
  contact admin". The locked row stays in the user list. Restarting
  the app preserves the lock (`is_locked=1` + sentinel `locked_until`
  in the DB).
awaiting: user response

## Tests

### 1. Cold Start Smoke
expected: |
  Kill any running app. Clear the userData directory (or use a fresh
  install). Run `npm run dev`. The Electron window opens, the DB
  opens at `<userData>/data/app.db` with WAL mode, all migrations
  run once, and the wizard screen appears because no users exist.
result: pass

### 2. First-launch Wizard
expected: |
  Four fields visible: full name, clinic name, PIN (4 digits), confirm
  PIN. PIN field is `type=password`. Submitting valid values
  creates the admin and lands on the Patient List.
result: pass

### 3. Patient List Empty State
expected: |
  After login, the Patient List shows "No patients yet — click + New
  patient to add the first one." A "+ New patient" button is visible.
result: pass

### 4. Create Patient
expected: |
  "+ New patient" → form with full name, DOB (date picker), gender
  (select), MRN, phone, notes. Submitting valid data persists the
  row and the list now shows it.
result: pass

### 5. Search by Name Substring
expected: |
  Typing into the search input filters the list case-insensitively
  by name substring. A 250ms debounce applies.
result: pass

### 6. Search by MRN Exact
expected: |
  Typing an MRN into the MRN filter returns only the row whose
  MRN matches exactly.
result: pass

### 7. Edit Patient
expected: |
  Row menu → Edit → form pre-fills. Changing a field (e.g. phone)
  and saving updates the row in the list and the underlying DB.
result: pass

### 8. Soft-Delete Patient
expected: |
  Row menu → Delete → confirm dialog → "Delete patient?". Confirming
  removes the row from the default list. The row still exists in the
  DB with `deleted_at` populated.
result: pass

### 9. Show Deleted Toggle
expected: |
  Toggling "Show deleted" reveals the soft-deleted row with a "Deleted"
  badge. The row's Restore action appears in the row menu.
result: pass

### 10. Restore Patient (Admin)
expected: |
  On a soft-deleted row, Restore (admin only) brings the row back to
  the default list with `deleted_at` cleared.
result: pass

### 11. Two-Step Login (Restart)
expected: |
  Quit the app, relaunch. The user list shows the admin with avatar
  (colored by userId hash), full name, and "last seen X ago".
  Tapping the row transitions to PIN entry. Correct PIN lands on
  the Patient List.
result: pass

### 12. Wrong PIN
expected: |
  Incorrect PIN renders the inline red error "Incorrect PIN" below
  the input, clears the PIN field, and briefly disables the Enter
  button. The back arrow still works and returns to the user list.
result: pass

### 13. Backend Lockout After 10 Wrong PINs
expected: |
  The 10th consecutive wrong PIN locks the account. A subsequent
  attempt — even with the correct PIN — shows "Account locked —
  contact admin". The locked row stays in the user list. Restarting
  the app preserves the lock (`is_locked=1` + sentinel `locked_until`
  in the DB).
result: issue
reported: |
  Lockout works (backoff + 10th-failure lockout + restart preserve
  are all correct). But the UX is subpar:
  (1) "Try again in N seconds" is static — should be a live countdown.
  (2) Enter button is NOT disabled during the backoff.
  (3) When the account is locked, no visual badge indicates the lock
      state — only the inline text "Account locked — contact admin".
  (4) Enter button is still callable on a locked account (will just
      return IPC_LOCKED again, but should be disabled).
severity: minor

### 2. First-launch Wizard
expected: |
  Four fields visible: full name, clinic name, PIN (4 digits), confirm
  PIN. PIN field is `type=password`. Submitting valid values
  creates the admin and lands on the Patient List.
result: [pending]

### 3. Patient List Empty State
expected: |
  After login, the Patient List shows "No patients yet — click + New
  patient to add the first one." A "+ New patient" button is visible.
result: [pending]

### 4. Create Patient
expected: |
  "+ New patient" → form with full name, DOB (date picker), gender
  (select), MRN, phone, notes. Submitting valid data persists the
  row and the list now shows it.
result: [pending]

### 5. Search by Name Substring
expected: |
  Typing into the search input filters the list case-insensitively
  by name substring. A 250ms debounce applies.
result: [pending]

### 6. Search by MRN Exact
expected: |
  Typing an MRN into the MRN filter returns only the row whose
  MRN matches exactly.
result: [pending]

### 7. Edit Patient
expected: |
  Row menu → Edit → form pre-fills. Changing a field (e.g. phone)
  and saving updates the row in the list and the underlying DB.
result: [pending]

### 8. Soft-Delete Patient
expected: |
  Row menu → Delete → confirm dialog → "Delete patient?". Confirming
  removes the row from the default list. The row still exists in the
  DB with `deleted_at` populated.
result: [pending]

### 9. Show Deleted Toggle
expected: |
  Toggling "Show deleted" reveals the soft-deleted row with a "Deleted"
  badge. The row's Restore action appears in the row menu.
result: [pending]

### 10. Restore Patient (Admin)
expected: |
  On a soft-deleted row, Restore (admin only) brings the row back to
  the default list with `deleted_at` cleared.
result: [pending]

### 11. Two-Step Login (Restart)
expected: |
  Quit the app, relaunch. The user list shows the admin with avatar
  (colored by userId hash), full name, and "last seen X ago".
  Tapping the row transitions to PIN entry. Correct PIN lands on
  the Patient List.
result: [pending]

### 12. Wrong PIN
expected: |
  Incorrect PIN renders the inline red error "Incorrect PIN" below
  the input, clears the PIN field, and briefly disables the Enter
  button. The back arrow still works and returns to the user list.
result: [pending]

### 13. Backend Lockout After 10 Wrong PINs
expected: |
  The 10th consecutive wrong PIN locks the account. A subsequent
  attempt — even with the correct PIN — shows "Account locked —
  contact admin". The locked row stays in the user list. Restarting
  the app preserves the lock (`is_locked=1` + sentinel `locked_until`
  in the DB).
result: [pending]

### 14. Recovery File Picker
expected: |
  The user list shows a "Forgot admin PIN?" link below the rows.
  Clicking it opens a dialog with two actions: "Email vendor" (calls
  `auth.recoveryRequest` and shows a sonner toast) and "Select
  recovery file" (opens the OS file picker; selecting a `.recover`
  file shows the "Recovery file accepted. License verification will
  complete in Phase 8." toast).
result: [pending]

### 15. Settings → Users (Admin Add)
expected: |
  From the Patient List, open Settings → Users (admin only). Click
  "Add user" → dialog with full name + PIN + confirm PIN. Submitting
  creates the new user and the row appears in the list.
result: [pending]

### 16. Settings → Users (Reset PIN)
expected: |
  On a non-admin user row, "Reset PIN" → dialog with new PIN +
  confirm. Submitting resets the user's PIN; their `failed_attempts`
  resets to 0 and any lock clears.
result: [pending]

### 17. Settings → Users (Admin Cannot Remove Self)
expected: |
  On the admin's own row, the "Remove" action is disabled (greyed
  out) with a tooltip "You cannot remove yourself". The backend
  also rejects the request even if the renderer is bypassed.
result: [pending]

### 18. Settings → Users (Remove Other User)
expected: |
  On a non-admin user row, "Remove" → confirm dialog → confirming
  removes the user (soft-delete — `deleted_at` populates).
result: [pending]

### 19. Audit Log Entries Written
expected: |
  After the user-flow tests above, the `audit_log` table contains
  rows for every login attempt (success/fail), every patient create /
  view / update / soft-delete / restore, and every user add / remove
  / reset PIN. Each row has user, action, entity_type, entity_id,
  metadata, timestamp. No row's `metadata` contains patient field
  VALUES (MRN, phone, notes content) — only column names and filter
  echoes.
result: [pending]

### 20. Append-Only Audit
expected: |
  Attempting to UPDATE or DELETE a row in `audit_log` from the
  SQLite shell (or any code path) raises ABORT — the triggers
  refuse it. There is no `audit:update` or `audit:delete` IPC
  channel.
result: [pending]

## Summary

total: 20
passed: 12
issues: 1
pending: 7
skipped: 0

## Active Gaps (post-fix-02-04)

```yaml
- gap_id: G-2-3
  truth: |
    Rate-limit countdown is live (decrements every second), Enter
    is disabled while the countdown is active, and a locked account
    shows a visible "Locked" badge with Enter disabled.
  status: failed
  reason: |
    User reported: "instead of saying try again after 50 seconds it
    should be countdown and also the enter button should be disabled
    until the countdown finish, and when the account is locked you
    need to add badge or something to show that the account is locked
    and disable enter button because the account already locked."
  severity: minor
  test: 13
  artifacts:
    - src/renderer/src/components/PinEntry.tsx
  fix: |
    Add a `retryAt` state + 1s interval countdown hook. Disable Enter
    while secondsLeft > 0. Show a "Locked" badge (destructive variant)
    above the PIN input when IPC_LOCKED. Disable Enter permanently on
    lockout. The countdown ticks down live and Enter re-enables at 0.
```

## Active Gaps (post-fix-02-04)

```yaml
- gap_id: G-2-2
  truth: "App boots from cold start; DB opens at `<userData>/data/app.db` with WAL; migrations run once; wizard appears"
  status: resolved
  resolved_by: inline-fix (commit 84bb9ca)
  resolved_at: 2026-08-01
  reason: |
    Re-running `npm run dev` after fix 02-04 surfaced:
    `Error: Attempted to register a second handler for 'users:create'`
  severity: blocker
  test: 1
  root_cause: |
    Plan 02-01's executor registered USERS_CREATE / USERS_REMOVE /
    USERS_RESET_PIN in BOTH src/main/ipc/auth.ts AND src/main/ipc/users.ts.
    Electron's ipcMain.handle rejects duplicate registrations.
  fix: |
    Removed the 3 duplicate USERS_* handlers from src/main/ipc/auth.ts.
    Their natural home is src/main/ipc/users.ts (single registration).
    79 / 79 tests pass.
```

## Gaps

```yaml
- gap_id: G-2-1
  truth: "App boots from cold start; DB opens at `<userData>/data/app.db` with WAL; migrations run once; wizard appears"
  status: resolved
  resolved_by: 02-04-PLAN.md
  resolved_at: 2026-08-01
  reason: |
    User reported: `Error: ENOENT: no such file or directory, scandir 'C:\Users\Hussien Essam\Desktop\WORK FREELANCE\colonoscopist\out\main\migrations'`
    at loadMigrations (out/main/index.js:113:25)
  severity: blocker
  test: 1
  artifacts:
    - src/main/db/migrations.ts
    - src/main/db/migrations/0001_init.sql
    - electron.vite.config.ts
  missing:
    - "No mechanism to ship the `.sql` files alongside the compiled `out/main/index.js`"
  root_cause: |
    `src/main/db/migrations.ts` resolved the migrations dir via
    `path.join(__dirname, 'migrations')` where `__dirname` is the
    location of the compiled module. electron-vite bundles all
    `.ts` source into a single `out/main/index.js`, so `__dirname`
    resolved to `out/main/`. The `migrations/` directory and the
    `0001_init.sql` file were NEVER copied to `out/main/`, so
    `readdirSync` threw ENOENT.
  fix_plan: 02-04-PLAN.md
```
