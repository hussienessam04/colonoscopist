// Locale-aware relative time formatting. v1 ships English only (per Plan 02-03 D-06);
// Phase 7 RTL pass swaps the locale and adds Arabic strings.
import { formatDistanceToNowStrict } from 'date-fns';

export function relativeTime(epochMs: number | null): string {
  if (epochMs === null || epochMs === undefined) return 'never';
  return formatDistanceToNowStrict(new Date(epochMs), { addSuffix: true });
}

// Phase 7 / Plan 07-02 — SRCH-01..03 + D-03: sortable + locale-stable
// procedure date string for the Patient List accordion expansion. Uses
// en-CA so the output is always `YYYY-MM-DD HH:MM` regardless of the
// host locale (per UI-SPEC: "stable + sortable"). The MM:SS portions
// remain 2-digit per plan-procedure-row contract.
export function formatProcedureDate(epochMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epochMs));
}
