# Phase 1: Scaffold - Context

**Gathered:** 2026-07-31
**Status:** Ready for planning

## Phase Boundary

Boot a hardened Electron app shell with React + TypeScript + Tailwind + shadcn/ui; lock down the renderer security baseline; prove `better-sqlite3` builds and runs under Electron's Node ABI via `postinstall` rebuild. This phase delivers no user-facing feature beyond "the app starts" — it is the foundation every later phase builds on.

**SET-03** (data storage path) is wired at scaffold time so `userData` resolution exists from day 1. **SET-04** (admin user management) is mapped to Phase 1 in REQUIREMENTS.md traceability but logically requires a DB; **ships as a static stub UI in Phase 1, real implementation in Phase 2** (note for the planner to flag in PLAN.md).

## Implementation Decisions

### App identity & window defaults

- **D-01:** Product name `Colonoscopist`; appId `com.colonoscopist.app` — **Reversibility:** **one-way** — Windows registry keys, install directory, Start Menu label, and file associations all derive from these. Rename post-launch = full re-install with cleanup.
- **D-02:** Default window size `1280×800`; minimum `1280×800` — **Reversibility:** reversible — Fits a `1366×768` clinic monitor with taskbar; SD analog preview is workable. Size changes on next launch.
- **D-03:** Window is resizable; maximum `1920×1080` — **Reversibility:** reversible — Covers HD preview without over-stretching on 4K displays. Predictable layout.
- **D-04:** Single main `BrowserWindow` for all routes (Login, Patient, Procedure Room, Review, Report, Settings) — **Reversibility:** **costly** — Switching to multi-window later touches per-window `BrowserWindow` creation, per-window preload path, and IPC contract surface. One window keeps the security surface small.

### Login placeholder feel

- **D-05:** Placeholder login shows a clinic logo placeholder (gray box with text `Clinic Logo`) above a centered `Enter PIN` input — **Reversibility:** reversible — Purely cosmetic; replaced when Phase 2 ships real auth. Sets the visual tone (clinical, not consumer-app).
- **D-06:** No language toggle on the placeholder login screen; English-only text in Phase 1 — **Reversibility:** reversible — i18n (`I18N-01/02/03`) ships in Phase 7. Avoids building i18n scaffolding now.
- **D-07:** PIN input is numeric, 4 digits, masked (dots, not plaintext); accepts digits only — **Reversibility:** reversible — Matches `AUTH-02` (4-digit PIN brute-force assumption) so the placeholder preview matches the real auth UX that ships in Phase 2.
- **D-08:** `Enter` button is disabled with a one-line hint banner under the input: `Auth ships in Phase 2 — PIN input is disabled` — **Reversibility:** reversible — Clinical, clear, no false success. No toast (overkill for a placeholder).

### the agent's Discretion

- Tailwind v3.4 + shadcn/ui component placement (which shadcn components to pre-install for the placeholder login: `Button`, `Input`, `Label` minimum).
- Exact phrasing of the hint banner copy (D-08 mentions the substance; copy is at the agent's discretion).
- Whether the placeholder clinic logo placeholder uses an inline SVG or a Tailwind-styled `<div>` — both are fine.

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §Phase 1 — Goal, success criteria, pitfalls addressed, notes
- `.planning/REQUIREMENTS.md` §AUTH-01 (foundation), §AUTH-04, §SET-03, §SET-04 (Traceability row), §Definition of Done
- `.planning/PROJECT.md` §Constraints, §Key Decisions (stack + security baseline)
- `.planning/STATE.md` §Current Focus, §Phases

### Technical research (stack, pitfalls, architecture)
- `.planning/research/STACK.md` — Locked versions (Electron 32, electron-vite 2, React 18, TS 5.5, Tailwind 3.4, better-sqlite3 11), `asarUnpack` patterns
- `.planning/research/PITFALLS.md` §Pitfall 4 (native module ABI mismatch — Phase 1), §Pitfall 5 (PIN brute-force — Phase 2 but placeholder must not regress to unthrottled form), §Pitfall 9 (backup captures partial DB — Phase 2)
- `.planning/research/ARCHITECTURE.md` — Three-process model, IPC contract pattern, project structure
- `.planning/research/SUMMARY.md` §Phase 1 implications (postinstall rebuild + first-launch ABI log)

### Skills & procedures (how to scaffold)
- `.opencode/skills/electron-vite/SKILL.md` — `npm create @quick-start/electron@latest … --template react-ts`, three-process model, project structure, IPC contract pattern, security baseline, native rebuild, blank-window checklist, `asarUnpack`
- `.opencode/skills/electron-sqlite/SKILL.md` — better-sqlite3 patterns (for Phase 2, but Phase 1's postinstall rebuild uses similar concepts; the skill's "Electron rebuild" section is required reading for Phase 1)

## Existing Code Insights

### Reusable Assets
- None. Greenfield project — no existing code.

### Established Patterns
- None. Greenfield project — conventions emerge in this phase.

### Integration Points
- This phase creates the foundation (`src/main/`, `src/preload/`, `src/renderer/`, `src/shared/`) that every later phase integrates with.
- The typed IPC contract in `src/shared/ipc-contract.ts` (created in this phase with the single `auth:status` channel per ROADMAP §Phase 1 success criterion #3) is the contract every later phase's IPC additions extend.

## Specific Ideas

No specific references from discussion — standard electron-vite scaffold + Tailwind + shadcn placeholder login, with the day-1 foundation decisions captured above.

## Deferred Ideas

### Phase 1 traceability mismatch (flag for planner)
- **SET-04** (admin add/edit/remove users) is mapped to Phase 1 in REQUIREMENTS.md Traceability but logically requires a DB. The planner should ship Phase 1 as a **static stub UI** (or omit the user-management section entirely) and implement the working feature in Phase 2. Flag this clearly in `01-PLAN.md` so the executor and verifier do not try to wire user-management CRUD without a DB.

### Out-of-phase ideas (no action)
- None raised during discussion.

---

*Phase: 1-scaffold*
*Context gathered: 2026-07-31*