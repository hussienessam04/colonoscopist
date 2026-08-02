// @vitest-environment happy-dom
// Plan 03-02 Task 1 — Procedure Room end-to-end tracer.
// D-01 / D-02 / D-07 / D-08 / Q-B / BLOCKER 5.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getApi } from '../setup';
import { setRoute } from '@/store/route';
import ProcedureRoom from '@/pages/ProcedureRoom';
import type { CaptureDevice } from '@shared/ipc-contract';

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
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /start preview/i }));
    await waitFor(() => {
      const md = navigator.mediaDevices as unknown as { getUserMedia: ReturnType<typeof vi.fn> };
      expect(md.getUserMedia).toHaveBeenCalled();
    });

    await user.click(await screen.findByRole('button', { name: /stop preview/i }));

    await waitFor(() => expect(stop.every((s) => s.mock.calls.length === 1)).toBe(true));
  });

  it('Finish stops the active stream', async () => {
    setRoute({ name: 'procedure-room' });
    const { stop } = makeMediaMock();

    render(<ProcedureRoom />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /start preview/i }));
    await screen.findByRole('button', { name: /stop preview/i });

    await user.click(screen.getByRole('button', { name: /^finish$/i }));

    await waitFor(() => expect(stop.every((s) => s.mock.calls.length === 1)).toBe(true));
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
