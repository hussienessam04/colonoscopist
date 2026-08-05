// formatDurationHHMMSS — pure formatter used by Procedure Room timer + Procedure Review.
// ponytail: clamp negatives to 0 so a clock skew or stale startedAt never displays "-00:00:01".
export function formatDurationHHMMSS(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}