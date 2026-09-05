// @vitest-environment happy-dom
// Plan 03-02 Task 1 — Procedure Preview end-to-end tracer (Phase 4 split).
// Preview is Step 1 — device selection + live preview + Start Preview button.
// The recording controls moved to ProcedureRoom (Step 2).
// D-01 / D-02 / D-07 / D-08 / Q-B / BLOCKER 5.
// Plan 03-05 Task 2 — reachability test from PatientRow into Procedure Preview (G-03-4).
// Plan 08-11 / G-08-5 — ProcedureRoom gated-IPC regression test (added at
// the bottom of this file). The canonical ProcedureRoom test file is
// procedure-room-timer.test.tsx; this regression lives here per the plan
// so the G-08-5 audit trail points at the SettingsCapture plan's sibling.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getApi } from '../setup';
import { setRoute, getRoute } from '@/store/route';
import ProcedurePreview from '@/pages/ProcedurePreview';
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
  // Plan 04-02 — ProcedurePreview creates the procedure row on mount so the
  // doctor can carry an id into ProcedureRoom via the route.
  api.procedures.create.mockResolvedValue({
    id: '00000000-0000-4000-8000-000000000050',
    patientId: 'pat-1',
    doctorId: 'doc-1',
    startedAt: Date.now(),
    endedAt: null,
    durationSeconds: 0,
    status: 'recording',
    videoPath: '',
    presetSummary: { kind: 'hd', resolution: '1920x1080', framerate: 30, bitrate: '10M' },
    audioDeviceName: null,
    createdAt: Date.now(),
  });
  api.procedureNotes.list.mockResolvedValue([]);
  // happy-dom does not ship navigator.mediaDevices by default — install a
  // default mock so the hook's first useEffect never dereferences undefined.
  if (!('mediaDevices' in globalThis.navigator) || !globalThis.navigator.mediaDevices) {
    makeEmptyMediaMock();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProcedurePreview', () => {
  it('renders Continue-to-recording at idle and auto-starts the preview when a device is picked', async () => {
    setRoute({ name: 'procedure-preview', patientId: 'pat-1' });
    makeMediaMock();

    render(<ProcedurePreview />);

    expect(await screen.findByRole('heading', { name: /preview/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue to recording/i })).toBeInTheDocument();

    // ponytail: the explicit Start Preview button is gone — the preview
    // auto-starts when the doctor selects a device. Verify by selecting
    // and asserting getUserMedia was called.
    const trigger = await screen.findByLabelText(/capture device/i);
    const user = userEvent.setup();
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: /HDMI Capture/ }));

    const md = navigator.mediaDevices as unknown as { getUserMedia: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(md.getUserMedia).toHaveBeenCalled());
  });

  it('does NOT call setDefaultDevice or setPreset when the picker changes', async () => {
    setRoute({ name: 'procedure-preview', patientId: 'pat-1' });
    makeMediaMock();

    const api = getApi();
    render(<ProcedurePreview />);

    const trigger = await screen.findByLabelText(/capture device/i);
    const user = userEvent.setup();
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: /HDMI Capture/ }));

    expect(api.capture.setDefaultDevice).not.toHaveBeenCalled();
    expect(api.capture.setPreset).not.toHaveBeenCalled();
  });

  it('opens getUserMedia automatically after device pick', async () => {
    setRoute({ name: 'procedure-preview', patientId: 'pat-1' });
    makeMediaMock();

    render(<ProcedurePreview />);

    const trigger = await screen.findByLabelText(/capture device/i);
    const user = userEvent.setup();
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: /HDMI Capture/ }));

    // ponytail: getUserMedia is called automatically once the doctor picks
    // a device — the explicit Start Preview button is gone. Track-stop on
    // Continue is an internal detail covered by the hook's unit tests.
    const md = navigator.mediaDevices as unknown as { getUserMedia: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(md.getUserMedia).toHaveBeenCalled());
  });
});

// Plan 03-05 — reachability from PatientRow into Procedure Preview (G-03-4).
describe('Plan 03-05 — Procedure Preview reachability from PatientRow', () => {
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

  it('clicking "Open Procedure Preview" on a non-deleted row navigates with the patientId', async () => {
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
    await user.click(await screen.findByRole('menuitem', { name: /open procedure preview/i }));

    await waitFor(() => expect(getRoute().name).toBe('procedure-preview'));
    expect(getRoute()).toMatchObject({ name: 'procedure-preview', patientId: ALICE.id });
  });
});

// Plan 08-11 / G-08-5 — ProcedureRoom gated-IPC graceful degrade. On
// license state 'expired' / 'unactivated' the main-process gate returns
// {ok:false, code:'IPC_LICENSE_*'} for capture.* reads. Previously the
// hydration useEffect fed the gate object into setSavedDevice, which the
// page then treated as a canonical deviceId — pickBrowserId({ok:false})
// crashed and the React tree white-screened. With safeInvoke the result
// is null, savedDevice stays null, the existing no-device overlay renders
// naturally (lines 365-378 in ProcedureRoom.tsx).
describe('Plan 08-11 / G-08-5 — ProcedureRoom gated-IPC graceful degrade', () => {
  it('renders the no-device overlay when getDefaultDevice is gate-rejected (no crash)', async () => {
    const api = getApi();
    // Override the per-test beforeEach default for this regression.
    api.capture.getDefaultDevice.mockResolvedValue({
      ok: false,
      code: 'IPC_LICENSE_EXPIRED',
    });
    // ProcedureRoom subscribes to recording.onStatus on mount and the
    // cleanup path calls the returned unsubscribe — without an impl that
    // returns a function, the cleanup throws. Match the canonical pattern
    // from procedure-room-timer.test.tsx.
    api.recording.onStatus.mockImplementation(
      () => (): void => undefined,
    );

    setRoute({
      name: 'procedure-room',
      patientId: 'pat-1',
      procedureId: '00000000-0000-4000-8000-000000000050',
    });

    render(<ProcedureRoom />);

    // No white screen — the existing no-device overlay is the canonical
    // UX for "no saved default device" and ProcedureRoom renders it
    // uniformly when savedDevice stays null after a gate rejection.
    expect(
      await screen.findByText(/no device selected/i),
    ).toBeInTheDocument();
    // The page header survives hydration so the React tree is intact.
    expect(
      screen.getByRole('heading', { name: /procedure room/i }),
    ).toBeInTheDocument();
  });
});