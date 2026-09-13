// @vitest-environment happy-dom
// Plan 03-02 Task 1 — useCaptureDeviceMap bridge (BLOCKER 1).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCaptureDeviceMap } from '@/hooks/useCaptureDeviceMap';
import { getApi } from '../setup';
import type { CaptureDevice } from '@shared/ipc-contract';

const dshowList: CaptureDevice[] = [
  { deviceId: 'EasyCap USB Video', rawName: 'EasyCap USB Video', index: 0, type: 'dshow' },
  { deviceId: 'HDMI Capture', rawName: 'HDMI Capture', index: 1, type: 'dshow' },
  { deviceId: 'Generic Webcam', rawName: 'Generic Webcam', index: 2, type: 'dshow' },
];

function mockBrowserDevices(devices: Array<{ deviceId: string; label: string; kind: MediaDeviceKind }>): void {
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: { enumerateDevices: vi.fn().mockResolvedValue(devices) },
    configurable: true,
  });
}

beforeEach(() => {
  getApi().capture.listDevices.mockResolvedValue(dshowList);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCaptureDeviceMap', () => {
  it('enumerates BOTH the dshow IPC list and the browser mediaDevices list on mount', async () => {
    mockBrowserDevices([
      { deviceId: 'browser-easycap', label: 'EasyCap USB Video', kind: 'videoinput' },
      { deviceId: 'browser-hdmi', label: 'HDMI Capture', kind: 'videoinput' },
      { deviceId: 'browser-mic', label: 'Microphone', kind: 'audioinput' },
    ]);

    const { result } = renderHook(() => useCaptureDeviceMap());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getApi().capture.listDevices).toHaveBeenCalledTimes(1);
    expect(result.current.dshow).toEqual(dshowList);
    expect(result.current.browser).toHaveLength(2);
    expect(result.current.browser.every((device) => device.kind === 'videoinput')).toBe(true);
  });

  it('builds a label-based bridge so lookup() returns the canonical name', async () => {
    mockBrowserDevices([
      { deviceId: 'browser-easycap', label: 'EasyCap USB Video', kind: 'videoinput' },
      { deviceId: 'browser-hdmi', label: 'HDMI Capture', kind: 'videoinput' },
    ]);

    const { result } = renderHook(() => useCaptureDeviceMap());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.lookup('browser-easycap')).toBe('EasyCap USB Video');
    expect(result.current.lookup('browser-hdmi')).toBe('HDMI Capture');
    expect(result.current.pickBrowserId('EasyCap USB Video')).toBe('browser-easycap');
    expect(result.current.pickBrowserId('HDMI Capture')).toBe('browser-hdmi');
  });

  it('falls back to the raw browser label when no dshow match exists', async () => {
    mockBrowserDevices([
      { deviceId: 'browser-unknown', label: 'hiddEn Device', kind: 'videoinput' },
    ]);

    const { result } = renderHook(() => useCaptureDeviceMap());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.lookup('browser-unknown')).toBe('hiddEn Device');
  });

  it('matches labels case-insensitively and trimmed', async () => {
    mockBrowserDevices([
      { deviceId: 'browser-x', label: 'easycap usb video', kind: 'videoinput' },
    ]);

    const { result } = renderHook(() => useCaptureDeviceMap());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.lookup('browser-x')).toBe('EasyCap USB Video');
    expect(result.current.pickBrowserId('easycap usb video')).toBe('browser-x');
  });

  it('surfaces an error message when the IPC call rejects', async () => {
    // Plan 08-12 / G-08-6 + Quick task 260913-rp5 — IPC throws are
    // surfaced as the raw error message (NOT collapsed into the
    // license-required message the way safeInvoke used to). Gate
    // rejections still surface the license-required message so the
    // downstream page renders the EmptyStateCard path. The contract
    // here is "surface an error" — gate rejection is tested in the
    // next case.
    getApi().capture.listDevices.mockRejectedValueOnce(new Error('boom'));
    mockBrowserDevices([]);

    const { result } = renderHook(() => useCaptureDeviceMap());
    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/boom/i);
  });

  // Plan 08-12 / G-08-6 — when the main-process license gate returns
  // {ok: false, code: 'IPC_LICENSE_*'} the hook must NOT feed the gate
  // object into setDshow (which would later crash dshow.find() in the
  // useMemo). safeInvoke unwraps it to null; the hook then sets dshow=[]
  // + a license-aware error string so SettingsCapture / ProcedureRoom
  // render the EmptyStateCard path instead of white-screening.
  it('G-08-6: gate-rejected capture.listDevices yields empty dshow + license error (no crash)', async () => {
    getApi().capture.listDevices.mockResolvedValueOnce({
      ok: false,
      code: 'IPC_LICENSE_EXPIRED',
    });
    mockBrowserDevices([
      { deviceId: 'browser-easycap', label: 'EasyCap USB Video', kind: 'videoinput' },
    ]);

    const { result } = renderHook(() => useCaptureDeviceMap());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The crash-prevention contract: setDshow must receive [], NOT the
    // gate object. dshow.find() in the namesByBrowserId useMemo would
    // otherwise throw on .filter/.find because {ok:false} has no .rawName.
    expect(result.current.dshow).toEqual([]);
    expect(result.current.error).toMatch(/license required/i);
    // The hook skips enumerateDevices on the null path (Plan 08-12), so
    // browser stays at its initial empty array. lookup() never reaches
    // dshow.find() because namesByBrowserId is empty — no crash either
    // way, but the safeInvoke contract holds.
    expect(result.current.browser).toEqual([]);
    expect(result.current.lookup('browser-easycap')).toBeUndefined();
  });
});
