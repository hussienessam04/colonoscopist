---
slug: procedure-review-ui-enhance
created: 2026-09-07
type: redesign
source: ad-hoc user request — frontend-design skill, Report Editor style
---

# Quick Task: enhance Procedure Review UI using frontend-design skill (Report Editor style)

## Goal

Apply the same visual language that lives on the
`ReportEditor.tsx` page (warm ivory + white document surface,
deep teal `#0E3A47` accent, small-caps section labels,
mono date/duration values, teal-tinted primary actions,
serif page title) to the `ProcedureReview.tsx` page — the
doctor's video-playback + screenshots + trim surface.

## Source of truth

- **Target page**: `src/renderer/src/pages/ProcedureReview.tsx`
- **Style source**: `src/renderer/src/pages/ReportEditor.tsx`
  (the page that introduced the "clinical workstation" look
  via quick task 20260906-report-editor-clean-refresh).

## Existing design tokens to reuse

From `ReportEditor.tsx`:

- Bg: `bg-slate-50` (page) + `bg-[#FBF7EE]` (document surface)
  + `bg-[#E6EFF1]` (teal-tinted cards) + `bg-white` (pure
  cards)
- Borders: `border-[#E0D9C6]` (warm ivory hairline) +
  `border-[#cbd5e1]` (slate hairline for inner rules)
- Accent: `#0E3A47` (deep teal) for primary button bg +
  active state + signature stripe
- Coral: `#C66B4D` for Finalize-style primary actions
- Ink: `#13202E` for body text
- Slate: `#5C6770` for secondary text / outline buttons
- Sand: `#8C8478` for small-caps labels (uppercase +
  `tracking-[0.18em]`)
- Mono: `font-mono tabular-nums` for date / duration /
  countdown / filename values
- Serif page title: `font-serif` (Georgia stack) for h1
- Small-caps clinical label: `text-[11px] font-semibold
  uppercase tracking-[0.18em] text-[#0E3A47]`

## Scope

Refactor `ProcedureReview.tsx` so the existing layout
(video left / scrubber + screenshots middle / notes +
trim right rail) picks up the Report Editor palette +
typography + control style. Includes:

1. **Page shell** — wrap the whole page in the same
   `bg-slate-50` outer + `bg-[#FBF7EE]` document card pattern
   the Report Editor uses. The video player + scrubber +
   timeline + side rails sit inside one rounded
   `bg-[#FBF7EE]` document surface with hairline
   `border-[#E0D9C6]` rule (matches the editor's outer
   card). 

2. **Header band** — same shape as the Report Editor:
   - Left: small-caps kicker (`t("procedure.pageKicker")`)
     + serif h1 (PatientPatient, ProcedureProcedure name)
   - Right: mono date + duration values + StatusBadge + a
     teal-tinted secondary action (e.g. "Open report" → the
     ReportEditor route)
   - Top-right tertiary action: Back to patients (slate
     outline, `lucide-react` `ArrowLeft`)

3. **Video card** — left column `bg-white` rounded card with
   hairline border. Replaces the current `Card` shadcn
   primitive (which uses the slate system colors).
   - Inside: `<video>` element + the existing DeviceLostBanner
     sits on top of the player when partial.
   - Bottom bar: small-caps "Play / Pause" + a teal-tinted
     `Button` primary + capture button (coral accent on
     capture for distinction) + mono duration counter.

4. **Scrubber + Screenshot timeline** — share a card with the
   same `bg-white` rounded + `border-[#E0D9C6]` rule as the
   video card (currently they're a separate card stack).
   Keep the existing Scrubber tick + dot rendering — just
   swap the surrounding card chrome for the new tokens.

5. **Side rail (right)** — wrap the right rail
   (`ProcedureNotesReview` + `TrimControls` + the
   `StatusBadge` block) in a tinted teal card
   `bg-[#E6EFF1]` with the same `border-[#E0D9C6]` rule.
   Keep the existing internals; only update the chrome
   around them + the section titles (small-caps teal).

6. **Action buttons** — primary "Finish & report" stays coral
   `#C66B4D` (matches Finalize). Secondary outline stays
   slate (`text-[#5C6770] bg-white border-[#E0D9C6]`).
   The Back button stays slate outline.

## Files touched

- `src/renderer/src/pages/ProcedureReview.tsx` — refactor
  chrome (page shell + cards + button styles). No data
  flow changes; no IPC contract changes; no new
  components.

## Verification

- `npm run typecheck` (node + web) → exits 0.
- `npx vitest run` for any ProcedureReview / Scrubber /
  ScreenshotTimeline / TrimControls tests → all still pass
  (the data-testids stay unchanged).
- Manual: open a procedure with a finalized video → page
  renders with the warm ivory document surface + teal
  accents + small-caps labels + serif h1, all consistent
  with the Report Editor.

## Out of scope

- New patient-creating flow + report-creating route button
  wiring (keep the existing "Edit report" / "Generate
  report" CTA the page already has).
- Trim + Notes component internals — they stay as-is; only
  the surrounding chrome changes.
- Animation polish (out of scope of a quick task).
- Light-mode vs dark-mode handling (the app already
  targets the warm-ivory palette; nothing else).