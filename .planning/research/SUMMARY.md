# Project Research Summary

**Project:** Colonoscopist
**Domain:** Desktop medical-imaging-adjacent recorder/reporter (Electron, Windows, offline, GCC small-clinic market)
**Researched:** 2026-07-31
**Confidence:** HIGH

## Executive Summary

Colonoscopist is a Windows desktop Electron app that records, documents, and reports on colonoscopy procedures for small GCC clinics. The stack is locked in by the user's brief — Electron + electron-vite + React + TS + Tailwind + shadcn + better-sqlite3 + ffmpeg-static + @react-pdf/renderer + Ed25519 signed licenses — all aligned with an offline, single-workstation, security-baseline discipline (contextIsolation + sandbox + no nodeIntegration + safeStorage for PII).

The product's differentiators align with the regional market: EN + AR + full RTL; one-time perpetual license activated offline; generic USB capture (no vendor SDK lock-in); zero phone-home. The feature scope is the user's nine-area matrix (auth, patients, capture, review, reports, search, settings, audit, i18n), explicitly bounded by the eight "out of scope" exclusions (cloud, DICOM, vendor SDKs, billing, scheduling, STT, mobile, AI polyp).

The highest-leverage risks are concentrated in Phase 4 (recording: ffmpeg child process supervision + device disconnects + Windows path quoting) and Phase 8 (license hardening + N-API follow-up). All are addressable with discipline in their respective phases — there are no known architectural blockers.

## Key Findings

### Recommended Stack

See `STACK.md` for full table with versions. Highlights:

- **Core:** Electron 32 + electron-vite 2 + React 18 + TypeScript 5.5.
- **Recording driver:** `ffmpeg-static` spawned as a child process from main (NOT MediaRecorder — long procedures break it).
- **Persistence:** `better-sqlite3` 11 in WAL mode, accessed only from main.
- **PDF:** `@react-pdf/renderer` 4, called from main via a thin headless bridge (React component templates).
- **UI:** Tailwind 3.4 + shadcn/ui, copy-into-repo components, Radix primitives underneath.
- **License:** `@noble/ed25519` for verify path (shipped); vendor-side `scripts/gen-license.cjs` keeps the signing key offline.
- **i18n:** i18next + react-i18next + i18next-browser-languagedetector; RTL via `<html dir>` + Radix `dir` + RTL utilities.
- **Native rebuild:** mandatory `electron-rebuild` after install (postinstall hook) — `better-sqlite3` ABI ties to Electron's Node version.
- **Packaging:** electron-builder 25 with Windows NSIS installer + portable.

**Confidence:** HIGH. Stack is locked by the user brief; verified against current versions.

### Expected Features

See `FEATURES.md` for full Table Stakes / Differentiators / Anti-Features matrix.

**Must have (v1 — table stakes):**
- PIN login + per-doctor profile (EN+AR name, clinic info, signature image, clinic logo)
- Patient CRUD + MRN/name search (SQLite FTS5)
- Live preview + mp4 record with timer (ffmpeg child process)
- Mid-procedure screenshots tied to timeline
- Procedure review (video scrubber + clickable screenshot timeline)
- PDF report (auto-filled doctor/clinic info, findings/diagnosis/recommendations, attachable screenshots, draft → finalized)
- Audit log (every login, view, edit)
- Backup (zip data folder) + Restore
- Ed25519 license activation + 14-day trial
- EN + AR + full RTL
- Settings (device dropdown, quality presets, storage path)

**Should have (v1.x — competitive):**
- Basic trim (cut start/end of recorded procedure)
- Search by date range / doctor

**Defer (v2+):**
- Speech-to-text dictation
- AI polyp suggestion overlay
- Mobile companion app
- DICOM export
- Multi-clinic central admin

**Anti-features explicitly rejected for v1:**
- Cloud sync, DICOM/PACS, vendor SDKs, billing/scheduling, real-time multi-user collab, mobile companion.

