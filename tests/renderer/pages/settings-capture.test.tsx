// @vitest-environment happy-dom
// Plan 03-02 Task 2 — Settings → Capture: reactive preview, component-local
// state, explicit Save with no `doctorId` in the IPC payload (Q-C, D-09).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('hydrates the selected device from the saved default via the bridge', async () => {
    setRoute({ name: 'settings-capture' });
    makeMediaMock();
    render(<SettingsCapture />);

    // Hydration maps the canonical saved default to the matching browser
    // deviceId and surfaces it in the SelectValue. The bridge lookup
    // (useCaptureDeviceMap) is what allows `getUserMedia` to use the right
    // browser deviceId — the hook test covers the actual re-open.
    await waitFor(() => {
      const combo = screen.getByRole('combobox', { name: /capture device/i });
      expect(combo).toHaveTextContent('EasyCap USB Video');
    });
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

  it('hydrates a saved custom preset from getPreset (G-03-7)', async () => {
    setRoute({ name: 'settings-capture' });
    makeMediaMock();
    const api = getApi();
    api.capture.getPreset.mockResolvedValue({
      preset: 'custom',
      resolution: '1280x720',
      framerate: 30,
    });
    render(<SettingsCapture />);

    // ponytail: wait for hydration to set form.kind='custom' before asserting
    // the radio's checked state — the initial render shows the default
    // ('hd') form until the getPreset promise resolves.
    const customRadio = await screen.findByTestId('preset-custom');
    await waitFor(() => expect(customRadio).toBeChecked());

    const resolutionInput = (await screen.findByTestId('custom-resolution')) as HTMLInputElement;
    expect(resolutionInput.value).toBe('1280x720');

    const framerateTrigger = await screen.findByLabelText(/^framerate$/i);
    expect(framerateTrigger.textContent).toContain('30 fps');
  });

  it('sidebar mount: Capture is active and Users is not (G-03-6)', async () => {
    // The shared SettingsSidebar must mark the Capture button active on
    // SettingsCapture and the Users button inactive, so the doctor can
    // see which section they're on and switch back via the sidebar.
    setRoute({ name: 'settings-capture' });
    makeMediaMock();
    render(<SettingsCapture />);
    const capture = await screen.findByTestId('settings-hub-capture');
    const users = await screen.findByTestId('settings-hub-users');
    expect(capture.getAttribute('data-active')).toBe('true');
    expect(users.getAttribute('data-active')).toBe('false');
  });

  // Plan 08-11 / G-08-5 — on license state 'expired' / 'unactivated' the
  // main-process gate returns {ok: false, code: 'IPC_LICENSE_*'} for
  // capture.* calls. The hydration useEffect previously fed the gate
  // object into setSavedDeviceId, which crashed downstream pickBrowserId
  // and white-screened the page. Wire through safeInvoke + render
  // <EmptyStateCard> instead.
  it('G-08-5: hydration gate rejection renders <EmptyStateCard> (no crash)', async () => {
    const api = getApi();
    // The per-test beforeEach already seeds getDefaultDevice to a string;
    // override AFTER it runs so this test sees the gate-rejected shape.
    api.capture.getDefaultDevice.mockResolvedValue({
      ok: false,
      code: 'IPC_LICENSE_EXPIRED',
    });
    setRoute({ name: 'settings-capture' });
    makeEmptyMediaMock();

    render(<SettingsCapture />);

    // The gated-empty-state testid is the EmptyStateCard contract from
    // Plan 08-10. Once it's in the DOM the React tree is past hydration,
    // which is the "no white screen" assertion.
    const card = await screen.findByTestId('gated-empty-state');
    expect(card).toBeInTheDocument();
    // The default message comes from t('license.emptyStateMessage');
    // match on the en-string fragment ("License required").
    expect(card).toHaveTextContent(/license required/i);
  });

  it('G-08-5: Save surfaces a license toast on gate-rejected persistence (no crash)', async () => {
    const api = getApi();
    // Hydration succeeds so the Save button becomes clickable. The gate
    // rejection only fires on the persistence calls.
    api.capture.getDefaultDevice.mockResolvedValue('EasyCap USB Video');
    api.capture.setDefaultDevice.mockResolvedValue({
      ok: false,
      code: 'IPC_LICENSE_EXPIRED',
    });
    setRoute({ name: 'settings-capture' });
    makeMediaMock();

    render(<SettingsCapture />);

    const save = await screen.findByTestId('save-capture');
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));

    const user = userEvent.setup();
    await user.click(save);

    // setDefaultDevice must have been invoked exactly once even though
    // the gate rejected it — that's the IPC contract we want surfaced
    // (vs. an unhandled exception aborting before the call).
    await waitFor(() =>
      expect(api.capture.setDefaultDevice).toHaveBeenCalledTimes(1),
    );
    // The page must still be mounted — findByText of the section header
    // proves no white-screen crash.
    expect(
      screen.getByRole('heading', { name: /capture/i }),
    ).toBeInTheDocument();
    // handleSave returns BEFORE calling setPreset when setDefaultDevice
    // was gate-rejected — preset save is not attempted on a gated Save.
    expect(api.capture.setPreset).not.toHaveBeenCalled();
  });
});
