# Phase 2: Database + Patient CRUD + Audit + Auth - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-01
**Phase:** 2-database-patient-audit-auth
**Mode:** discuss
**Areas discussed:** First-time setup & first admin; Login user-picker UX
**Areas NOT discussed (offered but not picked):** Lockout recovery flow; Patient identity fields; Search & pagination UX

---

## Area 1: First-time setup & first admin

| Option | Description | Selected |
|--------|-------------|----------|
| Single-PIN bootstrap | One screen: "Set your admin PIN" (4 digits). Lowest friction. | |
| Multi-field wizard | Wizard: name + clinic name + PIN + confirm PIN. Admin account starts complete. | **✓** |
| Sample/demo seed | Seed a real-looking admin (e.g. "Dr. Demo, PIN 1234") with a banner. Risk: demo PIN could ship to a doctor who never noticed. | |

**User's choice:** Multi-field wizard
**Notes:** D-01 captured. The wizard auto-submits on valid PIN + confirm match; on completion the user lands on the Patient List.

| Option | Description | Selected |
|--------|-------------|----------|
| Single admin (recommended) | First user = admin. Any logged-in user can do everything. No role checks. | **✓** |
| Admin + user roles (2 roles) | Admin can add/remove users + PIN reset; non-admin can do patient/procedure/report. | |
| Multi-role hierarchy | Admin, doctor, nurse, technician. Per-action permissions matrix. | |

**User's choice:** Single admin
**Notes:** D-02 captured. No `role` column in `users` for v1 — adding it later is one-way (would require migration + per-action permission checks). SET-04 (admin user management) is admin-only because the wizard writes the first admin and only admin can add others.

| Option | Description | Selected |
|--------|-------------|----------|
| Admin adds users in Phase 2 (recommended) | Admin creates users via Settings → Users page. Matches REQUIREMENTS SET-04. | **✓** |
| Multi-user UI deferred | Only one user in Phase 2; multi-user UI later. AUTH-01 not fully satisfied. | |
| CLI / seeding only | Add users via CLI / one-shot SQL seed. No UI. | |

**User's choice:** Admin adds users in Phase 2
**Notes:** D-03 captured. Ships in Phase 2 alongside the data layer. Phase 1's stub UI is replaced.

| Option | Description | Selected |
|--------|-------------|----------|
| Vendor recovery file (recommended) | Vendor-signed `.recover` file (offline, like license). Engineer at Phase 8 or 2.5. | **✓** |
| App-level recovery PIN | On first-run, store a separate recovery PIN (8 digits, shown once). Single-machine recovery. | |
| Re-run first-run wizard | Wizard is locked once users exist. | |

**User's choice:** Vendor recovery file
**Notes:** D-04 captured. Phase 2 ships the recovery UX surface (Forgot admin PIN? link from login screen that emails machine fingerprint + accepts `.recover` file). The actual signing/verification lives in Phase 8 (Licensing); the fingerprint + Ed25519 path is shared infrastructure.

---

## Area 2: Login user-picker UX

| Option | Description | Selected |
|--------|-------------|----------|
| Two-step (recommended) | User list (avatar + name) → tap row → enter PIN. Adds one tap; list is short. | **✓** |
| Single-screen PIN entry | Type PIN only; system finds user by PIN match. Requires PIN uniqueness. | |
| Two-step with last-user pre-selected | Last user pre-selected; "Switch user" reveals the list. Fastest for common case. | |

**User's choice:** Two-step
**Notes:** D-05 captured. Always starts on the user list at boot (AUTH-04: no persistent session across reboot). The "last-user pre-selected" option was rejected — picking a user explicitly is clearer in a multi-user clinic.

| Option | Description | Selected |
|--------|-------------|----------|
| Avatar + name + last login (recommended) | Avatar placeholder (initials in a circle), full name, "last seen 2h ago". | **✓** |
| Name only | Just full name, no avatar, no timestamp. Minimalist. | |
| Avatar + name + admin badge | Avatar + name + admin badge. Decorative. | |

**User's choice:** Avatar + name + last login
**Notes:** D-06 captured. No avatar upload in v1; initials placeholder. Last-login timestamp drives helpful differentiation in multi-doctor clinics.

| Option | Description | Selected |
|--------|-------------|----------|
| Inline error + reset (recommended) | Wrong PIN → field clears, inline error "Incorrect PIN", Enter disabled briefly. | **✓** |
| Inline copy + cooldown (5-attempt) | "X attempts remaining" counter, exponential backoff counter visible. | |
| Shake animation only | No text. Anime-style. Wrong for clinical. | |

**User's choice:** Inline error + reset
**Notes:** D-07 captured. The exponential backoff / 5-attempt counter (AUTH-02) is still enforced in the backend; this is the visible UX when the count is below the threshold. The "X attempts remaining" was rejected — too noisy on a clinical tool.

| Option | Description | Selected |
|--------|-------------|----------|
| Back button to user list (recommended) | Top-left back arrow on PIN entry returns to user list. Resets PIN field. | **✓** |
| No back — auto-reset on inactivity | No back button. Must wait until input clears. Friction. | |
| Small "Not you?" link | Back arrow + small "Not you?" link. | |

**User's choice:** Back button to user list
**Notes:** D-08 captured. Always available. The "Not you?" link was rejected — the back arrow is sufficient.

---

## Areas NOT discussed (offered but not picked)

- **Lockout recovery flow** — defaulted to admin PIN reset + vendor recovery file (D-04). UX for the lockout state (toast on user list vs inline error on PIN entry) is agent-discretion.
- **Patient identity fields** — defaulted to REQUIREMENTS PAT-01: full name, DOB (date picker), gender (Male/Female/Other enum, optional), MRN (free text, unique per clinic), phone (free text), notes (free text, optional). Adjustable during planning.
- **Search & pagination UX** — defaulted: name substring (case-insensitive), MRN exact match, page size 25, alphabetical sort by name.

## the agent's Discretion items

- PIN hashing primitive (scrypt default; argon2id acceptable).
- Audit log write semantics (synchronous-asserted; multi-row transactions include audit row).
- Schema design for `users`, `patients`, `audit_log`, `settings` (reverse-engineered in RESEARCH.md / PLAN.md).
- Patient soft-delete UX (hidden by default; "Show deleted" toggle; restore action).
- Wizard field order and copy.
- Back-out / idle clear timing (10s default for PIN clearing).
- Avatar placeholder rendering (initials + deterministic color).
- Patient sort order and pagination size in Patient List.

## Deferred Ideas

None raised during discussion that don't already have a phase.

---

*Phase: 2-database-patient-audit-auth*
*Discussion completed: 2026-08-01*
