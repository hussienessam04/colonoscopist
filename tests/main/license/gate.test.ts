// @vitest-environment node
// Phase 8 / Plan 03 — gate.test.ts (LIC-04 + D-07 verbatim).
//
// Per the plan <behavior> block: 7+ cases cover the licenseGated wrapper
// surface in isolation:
//   1. exempt channel returns the handler unchanged (identity check)
//   2. non-exempt + state='unactivated' returns IPC_LICENSE_INVALID + audit row
//   3. non-exempt + state='expired' returns IPC_LICENSE_EXPIRED + audit row
//   4. non-exempt + state='trial' lets the handler run normally
//   5. non-exempt + state='licensed' lets the handler run normally
//   6. exempt + state='unactivated' lets the handler run normally
//   7. exempt + state='expired' lets the handler run normally
//   8. audit row shape: action='license.gate_rejected', metadata carries
//      { channel, fingerprintHash, code }, user_id IS NULL
//
// The tests stub `getLicenseStatus()` + the audit helper via vi.mock so
// the gate wrapper can be exercised without a real DB or fingerprint
// spawn.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeAuditRow {
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: 'ok' | 'failed' | 'rate_limited';
  userId: string | null;
  metadata: Record<string, unknown> | null;
}

const capturedAudits: FakeAuditRow[] = [];
const statusByState: Record<
  'unactivated' | 'expired' | 'trial' | 'licensed',
  { state: string; machineId: string }
> = {
  unactivated: { state: 'unactivated', machineId: 'a'.repeat(64) },
  expired: { state: 'expired', machineId: 'b'.repeat(64) },
  trial: { state: 'trial', machineId: 'c'.repeat(64) },
  licensed: { state: 'licensed', machineId: 'd'.repeat(64) },
};

// ponytail: a string variable lets each test set the desired state via
// `mockGetLicenseStatus.mockResolvedValue(...)` cleanly. Resetting in
// beforeEach avoids bleed-over between cases.
let activeState: 'unactivated' | 'expired' | 'trial' | 'licensed' = 'licensed';
const mockGetLicenseStatus = vi.fn(async () => statusByState[activeState]);

vi.mock('../../../src/main/license/status', () => ({
  getLicenseStatus: () => mockGetLicenseStatus(),
}));

vi.mock('../../../src/main/db/audit', () => ({
  audit: (opts: FakeAuditRow) => {
    capturedAudits.push({
      action: opts.action,
      entityType: opts.entityType,
      entityId: opts.entityId,
      outcome: opts.outcome,
      userId: opts.userId,
      metadata: opts.metadata,
    });
  },
}));