**Confidence:** HIGH.

### Architecture Approach

See `ARCHITECTURE.md` for full system overview + project structure.

**Major components:**
1. **Main process** — owns SQLite, ffmpeg child supervision, license verify, safeStorage wrap, backup/restore, PDF generation. `contextIsolation: true / nodeIntegration: false / sandbox: true`.
2. **Preload** — typed `contextBridge.exposeInMainWorld('api', contract)` exposing only the IPC methods the renderer needs. Contract lives in `src/shared/ipc-contract.ts` and is imported by both preload and main.
3. **Renderer (React)** — UI pages (Login, Patient, Procedure Room, Review, Report Editor, Settings), styled with Tailwind + shadcn, with two parallel flows: getUserMedia preview in renderer; recordings driven by main over IPC.
4. **SQLite (main side only)** — better-sqlite3, WAL mode, per-table modules + numbered SQL migration files.
5. **Recorder (main side)** — owns one ffmpeg child per active procedure; structured start/stop/status IPC; graceful shutdown.
6. **License service (main side)** — verifies Ed25519-signed `.lic` files; tracks trial clock; gates all IPC handlers.
7. **i18n (renderer)** — i18next bundles for EN + AR; `<html dir>` flip on language change.

**Confidence:** HIGH.

### Critical Pitfalls

See `PITFALLS.md` for full detail.

Top 5 (the rest are addressable but these are the highest-leverage risks):

1. **Lost frames / corrupt mp4 at end of long procedure.** Cause: ffmpeg killed before moov atom finalized. Phase 4. Fix: SIGTERM-with-grace on `q\n`, fsync at close, `-movflags +faststart`, segmented option as fallback.
2. **Device-lost mid-recording** (USB wiggle / EasyCap glitch). Cause: DirectShow drivers. Phase 4. Fix: watch ffmpeg stderr for 30s silence; emit IPC warning; persist `.partial.mp4` + sidecar JSON.
3. **Device enumeration race / duplicate device open.** Cause: EasyCap enforces exclusive after one handle opens. Phases 3 + 4. Fix: open in main (ffmpeg) first, then `getUserMedia` in renderer — fall back to a single-handle mode if needed.
4. **Native module ABI mismatch.** Cause: Electron major upgrade; `better-sqlite3` wasn't rebuilt. Phase 1. Fix: mandatory `postinstall` rebuild + first-launch ABI log banner.
5. **PIN brute-force / license trivially bypassed.** Phase 1 / 2 / 8. Fixes: scrypt + per-user salt + exponential backoff; Ed25519 verify path embedded in binary with `Object.freeze`'d code paths (Phase 8 N-API follow-up).

**Plus 5 more, all mapped to a phase and a verification step in `PITFALLS.md`.**

**Confidence:** HIGH.

## Implications for Roadmap

The user's brief already specifies an 8-sprint milestone map (scaffolding → database → capture → recording → screenshots+review → profile+report → search+audit+i18n → licensing). Research confirms that ordering as architecturally correct. Refinements below.

### Phase 1: Scaffold (electron-vite + React + TS + native setup)

**Rationale:** Nothing else builds without it; native-module rebuild discipline must land on day 1.
**Delivers:** App boots; typed IPC contract in place; `postinstall` rebuild verified; first-launch ABI log; BrowserWindow with `contextIsolation: true, nodeIntegration: false, sandbox: true`.
**Implements:** All of `src/main`, `src/preload`, empty `src/renderer` shell; Tailwind + shadcn configured.
**Addresses:** Foundation for every later feature.
**Avoids:** Pitfall 4 (native module ABI mismatch) by front-loading the rebuild hook.

### Phase 2: Database + Migrations + Patient CRUD

