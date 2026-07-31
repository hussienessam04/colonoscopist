# Feature Research

**Domain:** Endoscopy / procedure-room recorder & reporter (small clinic, GCC)
**Researched:** 2026-07-31
**Confidence:** HIGH (features are explicitly listed in the user brief; categorization is straightforward)

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| PIN-based multi-user login on a shared workstation | Clinics share PCs across doctors on shifts; per-user accountability via audit log | LOW | No password reset flow needed for v1; admin sets PINs. |
| Patient CRUD with name, DOB, gender, MRN, phone, notes | Small clinic data model — anything less is non-viable | LOW | MRN is free-text (clinic-specific prefix). |
| Search patients by name and MRN | Patients return; finding the previous record fast is core flow | LOW | Use SQLite FTS5 or LIKE queries; FTS5 is correct at this scale. |
| Procedure record (mp4) with device pickup + timer | The product's reason to exist | MEDIUM | Driver is `ffmpeg-static` child process + timer in main. |
| Live preview during recording | Doctor needs to point the scope; preview is the UI's hero feature | MEDIUM | Renderer uses `getUserMedia` for the preview; ffmpeg records separately (two streams, same device, both work). |
| Take screenshots mid-procedure | Doctors mark findings as stills, not just video; review-time skipping | LOW | Snapshot frame from preview `<video>` element via canvas → JPEG. |
| Procedure review (video + scrubber + screenshot timeline) | After-procedure editing is where the report is shaped | MEDIUM | Use a small subset of `<video>` controls or `react-player` only if needed; prefer native HTML. |
| Basic trim (cut start/end) | Procedures start with setup frames and end with withdrawal — trim to the diagnostic part | MEDIUM | Use ffmpeg `-ss` / `-t` on a copy of the source; never edit in place. |
| PDF report with auto-filled doctor + clinic info, findings/diagnosis/recommendations, attached screenshots | The deliverable; without it the recording alone has no value | MEDIUM | `@react-pdf/renderer`, doctor profile is the single source of clinic info. |
| Draft + finalized report states | Reports get reviewed before going out the door | LOW | Boolean field + finalize timestamp; PDF is generated from the JSON on demand or cached at finalize. |
| Device dropdown (Settings) | Doctors swap scopes between patients; settings page prevents re-pick every time | LOW | List stored devices; remember last-used per doctor. |
| Quality presets (SD/HD/Custom) | EasyCap is 720×480 NTSC/PAL, digital cards are 1920×1080; presets remove guesswork | LOW | Three named presets + freeform resolution + fps. |
| Backup (zip data folder) + Restore | Without backup, a single disk failure loses patient data — clinically unacceptable | LOW | `archiver` + `extract` from zip. |
| Audit log of every login, view, edit | Regulator will ask; clinic owner will ask; needed for both | LOW | Append-only table; include user_id, action, entity_type, entity_id, metadata_json, created_at. |
| English + Arabic + full RTL | GCC market; Arabic is primary for many clinics | MEDIUM | i18next + RTL-aware Tailwind config + RTL-tested shadcn components. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Offline-only activation (Ed25519 signed `.lic` file) | Sells to clinics that distrust internet-tethered software; zero phone-home | MEDIUM | Generate `.lic` locally with a CLI tool the vendor keeps offline. |
| Generic DirectShow capture (no vendor SDK) | One binary works with EasyCap, HDMI cards, webcams; no per-vendor licensing | MEDIUM | Acceptable trade: lose vendor-specific scope controls, gain portability. |
| Local PII encrypted at rest via safeStorage | Defense-in-depth against stolen-disk attacks; differentiates from sqlite-with-password | LOW | Encrypt PIN hash and any other PII fields deemed sensitive at column level. |
| One-time perpetual license, no subscription | Matches GCC clinic buying habits; recurring payments are friction | LOW | The license tooling is the only asset here — just don't ship a subscription UI. |
| Procedure screenshot timeline that's clickable to jump | Faster recall than scrubbing a long video | LOW | Render thumbnails at fixed spacing (e.g., every 10s or every screenshot, whichever is fewer). |
| Arabic-first report PDF | Many systems print English in a clinic where Arabic is the working language | MEDIUM | @react-pdf/renderer supports RTL text passes — verify with a printed test page. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Cloud sync of patient data | "What about backups?" | Violates offline-only mandate; PII boundary; introduces ops/regulatory load | Local zip backup to USB drive, documented for the clinic |
| DICOM / PACS integration | "Industry standard!" | Adds regulatory burden (HIPAA-style controls), per-vendor negotiation, no v1 customer has asked | Generic mp4 + JPEG; document path to DICOM for v2 |
| AI polyp detection | Buzzword | Regulatory device-class question; needs a labeled dataset; not v1 scope | Manual screenshot annotation in the report PDF |
| Billing / scheduling / insurance | "Make it a full EMR" | Out of core value; doubles surface area; competes with existing EMR vendors | Single-focus record-and-report tool; defer |
| Speech-to-text dictation | Hands are gloved, dictation is convenient | Edge model footprint, accuracy on medical vocabulary, dictation in Arabic — big project | Free-text findings field; doctor types or dictates via OS-level tool |
| Mobile companion app | "I want to view on phone" | Doubles the security/perf surface; v1 is Windows-only; patients can't see their report anyway (PDF print/email) | PDF export via the OS, then email/SMS/etc. via the clinic's existing tools |
| Real-time multi-user collaboration | "What if two doctors see the same patient" | Network state, locking, conflicts; clinic scale doesn't need it | Single-user-at-a-time with audit trail |
| Multi-clinic central admin | "I run a chain" | Requires cloud; out of v1 entirely | Each workstation licenses independently; one machine-id → one `.lic` file |

