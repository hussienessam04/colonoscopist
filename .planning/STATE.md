# State: Colonoscopist

**Project:** Colonoscopist
**Initialized:** 2026-07-31
**Mode:** yolo
**Granularity:** standard
**Workflow:** research, plan_check, verifier, nyquist_validation, auto_advance, code_review, ui_phase all enabled.
**Models:** inherit (subagents use the active session model — required for non-Anthropic OpenCode runtimes).

## Current Focus

Phase 1 — Scaffold. Next step: `/gsd-plan-phase 1` (or `/gsd-discuss-phase 1` first if UI-heavy — Phase 1 has no UI hint).

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-31)

**Core value:** A gloved, busy doctor can hit Record on a procedure, capture findings as screenshots during the case, and walk out with a signed PDF report ready for the patient — with zero internet dependency between recordings.

## Phases

| # | Phase | Requirements | Status |
|---|-------|--------------|--------|
| 1 | Scaffold (electron-vite + security baseline + native rebuild) | 4 | pending |
| 2 | Database + Migrations + Patient CRUD + Audit + Auth | 10 | pending |
| 3 | Capture Device Enumeration + Live Preview + Quality Presets | 6 | pending |
| 4 | Recording (ffmpeg child + timer + device-lost handling) | 6 | pending |
| 5 | Screenshots + Procedure Review + Trim | 6 | pending |
| 6 | Doctor Profile + Report Editor + PDF Generation | 9 | pending |
| 7 | Search & History + Audit UI + Backup/Restore + Arabic/RTL | 8 | pending |
| 8 | Licensing (Ed25519 signed .lic + 14-day trial + activation) | 4 | pending |

## Open Questions / Decisions to Make in Planning

- **Phase 4:** Confirm segmentation vs single-file write for the procedure mp4 (segmentation protects against >2h corruption; single file is simpler). Default: single file with `-movflags +faststart`, segmented if user pushback.
- **Phase 6:** Confirm `@react-pdf/renderer` RTL bidi handling in a smoke test during plan-phase; if insufficient, plan a small HTML→PDF fallback for the AR report path only.
- **Phase 8:** Decide re-activation policy for hardware changes (NIC swap). Default: vendor regenerates `.lic` on email request; N re-activations per year (deferred to LIC-06 in v2).

## Workflow Notes

- Auto-mode was requested. The `gsd-project-researcher` and `gsd-roadmapper` subagent types are not installed in this OpenCode runtime (`unknown_agent: true`); the orchestrator produced all four research files + this roadmap inline, using the user's brief as the primary input and the templates as the structure.
- All `gsd-tools` CLI commands (`query init.new-project`, `query commit`, `query config-set`, `query generate-claude-md`) ran successfully against the `gsd-tools.cjs` binary.

## Continuity

- Last commit: see `git log --oneline -10` in this repo (chained `chore: add project config`, `docs: initialize project`, `docs: complete project research`, `docs: define v1 requirements`, `docs: create roadmap (8 phases)`).
- Auto-chain flag: `workflow._auto_chain_active = true` (set during config).

---
*State last updated: 2026-07-31 after initialization*