**Rationale:** Patients are the entity every procedure/report attaches to; without DB nothing else is end-to-end.
**Delivers:** `patients` table + migrations runner + CRUD IPC + search IPC + patient list page in renderer.
**Implements:** `src/main/db/` (connection, migrations, `patients.ts`), one CRUD page + tests.
**Avoids:** Pitfall 9 (backup captures partial DB) — `PRAGMA wal_checkpoint(TRUNCATE)` wired from day 1.

### Phase 3: Capture Device Enumeration + Live Preview

**Rationale:** Doctor needs to pick a device and see a preview before any recording; the renderer-side `getUserMedia` + the main-side device discovery plumbing must work in tandem.
**Delivers:** Device list IPC; picker UI in Procedure Room; live `<video>` preview from `getUserMedia`; handle-quote escaping verified.
**Avoids:** Pitfall 3 (device enumeration race) — explicit sequencing: main opens first, then renderer.

### Phase 4: Recording (ffmpeg child + supervisor)

**Rationale:** This is the hero feature; it's also where the highest-leverage pitfalls live. Concentrated scope = small blast radius for fixes.
**Delivers:** ffmpeg child spawn + supervisor; Record/Stop in Procedure Room; procedure timer; mp4 stored under `<userData>/data/media/patients/<id>/<procedureId>/video.mp4`; procedures row with `started_at`/`ended_at`/`duration_seconds`.
**Avoids:** Pitfalls 1, 2, 10 (corrupt mp4, device lost, Windows path quoting) — SIGTERM-with-grace, stderr watcher, name normalization.

### Phase 5: Screenshots + Procedure Review + Trim

**Rationale:** Once a procedure is recorded, the workflow splits: in-procedure screenshots anchor the report, the review screen lets the doctor re-walk the procedure and trim the salient portion.
**Delivers:** Mid-procedure screenshot capture (canvas → JPEG → IPC → disk + DB row); review screen with `<video>` + scrubber + clickable timeline; trim CLI in main (or "trim" IPC that calls ffmpeg).
**Avoids:** Pitfalls 1 / 2 in the review path — never write to the original mp4, always `-c copy` to a new file on trim.

### Phase 6: Doctor Profile + Report Editor + PDF

**Rationale:** Doctor profile is the data source for the auto-filled clinic info in the PDF — must exist before report generation. PDF rendering is its own narrow concern; isolating it to Phase 6 keeps the renderer work small.
**Delivers:** Doctor profile editor (EN+AR name, clinic info, signature image, clinic logo); report editor (findings/diagnosis/recommendations + screenshot picker); draft → finalized state; PDF generation via `@react-pdf/renderer` from main.
**Avoids:** Pitfall 8 (PDF RTL) — verify by generating a sample EN + sample AR report at end of phase.

### Phase 7: Search + History + Audit + Arabic/RTL

**Rationale:** EN + AR + RTL is a hard ship-blocker for GCC. Search + audit are small, well-scoped additions; Phase 7 groups the cross-cutting finishing work.
**Delivers:** Search by date range / doctor; full audit log UI (who-did-what); EN + AR i18n with full RTL; document direction toggle.
**Avoids:** Pitfalls 7 + 8 (RTL in shadcn and PDF) — explicit RTL smoke test in CI.

### Phase 8: Licensing + Trial + Activation + N-API follow-up

**Rationale:** Licensing is the last gate before revenue; isolated to its own phase so it can be hardened without contaminating clinical code paths.
**Delivers:** Ed25519-signed `.lic` load + verify (main side); 14-day trial clock; vendor-side `gen-license.cjs` offline tool; machine-id generator (CPU + disk + MAC hashed); UI gate when license invalid.
**Avoids:** Pitfall 6 (license trivially bypassed) — signed payload, public key in binary, verification code frozen; N-API addon parked as a v1.1 follow-up.

### Phase Ordering Rationale

