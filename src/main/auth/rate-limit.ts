// In-memory exponential backoff map for the live cooldown between failed PIN attempts.
// Per Fix 2 + AUTH-02.
// Persistent counter lives on users.failed_attempts / users.locked_until / users.is_locked.
// On the 10th failure, callers set locked_until to the sentinel
// '9999-12-31T23:59:59Z'.valueOf() AND is_locked = 1 to mark indefinite lockout.

export const SENTINEL_LOCKED_UNTIL = Date.UTC(9999, 11, 31, 23, 59, 59);
export const LOCKOUT_THRESHOLD = 10;
export const MAX_BACKOFF_MS = 60_000;

export const backoff = new Map<string, number>();

export function nextBackoffMs(attempts: number): number {
  return Math.min(1000 * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

export function clearBackoff(userId: string): void {
  backoff.delete(userId);
}