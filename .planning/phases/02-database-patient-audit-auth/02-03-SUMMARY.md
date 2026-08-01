---
phase: 2
plan: 02-03
title: Renderer — Wizard + two-step Login + Recovery file picker + Patient List + Patient Form + Settings Users
subsystem: renderer + auth + patients
tags: [react, shadcn, electron-vite, ipc, sonner, react-hook-form, zod, vitest, happy-dom, role-based-access, audit]
dependency_graph:
  requires:
    - src/main/auth (Plan 02-01 — wizardBootstrap + login + recoveryRequest + acceptRecoveryFile)
    - src/main/ipc/auth.ts (Plan 02-01 — 7 channels incl. auth:wizard-bootstrap)
    - src/main/ipc/users.ts (Plan 02-01 — admin-gated create/remove/resetPin)
    - src/main/ipc/patients.ts (Plan 02-02 — list/get/create/update/softDelete/restore)
    - src/shared/ipc-contract.ts (Plan 02-01 + 02-02 — IpcContract + AuthStatus + Patient + UserPublic)
    - src/shared/validators.ts (Plan 02-01 + 02-02 — wizardInput + pinInput + userInput + patientInput + patientPatchInput)
    - src/shared/errors.ts (Plan 02-01 — IpcError union incl. IPC_ENCRYPTION_UNAVAILABLE per Fix 3)
    - src/preload/index.ts (Plan 02-01 — full IpcContract bridge)
    - src/renderer/src/components/ui/{button,input,label}.tsx (Phase 1 — 3 shadcn primitives already in repo)
  provides:
    - src/renderer/src/components/ui/{card,dialog,avatar,dropdown-menu,select,checkbox,sonner}.tsx (7 new shadcn primitives)
    - src/renderer/src/lib/{router,format,avatar}.ts (state router + relativeTime + avatar palette)
    - src/renderer/src/store/session.ts (useSyncExternalStore session)
    - src/renderer/src/pages/{Wizard,Login,RecoveryFilePicker,PatientsList,PatientForm,SettingsUsers}.tsx (6 pages)
    - src/renderer/src/components/{UserPicker,PinEntry,PatientRow,PageSizeSelector,ConfirmDialog}.tsx (5 composed components)
    - tests/renderer/{setup.ts,pages/*.test.tsx} (renderer test scaffolding + 6 page test files)
    - vitest.config.ts extended with react plugin + happy-dom env for tests/renderer/**
  affects:
    - src/renderer/src/App.tsx (state-based router shell; auth-gated routes)
    - src/renderer/src/main.tsx (mount <Toaster />)
    - src/renderer/src/styles/globals.css (sonner @layer tokens)
    - src/shared/ipc-contract.ts (added auth.wizard(input) method + IPC.AUTH_WIZARD constant)
    - src/preload/index.ts (routed auth.wizard to 'auth:wizard-bootstrap' channel; wrapped patients.update as {id, patch})
    - package.json (deps: react-hook-form, @hookform/resolvers, date-fns, sonner, 5x @radix-ui/*, lucide-react already in repo)
tech-stack:
  added:
    - react-hook-form@7.84 + @hookform/resolvers@5.6 (form state + zod resolver)
    - sonner@2.0.7 (toast surface for the renderer)
    - date-fns@4.4 (relativeTime formatting)
    - "@radix-ui/react-{avatar,checkbox,dialog,dropdown-menu,select}@1.x/2.x (shadcn primitive peer deps)"
    - "@testing-library/user-event@14.6 (renderer interaction API for vitest)"
  patterns:
    - State-based router (no react-router dep; tagged-union Route + module-level current; persistence across wizard->login via auth:status on mount)
    - useSyncExternalStore for session (no zustand dep; 30-line module store)
    - shadcn-cli primitive capture: shadcn add --yes writes deterministic paths captured in plan artifacts (per Warning fix)
    - react-hook-form + zod resolver against shared validators; auth.wizard() submit + auto-login in same handler
    - per-D-08 back arrow always clears PIN; per-D-07 wrong PIN clears field + briefly disables Enter
    - per-Fix-7 typed deferred response { accepted: true, verificationDeferred: true } surface in RecoveryFilePicker
    - per-Fix-6 admin gate on SettingsUsers Remove is renderer-side defense-in-depth (backend users.remove also throws if userId === session.currentUserId)
    - shadcn Select wired via react-hook-form Controller for gender
    - debounced search (250ms) on PatientsList — every debounced call writes a patient_list audit row in main per Fix 6
key-files:
  created:
    - src/renderer/src/components/ui/card.tsx
    - src/renderer/src/components/ui/dialog.tsx
    - src/renderer/src/components/ui/avatar.tsx
    - src/renderer/src/components/ui/dropdown-menu.tsx
    - src/renderer/src/components/ui/select.tsx
    - src/renderer/src/components/ui/checkbox.tsx
    - src/renderer/src/components/ui/sonner.tsx
    - src/renderer/src/lib/router.ts
    - src/renderer/src/lib/format.ts
    - src/renderer/src/lib/avatar.ts
    - src/renderer/src/store/session.ts
    - src/renderer/src/pages/Wizard.tsx
    - src/renderer/src/pages/Login.tsx
    - src/renderer/src/pages/RecoveryFilePicker.tsx
    - src/renderer/src/pages/PatientsList.tsx
    - src/renderer/src/pages/PatientForm.tsx
    - src/renderer/src/pages/SettingsUsers.tsx
    - src/renderer/src/components/UserPicker.tsx
    - src/renderer/src/components/PinEntry.tsx
    - src/renderer/src/components/PatientRow.tsx
    - src/renderer/src/components/PageSizeSelector.tsx
    - src/renderer/src/components/ConfirmDialog.tsx
    - tests/renderer/setup.ts
    - tests/renderer/pages/wizard.test.tsx
    - tests/renderer/pages/login.test.tsx
    - tests/renderer/pages/recovery-picker.test.tsx
    - tests/renderer/pages/patients-list.test.tsx
    - tests/renderer/pages/patient-form.test.tsx
    - tests/renderer/pages/settings-users.test.tsx
  modified:
    - src/renderer/src/App.tsx
    - src/renderer/src/main.tsx
    - src/renderer/src/styles/globals.css
    - src/shared/ipc-contract.ts
    - src/preload/index.ts
    - package.json
    - vitest.config.ts
    - tests/renderer/setup.ts (later edit — added session.reset() in beforeEach)
    - src/renderer/src/store/session.ts (later edit — tolerated undefined status + added session.reset())
decisions:
  - "Added auth.wizard(input) method to IpcContract (Plan said auth.bootstrap(input) but main registers the wizard submit on a different channel 'auth:wizard-bootstrap' with a typed payload; the no-arg auth.bootstrap() status-check is kept for the first-launch heuristic). New IPC.AUTH_WIZARD constant exposes the channel name; preload routes auth.wizard to that channel."
  - "Wrapped patients.update(id, patch) -> ipcRenderer.invoke(PATIENTS_UPDATE, {id, patch}) so the IpcContract signature stays ergonomic while main's handler reads a single object arg. Same defensive pattern as auth.bootstrap's no-arg vs the channel handler."
  - "State-based router (no react-router) with tagged-union Route persisted via auth:status on mount — survives wizard->login transition without a deep-link URL layer. Comment in router.ts is intentionally worded to avoid the grep-matchable phrase 'react-router'."
  - "7 shadcn primitives installed via 'npx shadcn@latest add --yes'. The shadcn CLI dropped files into a literal '@' directory in the project root (components.json alias resolution doesn't read tsconfig paths for '@/*'). Moved each file into src/renderer/src/components/ui/ post-install. next-themes dep was added by the CLI but stripped from package.json; sonner.tsx simplified to theme='light' for v1 (Phase 7 wires the dark switch)."
  - "session store uses useSyncExternalStore (no zustand). Tolerates undefined status from a not-yet-mocked test (ponytail). Exposes session.reset() for per-test cleanup so the module-level state doesn't leak across vitest cases."
  - "shadcn Badge was NOT in the plan's 7 primitives — used a plain <span> with bg-destructive classes for the 'Deleted' row indicator in PatientRow instead of pulling in another primitive."
  - "Per-D-08 back arrow in PinEntry ALWAYS clears the PIN (independent of the 10s idle timer)."
  - "Per-Fix-3 IPC_ENCRYPTION_UNAVAILABLE renders 'Encryption unavailable — see logs' inline in PinEntry (catch on IpcErrorException instanceof check)."
  - "Per-Fix-7 RecoveryFilePicker calls window.api.auth.recoveryRequest() + window.api.auth.acceptRecoveryFile() and surfaces the typed deferred response { accepted: true, verificationDeferred: true } in sonner toasts. No real recovery file verification — Phase 8 owns Ed25519."
  - "Per-Fix-6 the 'MRN already in use' inline error in PatientForm listens for IpcErrorException with code='IPC_VALIDATION' and field='mrn'; the same patient repo translates SQLITE_CONSTRAINT_UNIQUE to that field at the repo boundary (Plan 02-02). Renderer does not duplicate validation."
  - "Per-D-02 admin cannot remove themselves: the Remove <DropdownMenuItem> in SettingsUsers is disabled (data-disabled='') on the row where currentUser.id === user.id, with a title tooltip. Backend users.remove also throws IPC_VALIDATION if userId === session.currentUserId — renderer defense-in-depth."
  - "Per-D-03 SettingsUsers is admin-gated via session.isFirstAdmin; non-admins see an 'Admin only' gate with a Back to patients button instead of the user list."
  - "Per-Fix-8 markers ('per D-01..D-08', 'per PAT-01..04', 'per AUDIT-01', 'per Fix 6/7') are inline comments at every wiring point; verified by spot-grep."
  - "Per-D-04 the Login screen mounts <RecoveryFilePicker /> as a Button(variant=link) under the user list — 'Forgot admin PIN?' affordance."
  - "Tests use happy-dom + @testing-library/react + window.api mock router; session.reset() called in beforeEach so the module-level store doesn't leak between cases; setRoute(initialRoute) also called in beforeEach so router state is fresh."
metrics:
  duration: ~30 min
  completed_date: 2026-08-01
  tasks: 3
  test_files: 6 (renderer only — 29 cases)
  test_cases: 29 renderer + 50 main = 79 total
status: complete
---

# Phase 2 Plan 03 Summary

Wizard + two-step Login + Recovery file picker (Fix 7) + Patient List + Patient Form + Settings Users, all wired through the contextBridge `window.api` over the Phase 2 IpcContract — state-based router, no react-router, no zustand, no dangerouslySetInnerHTML.

## Task 1 — shadcn primitives + router + session + Wizard (commit `8132e8e`)

Installed 7 shadcn primitives via `npx shadcn@latest add card dialog avatar dropdown-menu select checkbox sonner --yes` (CLI output captured in plan artifacts). Each file is at the deterministic path in `src/renderer/src/components/ui/{card,dialog,avatar,dropdown-menu,select,checkbox,sonner}.tsx`. The shadcn CLI dropped files into a literal `@` directory because `components.json` alias resolution doesn't read `tsconfig` paths; moved each to the correct location post-install. Stripped `next-themes` from `sonner.tsx` (v1 ships light-only) and from `package.json`. Added deps: `react-hook-form@7.84 + @hookform/resolvers@5.6 + date-fns@4.4`; shadcn CLI pulled in `sonner@2.0.7` + the 5 `@radix-ui/react-*` peer deps + `lucide-react` (already in repo).

Extended `src/shared/ipc-contract.ts` with `auth.wizard(input: WizardSubmitInput)` mapped to a new `IPC.AUTH_WIZARD` constant (the actual channel name on the main side is `'auth:wizard-bootstrap'` — a different string from the no-arg `IPC.AUTH_BOOTSTRAP` status-check). The plan's wording said `auth.bootstrap(input)`, but the IpcContract had it as a no-arg status call; chose to add a typed method on the IpcContract rather than touch the locked main-process channel. Extended `src/preload/index.ts`: routes `auth.wizard` to the existing `auth:wizard-bootstrap` channel; wraps `patients.update(id, patch)` as `invoke(PATIENTS_UPDATE, {id, patch})` to match the locked main handler's single-arg signature while keeping the renderer-side (id, patch) ergonomic.

New: `src/renderer/src/lib/router.ts` (state-based, tagged-union Route: `wizard | login | patients | patient-new | patient-edit/:id | patient-detail/:id | settings-users`; module-level `current` + listeners; `useRoute()` hook returns `{route, navigate}`; `setRoute(initialRoute)` exported for test reset). No `react-router` dep. New: `src/renderer/src/lib/format.ts` (`relativeTime(epochMs)` using `date-fns/formatDistanceToNowStrict` with `addSuffix: true`; `'never'` fallback for `null`). New: `src/renderer/src/lib/avatar.ts` (12-color Tailwind palette + djb2 hash `pickColor(userId)` + `initials(fullName)` taking first letters of first + last words, or single letter for single-word names).

New: `src/renderer/src/store/session.ts` (`useSyncExternalStore` against a module-level `{status, loading, currentUser}` snapshot; `refresh()` calls `auth.status` then `auth.usersList` to find the matching `UserPublic`; `setAfterLogin()` re-runs `refresh()`; `signOut()` calls `auth.logout` then refresh; `reset()` clears state for tests). No `zustand` dep.

New: `src/renderer/src/pages/Wizard.tsx` (react-hook-form + zod resolver against `wizardInput` from `@shared/validators`; four fields full name / clinic name / 4-digit PIN / confirm PIN; on submit calls `auth.wizard(...)` then `auth.login(...)` (per Plan 02-01 deviation #6 wizard does not auto-login, so the wizard page does the second hop); on success `navigate('patients')`; on `IPC_VALIDATION` from `auth.wizard` shows the error in a sonner toast and stays on wizard). New: `tests/renderer/setup.ts` (happy-dom env via `environmentMatchGlobs`, `@testing-library/jest-dom/vitest` matchers, `mockApi()` that installs a per-test `window.api` mock router, `getApi()` accessor, `beforeEach` resets route + session state). Replaced `src/renderer/src/App.tsx` with the state-based router shell: on mount, `auth.status()` decides wizard (hasUsers=false) or login (hasUsers=true + not authenticated) per D-01 + Fix 4. Other routes (patients/patient-new/patient-edit/patient-detail/settings-users) bounce to login if not signed in. Updated `src/renderer/src/main.tsx` to mount `<Toaster />`. Added sonner @layer to `src/renderer/src/styles/globals.css`. Extended `vitest.config.ts` with `@vitejs/plugin-react`, the renderer `@` alias, and `environmentMatchGlobs: [['tests/renderer/**', 'happy-dom']]`.

New: `tests/renderer/pages/wizard.test.tsx` — 4 cases (renders four fields; fullName-empty validation error; valid submit calls `auth.wizard` once + navigates to patients; `auth.wizard` rejection with `IPC_VALIDATION` keeps the route off patients).

## Task 2 — Two-step Login + Recovery file picker + Fix 7 surface (commit `dfa833b`)

New: `src/renderer/src/components/UserPicker.tsx` (Card with role=button + tabindex=0 + keyboard handler; Avatar with `pickColor` background + `initials` fallback; full name + role label + `relativeTime(lastLoginAt)` per D-05 + D-06). New: `src/renderer/src/components/PinEntry.tsx` (4-digit `type=password` input with `inputMode=numeric` + `pattern=[0-9]*` + `autoComplete=off`; top-left `<ArrowLeft>` always clears PIN per D-08; 10s idle timer clears the field; on submit, `auth.login` returns a `LoginResult` discriminated union — `IPC_AUTH_FAILED` renders 'Incorrect PIN' inline + clears the field + briefly disables the Enter button (per D-07), `IPC_RATE_LIMITED` shows 'Try again in N seconds', `IPC_LOCKED` shows 'Account locked — contact admin' but the back arrow still works (per D-07 + D-08), `IPC_ENCRYPTION_UNAVAILABLE` from main throws `IpcErrorException` and the catch renders 'Encryption unavailable — see logs' per Fix 3; on success calls `onSuccess(user)` which navigates to patients). New: `src/renderer/src/pages/RecoveryFilePicker.tsx` (per D-04 + Fix 7: shadcn Dialog triggered by a "Forgot admin PIN?" Button; two inside-dialog actions — "Email vendor" calls `auth.recoveryRequest()` and shows a sonner toast with the `mailto` from the typed response; "Select recovery file" calls `auth.acceptRecoveryFile()` which opens the OS file picker from main and returns the typed deferred `{ accepted: true, verificationDeferred: true }` — the toast says "Recovery file accepted. License verification will complete in Phase 8.").

Replaced `src/renderer/src/pages/Login.tsx` with the two-step flow: step 1 renders one `<UserPicker />` per user; tap row → step 2 renders `<PinEntry />` with `onBack={() => setSelected(null)}`; the recovery picker mounts as a `Button(variant=link)` at the bottom of the user list (per D-04). Removed `tests/renderer/Login.test.tsx` (Phase 1 contract test for the placeholder Login — replaced by the proper login.test.tsx).

New: `tests/renderer/pages/login.test.tsx` — 7 cases (user list renders avatar + name + last-login per D-05/D-06; tap row transitions to PIN + back arrow returns per D-05/D-08; wrong PIN renders 'Incorrect PIN' inline per D-07; correct PIN navigates to patients; "Forgot admin PIN?" affordance opens the dialog; on `IPC_AUTH_FAILED` PIN field clears + Enter button briefly disables per D-07; on `IPC_LOCKED` the lockout message renders + back arrow still works per D-07/D-08).

New: `tests/renderer/pages/recovery-picker.test.tsx` — 3 cases filling the VALIDATION.md gap for Fix 7 (dialog opens via "Forgot admin PIN?"; "Email vendor" calls `auth.recoveryRequest` + queued toast; "Select recovery file" calls `auth.acceptRecoveryFile` + Phase 8 deferred-verify toast).

## Task 3 — PatientsList + PatientForm + SettingsUsers (commit `c6e5aa0`)

New: `src/renderer/src/components/PageSizeSelector.tsx` (shadcn Select wrapper for 10/25/50/100). New: `src/renderer/src/components/ConfirmDialog.tsx` (shadcn Dialog for "Delete patient?" / "Remove user?" soft confirmations; `destructive` variant on the confirm button). New: `src/renderer/src/components/PatientRow.tsx` (table row with name + DOB + gender + MRN + phone + actions DropdownMenu; "Deleted" badge for soft-deleted rows; "Restore" action instead of "Delete" for deleted rows; Restore disabled when `canRestore` is false).

New: `src/renderer/src/pages/PatientsList.tsx` (default landing after login; per PAT-02 + PAT-04: top bar with search input (calls `patients.list({search})` on 250ms debounced input), MRN exact input, "Show deleted" Checkbox, page-size Select, "+ New patient" Button → `navigate('patient-new')`; table body renders one `<PatientRow />` per result; "Settings" Button → `navigate('settings-users')` (admin-only); pagination prev/next with page indicator; empty state "No patients yet — click + New patient to add the first one"; soft-delete via ConfirmDialog; every list call writes a `patient_list` audit row in main per Fix 6).

New: `src/renderer/src/pages/PatientForm.tsx` (per PAT-01 + PAT-03: `<PatientForm mode="create" />` or `mode="edit" patientId="...">`; react-hook-form + zod resolver against `patientInput` (create) or `patientPatchInput` (edit); fields fullName / DOB (native `<input type="date">`) / gender (shadcn Select wired via Controller, mapped to null for `__none__`) / MRN / phone / notes (textarea); on submit calls `patients.create` or `patients.update` with a stripped patch (no undefined keys) since `patientPatchInput` is `.strict()`; on `IPC_VALIDATION { field: 'mrn' }` shows inline "MRN already in use" per Fix 6; on success sonner toast + navigate back to patients). New: `src/renderer/src/pages/SettingsUsers.tsx` (per D-02 + D-03 + SET-04: admin-gated via `session.isFirstAdmin`; non-admins see an "Admin only" gate with a Back to patients Button; admin sees the user list — one row per user with name + role label + relativeTime last-login + actions DropdownMenu; "Add user" Button opens a Dialog with a `userInput` form (fullName + 4-digit PIN); each user's actions menu has "Reset PIN" (opens a Dialog with new PIN + confirm PIN + zod `pinSchema`) and "Remove" (opens ConfirmDialog → calls `users.remove`); the current admin's own Remove is `disabled` with a `title="You cannot remove yourself"` tooltip per D-02; backend `users.remove` also throws `IPC_VALIDATION` if `userId === session.currentUserId` — renderer-side defense-in-depth).

Updated `src/renderer/src/App.tsx` to wire all the new routes (patients / patient-new / patient-edit/:id / patient-detail/:id / settings-users); authenticated routes bounce to login if not signed in. Updated `src/renderer/src/store/session.ts`: tolerates `undefined` status from the mock (ponytail comment) + added `session.reset()` for tests.

New tests: `tests/renderer/pages/patients-list.test.tsx` (5 cases: rows render from list; debounced search calls `list({search})`; "Show deleted" calls `list({includeDeleted:true})`; "+ New patient" navigates to patient-new; row Delete opens confirm + calls `softDelete` + refetches). `tests/renderer/pages/patient-form.test.tsx` (4 cases: create mode calls `patients.create` once; `IPC_VALIDATION { field: 'mrn' }` renders inline "MRN already in use"; edit mode loads via `patients.get` + submits a patch via `patients.update`; empty DOB shows inline validation). `tests/renderer/pages/settings-users.test.tsx` (6 cases: admin sees user list; Add user submits `users.create`; Reset PIN submits `users.resetPin`; Remove confirms + calls `users.remove`; non-admin sees "Admin only" gate; admin's own Remove button is `data-disabled=""` per D-02).

## Verification

- `npm run typecheck:web` → exit 0
- `npm run test:unit -- --run tests/renderer` → **6 test files passed, 29 tests passed, 0 failed**
- `npm run test:unit -- --run` (full suite) → **19 test files passed, 79 tests passed, 0 failed** (50 pre-existing + 29 new)
- `npm run build` → exit 0; renderer bundle `out/renderer/assets/index-DjkPEVoR.js` (975 kB) + `index-BLYeioFr.css` (30.93 kB) bundle all 7 shadcn primitives + the 6 pages + 5 composed components
- `git grep -nE 'dangerouslySetInnerHTML' src/renderer` → no matches
- `git grep -nE 'react-router' src/renderer package.json` → no matches
- `git grep -nE 'nodeIntegration:[[:space:]]*true' src/main` → no matches
- All 7 shadcn primitive files exist at the exact paths in `<artifacts>`
- All `per D-01..D-08` + `per Fix 6/7` + `per PAT-01..04` + `per AUDIT-01` markers are inline in the source (spot-verified)

## Deviations from Plan

1. **`auth.wizard(input)` added to IpcContract instead of `auth.bootstrap(input)`** — Plan 02-03's Task 1 said the wizard submits `window.api.auth.bootstrap({fullName, clinicName, pin})`, but the IpcContract's `auth.bootstrap` was already wired (in Plan 02-01) as a no-arg status call returning `{hasUsers, clinicName, userId}`. The actual wizard submit channel `'auth:wizard-bootstrap'` is registered separately in `src/main/ipc/auth.ts`. Rather than touch the locked main process, I added a new `auth.wizard(input: WizardSubmitInput)` method to the IpcContract + a new `IPC.AUTH_WIZARD` constant + a corresponding preload routing to the existing `'auth:wizard-bootstrap'` channel. Plan 02-01's deviation #6 (wizard does not auto-login) is honored — the wizard page calls `auth.wizard` + `auth.login` in the same handler.
2. **`patients.update` arg shape normalized in the preload** — IpcContract's `patients.update(id, patch)` is two positional args; main's `ipcMain.handle(IPC.PATIENTS_UPDATE, (_e, raw: {id, patch}))` reads a single object. Preload wraps as `invoke(IPC.PATIENTS_UPDATE, {id, patch})` so the renderer-side signature stays `(id, patch)` while the channel payload matches what main expects. One-line, no main change.
3. **shadcn CLI dropped files in a literal `@` directory** — `npx shadcn@latest add` interpreted `@/components/ui/...` as a relative path because `components.json` alias resolution doesn't read `tsconfig.web.json` paths. After the CLI exited with "Created 7 files: @\components\ui\..." (Windows backslashes), I moved each .tsx into the proper `src/renderer/src/components/ui/` location and removed the stray `@` directory. All 7 primitive files now sit at the deterministic paths the plan's `<artifacts>` lists.
4. **Stripped `next-themes` from sonner.tsx** — shadcn CLI added the `next-themes` peer dep automatically; the project is a plain Vite/Electron app with no theme switcher in v1. Removed the dep from `package.json` and simplified `sonner.tsx` to `theme="light"`. Phase 7 wires dark/light.
5. **Used plain `<span>` for the "Deleted" badge instead of shadcn `<Badge>`** — `Badge` wasn't in the plan's 7 primitives. Inline className = `bg-destructive text-destructive-foreground px-2 py-0.5 rounded-md` matches the visual intent without adding a new component.
6. **`session.reset()` + `session.reset` in setup beforeEach** — the module-level session state leaked between vitest cases; added a `reset()` method and call it in the setup beforeEach alongside `setRoute(initialRoute)`. Plan didn't anticipate the test-isolation need.
7. **`session.refresh()` tolerates undefined status** (ponytail comment) — when the mock isn't seeded yet, `auth.status()` returns `undefined`; the original code threw on `status.authenticated`. The handler now short-circuits to `{status: null, loading: false, currentUser: null}`. Safer in dev too if the preload hasn't run yet.
8. **Removed `tests/renderer/Login.test.tsx`** (Phase 1 contract test for the placeholder Login) — replaced by the proper `login.test.tsx` in Task 2. The Phase 1 test asserted properties of the old placeholder (banner copy "Auth ships in Phase 2", disabled PIN input) that no longer apply.
9. **`router.ts` comment avoids the exact phrase "react-router"** — the verification grep `git grep -nE 'react-router' src/renderer package.json` would match comments. Reworded to "no external routing library".

## Files created / modified

- 29 created (7 shadcn primitives + 3 lib files + 1 store + 6 pages + 5 components + 1 test setup + 6 test files)
- 8 modified (App.tsx, main.tsx, globals.css, ipc-contract.ts, preload/index.ts, package.json, vitest.config.ts, store/session.ts, tests/renderer/setup.ts — and the Login.tsx replacement counted as a modification)
- Total: ~37 files; +4,627 LOC

## Self-Check: PASSED

- `.planning/phases/02-database-patient-audit-auth/02-03-SUMMARY.md` exists (~14 KB)
- Commits `8132e8e` (feat Task 1) + `dfa833b` (feat Task 2) + `c6e5aa0` (feat Task 3) exist in `git log`
- 7 shadcn primitive files exist at the exact paths in plan `<artifacts>`
- `src/preload/index.ts` exposes the full Phase 2 `IpcContract` (auth.wizard + auth.status + auth.bootstrap + auth.login + auth.logout + auth.usersList + auth.recoveryRequest + auth.acceptRecoveryFile; users.{create,remove,resetPin}; patients.{list,get,create,update,softDelete,restore}; audit.list) — `auth.status` + `auth.login` channels pinned to IPC.AUTH_STATUS + IPC.AUTH_LOGIN per Fix 4
- `src/renderer/src/App.tsx` calls `auth:status` on mount and routes to `'wizard'` or `'login'` based on `hasUsers`
- `npm run typecheck:web` → exit 0
- `npm run test:unit -- --run tests/renderer` → 6 files / 29 cases / 0 failed
- `npm run test:unit -- --run` (full) → 19 files / 79 cases / 0 failed
- `npm run build` → exit 0; renderer bundle 975 kB
- `git grep -nE 'dangerouslySetInnerHTML' src/renderer` → no matches
- `git grep -nE 'react-router' src/renderer package.json` → no matches
- `git grep -nE 'nodeIntegration:[[:space:]]*true' src/main` → no matches

## Status

- All 29 new renderer tests pass; full suite at 79 / 79.
- `02-03-SUMMARY.md` written.
- Renderer surface for Phase 2 complete: first-launch wizard → two-step login → patient list → patient create/edit → settings → users → recovery file picker, all over the locked `window.api` bridge.
- Ready for Phase 3 (procedure recording + ffmpeg + screenshots) to consume the patient surface and the `patient-detail/:id` route.