- **Patient → Procedure** (procedure attaches to patient): can't record before patients exist.
- **Capture → Recording** (device pickup before ffmpeg spawn): can't record without picking a device first.
- **Profile → Report** (report auto-fills from profile): can't generate PDF without clinic info.
- **Database → Everything persistent** (audit log has no destination without the DB).
- **i18n late** so translations cover the actual UI surface, not a moving target.
- **License last** so it's the gate, not a development friction.

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 4 (Recording):** ffmpeg args, DirectShow name quoting, segmentation tradeoff. Use Context7 + Windows DirectShow docs during plan-phase.
- **Phase 6 (Reports):** `@react-pdf/renderer` RTL bidi gotchas; React-only component-level rendering from Node. May need a small headless bridge.
- **Phase 8 (Licensing):** machine fingerprint stability across NIC swaps; Ed25519 verify in a frozen code path; N-API follow-up scoping.

Phases with standard patterns (skip research-phase):

- **Phase 1 (Scaffold):** electron-vite templates + shadcn-cli initialization.
- **Phase 2 (Database):** better-sqlite3 + migrations pattern is well-trodden.
- **Phase 5 (Screenshots + Review):** native `<video>` + canvas snapshots, no exotic deps.
- **Phase 7 (i18n + RTL):** i18next + Radix `dir` patterns are documented.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | User-locked; versions verified against current docs. |
| Features | HIGH | User-locked; GCC-specific items called out. |
| Architecture | HIGH | Standard Electron + sync SQLite + child process pattern; well-documented. |
| Pitfalls | HIGH | All derived from well-known Electron + ffmpeg + Windows capture failure modes. |

**Overall confidence:** HIGH.

### Gaps to Address

- **Exact `@react-pdf/renderer` RTL behavior on bidi mixed paragraphs** — needs a smoke test in Phase 6 plan. Mitigation: generate a sample Arabic report early; if bidi handling is insufficient, swap to a small HTML→PDF fallback (puppeteer) for that one report path only.
- **DirectShow exclusive-mode behavior** varies by EasyCap clone — needs phase 3 bench testing across the three known capture forms (EasyCap analog, HDMI digital, generic webcam).
- **Machine fingerprint stability** — if the clinic changes NICs, the `.lic` invalidates. Phase 8 plan should include a "reactivation allowed N times per year" mechanism (or document this as a known limitation up front).

## Sources

### Primary (HIGH confidence)
- `STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md` — all research synthesized inline by orchestrator (subagent path was unavailable in this runtime; see Workflow Notes).
- User brief — locked-in stack, schema, features, milestones, security baseline, storage layout, i18n.
- electron-vite official docs (electron-vite.org).
- Electron security guidance — `contextIsolation`, `sandbox`, `nodeIntegration: false`.
- better-sqlite3 README — sync API, WAL, backup mode, prepared statements.
- @react-pdf/renderer v4 docs — headless React rendering.
- ffmpeg DirectShow input docs.
- @noble/ed25519 docs — pure-JS Ed25519.

### Secondary (MEDIUM confidence)
- Common Electron + USB capture pitfalls (community-documented gotchas for EasyCap / generic DirectShow).
- shadcn/Radix RTL behavior — community-documented; specific component behavior requires Phase 7 smoke testing.

### Tertiary (LOW confidence)
- GCC-market specifics (vendor-tool skepticism, Arabic-first UI expectations) — informed inference; requires clinic feedback post-launch to validate.

---
*Research completed: 2026-07-31*
*Ready for roadmap: yes*

## Workflow Notes

- **Auto-mode was requested;** in this runtime, the `gsd-project-researcher` subagent type is not installed (model fallback would have been `agentrouter/claude-haiku-4-5-20251001`, which is not available on the active OpenCode runtime). Per the workflow's documented fallback ("Proceeding without research subagents — roadmap will be generated inline."), the orchestrator produced all four research files plus this summary inline using the user's brief as the primary input and the templates as the structure. All other workflow steps (`config-set`, `commit`, etc.) ran against the actual `gsd-tools.cjs` binary without issue.
