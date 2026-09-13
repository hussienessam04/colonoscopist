// ponytail: safeInvoke wraps gated IPC calls so the renderer never crashes
// when the main-process gate returns { ok: false, code: ... }. Per Plan 03:
// "Gate returns { ok: false, code: ... } as a return value (NOT
// a thrown IpcErrorException) so the renderer SWR-style consumer pattern
// can branch on ok: false uniformly". Plan 03 documented the contract;
// this helper enforces it at the call site.
//
// Returns T on success, null on gate rejection. Caller decides the
// empty-state UX (typically the shared EmptyStateCard component).

export type IpcInvokeResult<T> = T | { ok: false; code: string } | null | undefined;

export async function safeInvoke<T>(p: Promise<IpcInvokeResult<T>>): Promise<T | null> {
  try {
    const res = await p;
    if (res == null) return null;
    if (typeof res === 'object' && 'ok' in res && res.ok === false) return null;
    return res as T;
  } catch {
    // Defensive: some IPC calls may still throw (e.g., IpcErrorException
    // from non-gated channels). Treat any throw as null — caller renders
    // empty state.
    return null;
  }
}

// isGateRejected — quick task 260913-rp5 follow-up.
//
// safeInvoke collapses BOTH gate rejections AND legitimate null returns
// into a single `null` value. Pages that need to distinguish "license
// issue" from "no data" (e.g. SettingsCapture showing the EmptyStateCard
// when the user has no USB device plugged in but IS licensed) check the
// raw IPC response shape with this guard before falling back to
// safeInvoke.
//
// Returns true if the raw response is the gate-rejection shape
// `{ok: false, code: string}`; false otherwise (including for null).
export function isGateRejected(raw: unknown): raw is { ok: false; code: string } {
  if (raw === null || raw === undefined) return false;
  if (typeof raw !== 'object') return false;
  if (!('ok' in raw)) return false;
  return (raw as { ok: unknown }).ok === false;
}
