// Locale-aware relative time formatting. v1 ships English only (per Plan 02-03 D-06);
// Phase 7 RTL pass swaps the locale and adds Arabic strings.
import { formatDistanceToNowStrict } from 'date-fns';

export function relativeTime(epochMs: number | null): string {
  if (epochMs === null || epochMs === undefined) return 'never';
  return formatDistanceToNowStrict(new Date(epochMs), { addSuffix: true });
}