beforeEach(() => {
  activeState = 'licensed';
  capturedAudits.length = 0;
  mockGetLicenseStatus.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('gate.ts — licenseGated wrapper (LIC-04)', () => {
  it('exempt channel returns the handler unchanged (identity check)', async () => {
    const { licenseGated, EXEMPT_CHANNELS } = await import(
      '../../../src/main/license/gate'
    );
    const fakeHandler = vi.fn(() => 'handler-return');
    const wrapped = licenseGated('auth:login', fakeHandler as never);
    expect(EXEMPT_CHANNELS.has('auth:login')).toBe(true);
    // identity — should be the same function reference (the EXEMPT path
    // returns the handler unchanged).
    expect(wrapped).toBe(fakeHandler);
  });

  it("non-exempt + state='unactivated' returns IPC_LICENSE_INVALID + emits an audit row", async () => {
    activeState = 'unactivated';
    const { licenseGated } = await import('../../../src/main/license/gate');
    const fakeHandler = vi.fn(() => 'should-never-run');
    const wrapped = licenseGated('patients:list', fakeHandler as never);

    const eventStub = { sender: null } as never;
    const result = await wrapped(eventStub, { search: 'foo' });

    expect(result).toEqual({ ok: false, code: 'IPC_LICENSE_INVALID' });
    expect(fakeHandler).not.toHaveBeenCalled();
    expect(capturedAudits).toHaveLength(1);
    const row = capturedAudits[0];
    expect(row?.action).toBe('license.gate_rejected');
    expect(row?.entityType).toBe('license');
    expect(row?.entityId).toBe('patients:list');
    expect(row?.outcome).toBe('failed');
    expect(row?.userId).toBeNull();
    expect(row?.metadata).toEqual({
      channel: 'patients:list',
      fingerprintHash: 'a'.repeat(64),
      code: 'IPC_LICENSE_INVALID',
    });
  });

  it("non-exempt + state='expired' returns IPC_LICENSE_EXPIRED + emits an audit row", async () => {
    activeState = 'expired';
    const { licenseGated } = await import('../../../src/main/license/gate');
    const fakeHandler = vi.fn(() => 'should-never-run');
    const wrapped = licenseGated('procedures:create', fakeHandler as never);

    const eventStub = { sender: null } as never;
    const result = await wrapped(eventStub, { patientId: 'p1' });

    expect(result).toEqual({ ok: false, code: 'IPC_LICENSE_EXPIRED' });
    expect(fakeHandler).not.toHaveBeenCalled();
    expect(capturedAudits).toHaveLength(1);
    const row = capturedAudits[0];
    expect(row?.action).toBe('license.gate_rejected');
    expect(row?.metadata).toEqual({
      channel: 'procedures:create',
      fingerprintHash: 'b'.repeat(64),
      code: 'IPC_LICENSE_EXPIRED',
    });
    expect(row?.userId).toBeNull();
  });

  it("non-exempt + state='trial' lets the handler run normally (no rejection)", async () => {
    activeState = 'trial';
    const { licenseGated } = await import('../../../src/main/license/gate');
    const fakeHandler = vi.fn(() => ({ rows: [], total: 0 }));
    const wrapped = licenseGated('patients:list', fakeHandler as never);

    const eventStub = { sender: null } as never;
    const result = await wrapped(eventStub, { search: 'foo' });

    expect(fakeHandler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ rows: [], total: 0 });
    expect(capturedAudits).toHaveLength(0);
  });

  it("non-exempt + state='licensed' lets the handler run normally", async () => {
    activeState = 'licensed';
    const { licenseGated } = await import('../../../src/main/license/gate');
    const fakeHandler = vi.fn(() => ({ ok: true }));
    const wrapped = licenseGated('procedures:create', fakeHandler as never);

    const eventStub = { sender: null } as never;
    const result = await wrapped(eventStub, { patientId: 'p1' });

    expect(fakeHandler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
    expect(capturedAudits).toHaveLength(0);
  });

  it("exempt + state='unactivated' lets the handler run (auth flow survives without license)", async () => {
    activeState = 'unactivated';
    const { licenseGated } = await import('../../../src/main/license/gate');
    const fakeHandler = vi.fn(() => ({ authenticated: true }));
    const wrapped = licenseGated('auth:login', fakeHandler as never);

    const eventStub = { sender: null } as never;
    const result = await wrapped(eventStub, { userId: 'u1', pin: '1234' });

    expect(fakeHandler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ authenticated: true });
    // No gate rejections happen on exempt channels regardless of state.
    expect(capturedAudits).toHaveLength(0);
  });

  it("exempt + state='expired' lets the handler run (audit channel stays open)", async () => {
    activeState = 'expired';
    const { licenseGated } = await import('../../../src/main/license/gate');
    const fakeHandler = vi.fn(() => ({ ok: true }));
    const wrapped = licenseGated('audit:log', fakeHandler as never);

    const eventStub = { sender: null } as never;
    const result = await wrapped(eventStub, { action: 'renderer.read' });

    expect(fakeHandler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
    expect(capturedAudits).toHaveLength(0);
  });

  it("audit row shape: action='license.gate_rejected', metadata carries { channel, fingerprintHash, code }, user_id IS NULL", async () => {
    // Re-asserts the audit shape on a fresh gate rejection — proves the
    // shape is stable across multiple channels + states (defense-in-depth
    // for the renderer audit-page filter contract).
    activeState = 'expired';
    const { licenseGated } = await import('../../../src/main/license/gate');

    const channels = [
      'patients:create',
      'capture:list-devices',
      'reports:regen-pdf',
    ] as const;
    for (const channel of channels) {
      const wrapped = licenseGated(channel, vi.fn() as never);
      await wrapped({ sender: null } as never, {});
    }

    expect(capturedAudits).toHaveLength(3);
    for (let i = 0; i < channels.length; i += 1) {
      const row = capturedAudits[i];
      const channel = channels[i];
      expect(row).toBeDefined();
      expect(row?.action).toBe('license.gate_rejected');
      expect(row?.entityType).toBe('license');
      expect(row?.entityId).toBe(channel);
      expect(row?.outcome).toBe('failed');
      expect(row?.userId).toBeNull();
      expect(row?.metadata).toEqual({
        channel,
        fingerprintHash: 'b'.repeat(64),
        code: 'IPC_LICENSE_EXPIRED',
      });
    }
  });

  it('EXEMPT_CHANNELS contains the 14 channels named in CONTEXT D-08 verbatim + Plan 04 picker + Plan 14 crop + Quick task additions', async () => {
    const { EXEMPT_CHANNELS } = await import('../../../src/main/license/gate');
    // Auth (8) + License (3) + Audit (2) = 13 base channels.
    // Plan 04 added `license:pick-and-activate` → 14.
    // Plan 14 added `screenshots:crop` → 15.
    // Plan 15 (G-08-8) added `screenshots:get-blob` + `clipboard:copy-text` → 17.
    // Quick task 20260912-shared-database-optional added the 3 storage channels
    // (get/set/pick) → 19.
    expect(EXEMPT_CHANNELS.size).toBe(19);
    // Verify the names match exactly (D-08 verbatim + Plan 04's picker).
    const expected = [
      'auth:status',
      'auth:bootstrap',
      'auth:wizard-bootstrap',
      'auth:login',
      'auth:logout',
      'auth:users-list',
      'auth:recovery-request',
      'auth:accept-recovery-file',
      'license:status',
      'license:activate',
      'license:pick-and-activate',
      'audit:list',
      'audit:log',
      'screenshots:crop',
      // Plan 15 (G-08-8) — read raw screenshot bytes + clipboard copy.
      'screenshots:get-blob',
      'clipboard:copy-text',
      // Quick task 20260912 — opt-in shared-database toggle + picker.
      'storage:get-location',
      'storage:set-location',
      'storage:pick-folder',
    ];
    for (const ch of expected) {
      expect(EXEMPT_CHANNELS.has(ch)).toBe(true);
    }
  });
});
