---
slug: report-editor-clinical-refresh
created: 2026-09-06
type: polish
source: ad-hoc user report (3 explicit + 1 design refresh)
---

# Quick Task: ReportEditor — drop bullet hint, instrument+premedication same row, conclusion+recommendation in the same grid, clinical refresh

## Issues

1. **Bullet hint text under each box is noise.**
   `Prefix the current line with a bullet (or bullet every
   selected line). Enter on a bullet line continues the list.`
   — the doctor doesn't need the hint inline. The `title` attr on
   the bullet button keeps the hint on hover. Drop the `<p>` line
   below each textarea.

2. **Instrument + Pre-medication override should sit on the same
   line.** Currently they're stacked (one `<div className="mt-3">`
   per control). Wrap them in a 2-column grid so they read as a
   single instrument-config row.

3. **Conclusion + Recommendation should join the 2-column grid**
   with the other anatomy boxes instead of being full-width below.

4. **Page looks generic / templated** — apply the
   `frontend-design` skill's principles to give it a deliberate,
   clinical point of view.

## Design direction (deliberate, not generic)

Subject: a colonoscopy procedure report editor on a single
clinical workstation. Audience: the doctor between cases.
Single job: capture procedure findings + instrument +
premedication + screenshots cleanly.

The page should feel like a **precision medical instrument** —
not a startup dashboard, not a consumer app, not a SaaS form.
Reference: clinical workstation software (think radiology /
pathology reading apps), where the visual language is calm,
structured, and a little clinical.

Palette (named hex):

- `--clinic-bg`       `#F7F1E6`  warm ivory / document paper
- `--clinic-surface`  `#FFFFFF`  white card surface
- `--clinic-rail`     `#EFEAE0`  right-rail tint (screenshots)
- `--clinic-ink`      `#13202E`  primary text (deep slate, not pure black)
- `--clinic-ink-2`    `#5C6770`  secondary text
- `--clinic-muted`    `#8C8478`  small-caps labels
- `--clinic-rule`     `#E0D9C6`  hairline dividers
- `--clinic-teal`     `#0E3A47`  clinical accent (procedure-type toggle, signature stripe)
- `--clinic-teal-tint` `#E6EFF1`  very soft teal background for the active toggle button
- `--clinic-coral`    `#C66B4D`  warm coral — action highlights (Finalize button)

Typography:

- Display heading (`h1`, kicker): `font-serif` Tailwind stack
  (`ui-serif, Georgia, Cambria, ...`) — gives the page title an
  editorial / clinical-instrument feel without bringing in a
  webfont dependency. Georgia + the right weight does the heavy
  lifting.
- Body: default `font-sans` (Inter via Tailwind's preflight
  already).
- Section labels: `text-[11px] uppercase tracking-[0.18em] font-medium`
  — the "FIELD" label treatment from clinical forms.

Signature element: a **4px vertical teal accent stripe** on the
left edge of the document article. Same stripe used to underline
the active procedure-type toggle button. Subtle, distinctive,
not generic.

Layout changes (all the explicit asks):

- Drop the `<p className="mt-1 text-xs text-slate-500">…</p>` hint
  line under each textarea.
- Wrap instrument + premedication in
  `<div className="grid grid-cols-1 gap-4 md:grid-cols-2 mt-4">`.
- Move Conclusion + Recommendation INTO the
  `report-editor-anatomy-grid` so they're in the same 2-col
  layout as the anatomy boxes.

## Scope

- `src/renderer/src/pages/ReportEditor.tsx`:
  - Drop the bullet-hint `<p>` line in `renderBox`.
  - Restructure instrument + premedication into a 2-col grid.
  - Move conclusion + recommendation into the anatomy grid.
  - Refresh surface colors (`slate-50` → ivory), section labels
    (small-caps + tracking), box treatment (subtle teal tint on
    focus), accent stripe on the article left edge.
- No new components, no new translations, no new IPC.

## Verification

- Existing tests should still pass (data-testids unchanged).
- Manual: open the page, verify the bullet hint is gone,
  instrument + premedication share a row, conclusion +
  recommendation share a row with the anatomy boxes, and the
  document reads as a clinical chart (not a generic dashboard).

## Out of scope

- New font imports (Georgia via Tailwind's serif stack is enough).
- Dark mode (the clinic is daylight-lit; dark mode can be a
  follow-up).
- Animated page-load reveal (clinical workstation software
  shouldn't feel showy).
