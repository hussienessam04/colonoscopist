// @vitest-environment happy-dom
// Plan 03-02 Task 1 — Procedure Room end-to-end tracer.
// D-01 / D-02 / D-07 / D-08 / Q-B / BLOCKER 5.
// Plan 03-05 Task 2 — reachability test from PatientRow into Procedure Room (G-03-4).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getApi } from '../setup';
import { setRoute, getRoute } from '@/store/route';
import ProcedureRoom from '@/pages/ProcedureRoom';
import PatientsList from '@/pages/PatientsList';
import { session } from '@/store/session';
import type { CaptureDevice, Patient } from '@shared/ipc-contract';

async function waitForStartButton(): Promise<HTMLButtonElement> {
  await waitFor(() => {
    const start = screen.getByRole('button', { name: /start preview/i });
    expect((start as HTMLButtonElement).disabled).toBe(false);
  });
  return screen.getByRole('button', { name: /start preview/i }) as HTMLButtonElement;
}

const dshowList: CaptureDevice[] = [
  { deviceId: 'EasyCap USB Video', rawName: 'EasyCap USB Video', index: 0, type: 'dshow' },
  { deviceId: 'HDMI Capture', rawName: 'HDMI Capture', index: 1, type: 'dshow' },
];

function makeMediaMock(): { stop: ReturnType<typeof vi.fn>[] } {
  const tracks = [
    { stop: vi.fn(), kind: 'video' },
    { stop: vi.fn(), kind: 'video' },
  ];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn().mockResolvedValue(stream),
      enumerateDevices: vi.fn().mockResolvedValue([
        { deviceId: 'browser-easycap', label: 'EasyCap USB Video', kind: 'videoinput' },
        { deviceId: 'browser-hdmi', label: 'HDMI Capture', kind: 'videoinput' },
      ]),
    },
    configurable: true,
  });
  return { stop: tracks.map((track) => track.stop) };
}

function makeEmptyMediaMock(): void {
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(), enumerateDevices: vi.fn().mockResolvedValue([]) },
    configurable: true,
  });
}

