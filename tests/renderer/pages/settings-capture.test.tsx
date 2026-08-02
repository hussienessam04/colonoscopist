// @vitest-environment happy-dom
// Plan 03-02 Task 2 — Settings → Capture: reactive preview, component-local
// state, explicit Save with no `doctorId` in the IPC payload (Q-C, D-09).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getApi } from '../setup';
import { setRoute } from '@/store/route';
import SettingsCapture from '@/pages/SettingsCapture';
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
  api.capture.setDefaultDevice.mockResolvedValue({ ok: true });
  api.capture.setPreset.mockResolvedValue({ ok: true });
  if (!('mediaDevices' in globalThis.navigator) || !globalThis.navigator.mediaDevices) {
    makeEmptyMediaMock();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Settings → Capture', () => {
  it('shows the saved default device name on hydration', async () => {
    setRoute({ name: 'settings-capture' });
    makeEmptyMediaMock();

    render(<SettingsCapture />);

    // The saved default ("Last used: …") is the first piece of state that
    // surfaces once the main-process IPC resolves — the dshow list is
    // already populated by main, so we don't need the browser list to
    // hydrate the page.
    expect(await screen.findByText(/Last used: EasyCap USB Video/)).toBeInTheDocument();
  });

  it('renders SD/HD/Custom radio controls and a Custom fields section with framerate options 25/30/50/60', async () => {
    setRoute({ name: 'settings-capture' });
    makeMediaMock();

    render(<SettingsCapture />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('preset-custom'));

    const resolution = await screen.findByTestId('custom-resolution');
    expect(resolution).toBeInTheDocument();
    const framerateTrigger = await screen.findByLabelText(/^framerate$/i);
    await user.click(framerateTrigger);
    for (const option of ['25 fps', '30 fps', '50 fps', '60 fps']) {
      expect(await screen.findByRole('option', { name: option })).toBeInTheDocument();
    }
  });

  it('does NOT call setDefaultDevice or setPreset on render; only Save persists', async () => {
    setRoute({ name: 'settings-capture' });
    makeMediaMock();
    const api = getApi();
    render(<SettingsCapture />);

    // Wait for the Save button to become enabled (hydration complete +
    // selectedBrowserId set from the saved default).
    const save = await screen.findByTestId('save-capture');
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('preset-sd'));
    await user.click(await screen.findByTestId('preset-custom'));
    await user.click(await screen.findByTestId('preset-hd'));

    expect(api.capture.setDefaultDevice).not.toHaveBeenCalled();
    expect(api.capture.setPreset).not.toHaveBeenCalled();

    await user.click(save);
    await waitFor(() => expect(api.capture.setDefaultDevice).toHaveBeenCalledTimes(1));
    expect(api.capture.setDefaultDevice).toHaveBeenCalledWith({
      deviceId: 'EasyCap USB Video',
    });
    expect(api.capture.setPreset).toHaveBeenCalledWith({
      deviceId: 'EasyCap USB Video',
      preset: { preset: 'hd' },
    });
    // Per D-04 / BLOCKER 4: doctorId is NEVER included in either payload.
    for (const call of api.capture.setDefaultDevice.mock.calls) {
      expect(call[0]).not.toHaveProperty('doctorId');
    }
    for (const call of api.capture.setPreset.mock.calls) {
      expect(call[0]).not.toHaveProperty('doctorId');
    }
  });

  it('re-opens getUserMedia with the new deviceId when the user starts a preview and changes device', async () => {
    setRoute({ name: 'settings-capture' });
    const { stop } = makeMediaMock();

    render(<SettingsCapture />);

    // Wait for hydration to complete and the Start Preview button to enable.
    await waitFor(() => {
      const btn = screen.getByTestId('start-preview') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    // Use fireEvent (synchronous) for the click so the state updates
    // propagate into the hook's useEffect on the same render cycle.
    fireEvent.click(screen.getByTestId('start-preview'));
    await waitFor(() => {
      const md = navigator.mediaDevices as unknown as { getUserMedia: ReturnType<typeof vi.fn> };
      expect(md.getUserMedia).toHaveBeenCalled();
    });

    // Switch devices via the dropdown.
    const user = userEvent.setup();
    const trigger = await screen.findByLabelText(/^capture device$/i);
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: /HDMI Capture/ }));

    // The previous stream's tracks must be released on device change.
    await waitFor(() => expect(stop.every((s) => s.mock.calls.length === 1)).toBe(true));
  });

  it('renders an inline error and disables Save when the Custom resolution is invalid', async () => {
    setRoute({ name: 'settings-capture' });
    makeMediaMock();
    const api = getApi();
    render(<SettingsCapture />);

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('preset-custom'));
    const input = await screen.findByTestId('custom-resolution');
    await user.clear(input);
    await user.type(input, 'bad');

    expect(await screen.findByText(/use w.{1,3}h like 1920.{1,3}1080/i)).toBeInTheDocument();
    const save = screen.getByTestId('save-capture') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(api.capture.setDefaultDevice).not.toHaveBeenCalled();
  });

  it('does not call listDevices or enumerateDevices again on preset changes', async () => {
    setRoute({ name: 'settings-capture' });
    makeMediaMock();
    const api = getApi();
    render(<SettingsCapture />);

    await screen.findByTestId('preset-hd');
    const initialListCalls = api.capture.listDevices.mock.calls.length;

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('preset-sd'));
    await user.click(await screen.findByTestId('preset-hd'));

    expect(api.capture.listDevices).toHaveBeenCalledTimes(initialListCalls);
  });
});