## Feature Dependencies

```
Patient CRUD
  └── required by ──> Procedure
  └── required by ──> Report

Doctor Profile
  └── required by ──> Report (auto-fill signature + clinic info)

Device Enumeration
  └── required by ──> Procedure Capture

Procedure Capture
  └── required by ──> Procedure Review
  └── required by ──> Report (video path)

Screenshots
  └── required by ──> Procedure Review (timeline)
  └── required by ──> Report (attach screenshots)

Ed25519 License
  └── guards every feature behind the splash
```

### Dependency Notes

- **Patient CRUD before Procedure:** A procedure record is meaningless without a patient.
- **Doctor profile before Report:** Reports auto-fill from the active doctor's clinic info; missing profile means nothing to put in the PDF header.
- **Capture before Review:** Review player reads the recorded mp4 path the procedure stored; nothing to review without a record.
- **Screenshots before Report-attach:** The report's screenshot picker reads from the procedure's screenshot rows.
- **Audit log parallels everything:** Login, view, edit all hit `audit_log` regardless of which feature fired.

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed to validate the concept.

- PIN login + per-doctor profile (with signature + clinic logo upload) — clinic can hand the workstation to a doctor
- Patient CRUD + MRN/name search — clinic can enter and find patients
- Live preview + record to mp4 with timer — the core product
- Mid-procedure screenshots → tied to procedure timeline — the differentiator vs vanilla recorder
- Procedure review with scrubber + clickable screenshot timeline — doctor can re-walk the procedure
- PDF report (auto-filled doctor/clinic info, with findings/diagnosis/recommendations, attachable screenshots, draft → finalized) — the deliverable
- Settings: device picker + quality presets + storage path — clinic can configure once
- Backup (zip data) + restore — clinic can safely store data
- Audit log — clinic owner / regulator can answer "who did what, when"
- EN + AR + RTL — required to ship into GCC
- Offline Ed25519 license activation with 14-day trial — required to monetize

### Add After Validation (v1.x)

- Basic trim (cut start/end of recorded procedure) — nice but the in-procedure screenshots + scrubber cover most review pain for v1
- Search by date range / doctor — table stakes for small scale, but launch-validation comes first
- Storage path customization + multiple workspaces

### Future Consideration (v2+)

- Speech-to-text dictation — if requested by a clinic and Arabic STT model matures
- AI polyp suggestion overlay — only after regulators in GCC publish guidance
- Mobile companion app — only if a chain-clinic customer asks
- DICOM export — only if a hospital partnership demands it

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| PIN login + doctor profile | HIGH | LOW | P1 |
| Patient CRUD + search | HIGH | LOW | P1 |
| Live preview + mp4 record | HIGH | MEDIUM | P1 |
| Mid-procedure screenshots | HIGH | LOW | P1 |
| Procedure review + scrubber + timeline | HIGH | MEDIUM | P1 |
| PDF report (auto-fill, draft/finalize, screenshots) | HIGH | MEDIUM | P1 |
| Audit log | HIGH | LOW | P1 |
| Backup/restore (zip) | HIGH | LOW | P1 |
| Ed25519 license + 14-day trial | HIGH | MEDIUM | P1 |
| EN + AR + RTL | HIGH | MEDIUM | P1 |
| Settings: device + quality presets + storage | MEDIUM | LOW | P1 |
| Basic trim (cut start/end) | MEDIUM | MEDIUM | P2 |
| Search by date range / doctor | MEDIUM | LOW | P2 |
| Multiple workspaces / per-doctor storage quotas | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when v1 ships successfully
- P3: Nice to have, future consideration

## Competitor Feature Analysis

Note: niche market (GCC small clinics, generic capture) — direct competitors are few. The closest analogs are Olympus EndoBase, Pentax ENDO VIEW, and bespoke clinic tools; comparison below treats them as directional rather than exact.

| Feature | Olympus EndoBase | Pentax ENDO VIEW | Our Approach |
|---------|------------------|--------------------|--------------|
| Capture device integration | Vendor-locked to Olympus processors | Vendor-locked to Pentax | Generic DirectShow capture — works with EasyCap + HDMI cards + webcams |
| Cloud | Often included (server-based) | Server-based | Local-only, zip backup |
| License | Per-processor / per-doctor subscription | Per-processor | One-time perpetual, single workstation |
| PDF reports | Vendor template, often English | Vendor template | Auto-filled from doctor profile, EN+AR with RTL |
| Audit | Yes | Yes | Yes (append-only `audit_log`) |

The vendor products are expensive, vendor-locked, and English-only. Colonoscopist's positioning: **the offline, generic-capture, AR-first recorder/reporter for small clinics that don't have an Olympus budget.**

## Sources

- User brief (locked-in milestone map + feature list)
- Common scope for small-clinic procedure tools (sector knowledge)
- GCC market considerations (Arabic + RTL requirement, vendor-tool skepticism)
- Cost-of-bundled-vs-OCR/AI/DICOM trade-offs

---
*Feature research for: Colonoscopist (Electron desktop, offline, GCC clinics)*
*Researched: 2026-07-31*
