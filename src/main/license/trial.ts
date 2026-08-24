// Phase 8 / Plan 02 — trial clock reader (LIC-01).
// Per CONTEXT D-01 + D-02: the trial clock lives on `settings.trial_started_at`.
// The wizardBootstrap transaction writes the row once on the first launch
// (no `ON CONFLICT UPDATE` per D-01 verbatim — first-write-wins). This
// module READS the row on every boot — it never writes.
//
// The 14-day constant is inlined here (one source of truth); the renderer
// computes the countdown from `LicenseStatus.trialDaysRemaining` which
// is derived from `expiresAt - now` below. Per RESEARCH §Pattern 4 the
// shape is the discriminated union that `status.ts:computeLicenseStatus()`
// consumes.

import { getDb } from '../db';

const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

export type TrialState =
  | { state: 'trial'; daysRemaining: number; expiresAt: number }
  | null;

export function readTrialStartedAt(): number | null {
  const row = getDb()
    .prepare(`SELECT value FROM settings WHERE key = 'trial_started_at'`)
    .get() as { value: string } | undefined;
  if (!row) return null;
  const parsed = parseInt(row.value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function getTrialState(now: number = Date.now()): TrialState {
  const startedAt = readTrialStartedAt();
  if (startedAt === null) return null;
  const expiresAt = startedAt + TRIAL_DURATION_MS;
  const remaining = expiresAt - now;
  if (remaining <= 0) return null; // expired — falls through to 'expired' state in status.ts
  const daysRemaining = Math.ceil(remaining / (24 * 60 * 60 * 1000));
  return { state: 'trial', daysRemaining, expiresAt };
}

export { TRIAL_DURATION_MS };