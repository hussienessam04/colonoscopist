// @vitest-environment node
// Unit tests for `safeInvoke` (src/renderer/src/lib/ipc-result.ts).
// Plan 08-10 — closes G-08-4 (renderer graceful degrade on gated-IPC
// failures). The discriminated-union check + the defensive catch are
// the two correctness levers.

import { describe, expect, it } from 'vitest';
import { safeInvoke } from '../../../src/renderer/src/lib/ipc-result';

describe('safeInvoke', () => {
  it('returns the typed success shape when the promise resolves with T', async () => {
    const rows = [{ id: 1, name: 'Alice' }];
    const out = await safeInvoke(Promise.resolve(rows));
    expect(out).toEqual(rows);
  });

  it("returns null when the gate returns {ok: false, code: 'IPC_LICENSE_INVALID'}", async () => {
    const out = await safeInvoke(
      Promise.resolve({ ok: false, code: 'IPC_LICENSE_INVALID' as const }),
    );
    expect(out).toBeNull();
  });

  it("returns null when the gate returns {ok: false, code: 'IPC_LICENSE_EXPIRED'}", async () => {
    const out = await safeInvoke(
      Promise.resolve({ ok: false, code: 'IPC_LICENSE_EXPIRED' as const }),
    );
    expect(out).toBeNull();
  });

  it('returns null when the promise rejects (defensive catch)', async () => {
    const out = await safeInvoke(Promise.reject(new Error('IPC unavailable')));
    expect(out).toBeNull();
  });

  it('returns null when the promise resolves with null/undefined (defensive)', async () => {
    const outNull = await safeInvoke(Promise.resolve(null));
    const outUndef = await safeInvoke(Promise.resolve(undefined));
    expect(outNull).toBeNull();
    expect(outUndef).toBeNull();
  });
});