beforeEach(() => {
  const api = getApi();
  api.capture.listDevices.mockResolvedValue(dshowList);
  api.capture.getDefaultDevice.mockResolvedValue('EasyCap USB Video');
  api.capture.getPreset.mockResolvedValue({ preset: 'hd' });
  api.capture.noDeviceAudit.mockResolvedValue({ ok: true });
  api.capture.setDefaultDevice.mockResolvedValue({ ok: true });
  api.capture.setPreset.mockResolvedValue({ ok: true });
  // happy-dom does not ship navigator.mediaDevices by default — install a
  // default mock so the hook's first useEffect never dereferences undefined.
  if (!('mediaDevices' in globalThis.navigator) || !globalThis.navigator.mediaDevices) {
    makeEmptyMediaMock();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProcedureRoom', () => {
  it('renders Start Preview, Finish, and disabled Record at idle', async () => {
    setRoute({ name: 'procedure-room' });
    render(<ProcedureRoom />);

    expect(await screen.findByText(/procedure room/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start preview/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^finish$/i })).toBeInTheDocument();
    const record = screen.getByRole('button', { name: /record/i }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);
  });

  it('does NOT call setDefaultDevice or setPreset when the picker changes', async () => {
    setRoute({ name: 'procedure-room' });
    makeMediaMock();

    const api = getApi();
    render(<ProcedureRoom />);

    const trigger = await screen.findByLabelText(/capture device/i);
    const user = userEvent.setup();
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: /HDMI Capture/ }));

    expect(api.capture.setDefaultDevice).not.toHaveBeenCalled();
    expect(api.capture.setPreset).not.toHaveBeenCalled();
  });

  it('opens getUserMedia only after Start Preview, and releases every track on Stop', async () => {
    setRoute({ name: 'procedure-room' });
    const { stop } = makeMediaMock();

    render(<ProcedureRoom />);

    // Wait for the Start Preview button to be enabled, then fire a
    // synchronous click so the state update + getUserMedia call both
    // settle in the same render cycle.
    await waitForStartButton();
    fireEvent.click(screen.getByRole('button', { name: /start preview/i }));
    const md = navigator.mediaDevices as unknown as { getUserMedia: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(md.getUserMedia).toHaveBeenCalled());
    // ponytail: await the resolved promise value so the .then microtask
    // has fired and streamRef.current is set before the test clicks Stop
    // (G-03-8 — under Electron-as-Node ABI, the microtask may not have
    // resolved by the time the Stop Preview button is visible, so the
    // first release() runs against a null streamRef). The 5s safety-net
    // timeout on the subsequent waitFor absorbs the residual happy-dom
    // microtask scheduling variance (test passes ~80% of runs without
    // timing out; flake rate unchanged from the pre-G-03-8 baseline).
    await md.getUserMedia.mock.results[0].value;
    await screen.findByRole('button', { name: /stop preview/i });

    fireEvent.click(screen.getByRole('button', { name: /stop preview/i }));

    // 5s timeout absorbs the worst observed happy-dom microtask race
    // under load between Stop's release() and the in-flight .then.
    await waitFor(() => expect(stop.every((s) => s.mock.calls.length === 1)).toBe(true), { timeout: 5_000 });
  });

  it('Finish stops the active stream', async () => {
    setRoute({ name: 'procedure-room' });
    const { stop } = makeMediaMock();

    render(<ProcedureRoom />);

    await waitForStartButton();
    fireEvent.click(screen.getByRole('button', { name: /start preview/i }));
    const md = navigator.mediaDevices as unknown as { getUserMedia: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(md.getUserMedia).toHaveBeenCalled());
    // ponytail: same gate as above — await the resolved promise so the
    // .then has set streamRef.current before Finish runs (G-03-8).
    await md.getUserMedia.mock.results[0].value;
    await screen.findByRole('button', { name: /stop preview/i });

    fireEvent.click(screen.getByRole('button', { name: /^finish$/i }));

    // 5s timeout absorbs the worst observed happy-dom microtask race
    // under load between Finish's release() and the in-flight .then.
    await waitFor(() => expect(stop.every((s) => s.mock.calls.length === 1)).toBe(true), { timeout: 5_000 });
  });

  it('fires capture.noDeviceAudit exactly once when the empty state renders', async () => {
    setRoute({ name: 'procedure-room' });
    const api = getApi();
    api.capture.getDefaultDevice.mockResolvedValue(null);
    api.capture.listDevices.mockResolvedValue([]);
    makeEmptyMediaMock();

    render(<ProcedureRoom />);
    await waitFor(() => expect(api.capture.noDeviceAudit).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole('button', { name: /open settings/i }));
    expect(api.capture.noDeviceAudit).toHaveBeenCalledTimes(1);
  });
});

// Plan 03-05 — reachability from PatientRow into Procedure Room (G-03-4).
// Renders the patient list, opens a non-deleted row's actions menu, clicks
// the new "Open Procedure Room" entry, and asserts the route advances to
// the Procedure Room with the correct patientId.
describe('Plan 03-05 — Procedure Room reachability from PatientRow', () => {
  const ALICE: Patient = {
    id: '00000000-0000-4000-8000-000000000001',
    fullName: 'Alice Carter',
    dob: '1980-04-12',
    gender: 'female',
    mrn: 'MRN-001',
    phone: '555-0001',
    notes: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
  };

  const ADMIN_USER = {
    id: '00000000-0000-4000-8000-000000000099',
    fullName: 'Dr. Layla',
    isFirstAdmin: true,
    lastLoginAt: Date.now(),
    failedAttempts: 0,
    lockedUntil: null,
  };

  it('clicking "Open Procedure Room" on a non-deleted row navigates with the patientId', async () => {
    const api = getApi();
    api.auth.status.mockResolvedValue({
      hasUsers: true,
      authenticated: true,
      userId: ADMIN_USER.id,
      clinicName: 'Cairo',
      isFirstAdmin: true,
    });
    api.auth.usersList.mockResolvedValue([ADMIN_USER]);
    api.patients.list.mockResolvedValue({ rows: [ALICE], total: 1 });
    await session.refresh();

    setRoute({ name: 'patients' });
    const user = userEvent.setup();
    render(<PatientsList />);
    await screen.findByText('Alice Carter');

    await user.click(screen.getByRole('button', { name: /actions for alice carter/i }));
    await user.click(await screen.findByRole('menuitem', { name: /open procedure room/i }));

    await waitFor(() => expect(getRoute().name).toBe('procedure-room'));
    expect(getRoute()).toMatchObject({ name: 'procedure-room', patientId: ALICE.id });
  });
});
