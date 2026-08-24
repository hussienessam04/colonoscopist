// @vitest-environment node
// Phase 8 / Plan 01 — fingerprint.test.ts (LIC-02 + D-12).
//
// Per the plan <behavior> block: 4+ cases cover hash stability, the
// `__diskSerialForTest` test seam, the degraded empty-disk-serial path,
// and MAC selection logic. The spawn is mocked via the seam so the
// test never shells out.

import { afterEach, describe, expect, it } from 'vitest';
import { hashFingerprint } from '../../../src/main/license/verify';
import { __fingerprint, computeMachineFingerprint } from '../../../src/main/license/fingerprint';

describe('hashFingerprint (LIC-02)', () => {
  it('is deterministic for the same inputs', () => {
    const a = hashFingerprint({ cpuModel: 'cpu', diskSerial: 'disk', mac: 'mac' });
    const b = hashFingerprint({ cpuModel: 'cpu', diskSerial: 'disk', mac: 'mac' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs when any input differs', () => {
    const a = hashFingerprint({ cpuModel: 'cpu-1', diskSerial: 'disk', mac: 'mac' });
    const b = hashFingerprint({ cpuModel: 'cpu-2', diskSerial: 'disk', mac: 'mac' });
    const c = hashFingerprint({ cpuModel: 'cpu-1', diskSerial: 'disk', mac: 'mac-2' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('with empty disk serial still produces a 64-char hex (degraded path)', () => {
    const result = hashFingerprint({ cpuModel: 'cpu', diskSerial: '', mac: 'mac' });
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('computeMachineFingerprint (D-12 + Pitfall 5)', () => {
  afterEach(() => {
    __fingerprint.__diskSerialForTest = null;
  });

  it('returns 64-char hex when disk serial is mocked via the test seam', async () => {
    __fingerprint.__diskSerialForTest = 'abc123';
    const result = await computeMachineFingerprint();
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('degraded path: empty disk serial still produces 64-char hex', async () => {
    __fingerprint.__diskSerialForTest = '';
    const result = await computeMachineFingerprint();
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different disk serials produce different fingerprints', async () => {
    __fingerprint.__diskSerialForTest = 'disk-A';
    const a = await computeMachineFingerprint();
    __fingerprint.__diskSerialForTest = 'disk-B';
    const b = await computeMachineFingerprint();
    expect(a).not.toBe(b);
  });
});