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
    getApi().capture.listDevices.mockRejectedValueOnce(new Error('boom'));
    mockBrowserDevices([]);

    const { result } = renderHook(() => useCaptureDeviceMap());
    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.error).toBe('boom'));
  });
});
