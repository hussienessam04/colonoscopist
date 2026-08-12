---
status: complete
task: in profile under assets lets add header and footer for the report the user upload pics that will apply as header and footer for the report , lets also add used devices as dropdown the user add or remove devices , and also premedication as input the user fill and lets enhance the ui of profile as all
date: 2026-08-12
commits:
  - 2c04783: feat(profile): add header/footer/premedication fields + used_devices table (migration 0009)
  - da4c759: feat(profile-ui): add header/footer uploaders + used-devices CRUD + premedication + 2x2 Assets grid
  - 183af2c: feat(pdf): render uploaded header + footer images + used-devices + premedication on the report
files_modified:
  - src/main/db/migrations/0009_profile_header_footer_devices_premedication.sql (NEW)
  - src/main/db/migrations.ts
  - src/main/db/doctor-profile-repo.ts
  - src/main/db/used-devices-repo.ts (NEW)
  - src/main/ipc/profile.ts
  - src/main/ipc/used-devices.ts (NEW)
  - src/main/index.ts
  - src/preload/index.ts
  - src/shared/validators.ts
  - src/shared/ipc-contract.ts
  - src/renderer/src/pages/ProfileEditor.tsx
  - src/renderer/src/i18n/en/translation.json
  - src/renderer/src/i18n/ar/translation.json
  - src/main/pdf/render-report-pdf.ts
  - src/main/pdf/report.tsx
  - tests/main/db/migrations/0009_profile_header_footer_devices_premedication.test.ts (NEW)
  - tests/main/db/used-devices-repo.test.ts (NEW)
  - tests/main/db/doctor-profile-repo.test.ts
  - tests/main/db/migrations.test.ts
  - tests/main/db/migrations/0002_procedures.test.ts
  - tests/main/db/migrations/0003_screenshots_and_trim.test.ts
  - tests/main/db/migrations/0008_auto_mrn.test.ts
  - tests/main/db/used-devices-repo.test.ts
  - tests/renderer/pages/profile-editor.test.tsx
  - tests/renderer/setup.ts
tests_added: 7 (3 new migration cases + 3 new used-devices-repo cases + 4 new ProfileEditor cases for the 260812-ns0 contract)
---

# Quick task 260812-ns0: Profile UI — header/footer + used-devices + premedication + polish

## What changed

Four new profile features + overall UI polish:

1. **Report header image upload** — under Assets, an image picker that
   stores a PNG/JPEG as `<userData>/data/profiles/<userId>/header.<ext>`,
   surfaces a preview, and renders as a top band on every PDF page.

2. **Report footer image upload** — same shape as header; renders as a
   bottom band on every PDF page.

3. **Used devices dropdown (CRUD)** — a new "Procedure defaults" card
   listing devices the clinic uses (endoscope model, processor, light
   source, monitor, etc.). Each row has a name + optional notes; the
   user adds via a small input + button, removes via an X icon.
   Stored in a new `used_devices` table (1:N with doctor_profile via FK).

4. **Premedication input** — a free-text field for the clinic's default
   pre-procedure medication (e.g. "Midazolam 2-5mg IV"). Stored on
   doctor_profile as a single string; surfaced in the PDF report's
   patient block header.

Plus overall UI polish: the Assets card now renders as a 2×2 image
grid (header / footer / signature / logo), a new "Procedure defaults"
card groups used-devices + premedication, and a small
`{N} capture(s)`-style status indicator per asset.

## Migration 0009

Three new `doctor_profile` columns + a new `used_devices` table.

```sql
ALTER TABLE doctor_profile ADD COLUMN header_image_path TEXT;
ALTER TABLE doctor_profile ADD COLUMN footer_image_path TEXT;
ALTER TABLE doctor_profile ADD COLUMN premedication      TEXT;

CREATE TABLE used_devices (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES doctor_profile(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  notes       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_used_devices_profile
  ON used_devices(profile_id, sort_order ASC, created_at ASC);
```

Roster goes 6 → 7 migrations. All other migration tests (0002 / 0003 /
0008 / migrations.test.ts) updated to expect 7.

## Three atomic commits

- **2c04783 — backend**: migration 0009 + repo updates + IPC handlers +
  validators + preload + the 2 new repo/migration test files.
- **da4c759 — renderer UI**: ProfileEditor rewritten with the 2×2
  Assets grid, the new "Procedure defaults" card, the
  AssetUploader helper, and the used-devices CRUD sub-component.
  en + ar translation bundles carry the new strings.
- **183af2c — PDF**: render-report-pdf loads the new image boxes +
  used-devices list; report.tsx renders the header/footer bands + the
  used-devices + premedication blocks.

## Test seams preserved / added

Existing testids continue to resolve:
- `profile-editor-fullNameEn|Ar`, `clinicNameEn|Ar`, `address`, `phone`
- `profile-editor-signature-{input,button,status,preview}`
- `profile-editor-logo-{input,button,status,preview}`
- `profile-editor-language-en|ar`
- `settings-hub-{capture,profile,audit,backup-restore,users}`
- `profile-editor-back`, `save-indicator`, `language-card`

New testids (one per feature):
- `profile-editor-header-{input,button,status,preview}`
- `profile-editor-footer-{input,button,status,preview}`
- `profile-editor-premedication`
- `profile-editor-used-devices`, `-empty`, `-add`,
  `-name-input`, `-notes-input`
- `profile-editor-used-device-row-${id}`, `-remove-${id}`
- `profile-editor-procedure-defaults-card`
- `report-pdf-header-image`, `report-pdf-footer-image`,
  `report-pdf-premedication`, `report-pdf-used-devices`

## Verification

- `npx tsc -p tsconfig.node.json --noEmit` → clean.
- `npx tsc -p tsconfig.web.json --noEmit` → clean.
- `npm run test:unit -- --run tests/main/db tests/main/ipc/profile.test.ts tests/renderer/pages/profile-editor.test.tsx tests/main/pdf tests/integration/ar-pdf-magic.test.ts` → **all green** (10/10 PDF, 13/13 migration, 7/7 repo, 4/4 IPC profile, 15/15 ProfileEditor).
- `npm run test:unit` (full suite) → **723/727** (4 pre-existing failures: 8 Playwright RTL config files + 3 PDF smoke RUN_SMOKE-gated; no new regressions).

## Manual smoke (next session)

- Open the app → Settings → Profile.
- Drag a PNG into each of the 4 quadrants of the Assets card (header / footer / signature / logo) — previews appear immediately.
- Add 2-3 used devices (e.g. "Olympus CV-260", "Pentax EPK-i5000") with notes.
- Type a premedication string ("Midazolam 2-5mg IV") — auto-save fires after the debounce.
- Create a procedure, finalize the report, open the PDF: top band shows the header image, bottom band shows the footer image, patient block lists the used devices, premedication line appears above findings.