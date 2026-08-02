// @vitest-environment happy-dom
// Plan 03-02 Task 1 — useVideoPreview lifecycle (CAPT-03, BLOCKER 3/6/8).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useVideoPreview } from '@/hooks/useVideoPreview';

type Track = { stop: () => void; kind: string };

function makeStream(): { stream: MediaStream; tracks: Track[] } {
  const tracks: Track[] = [
    { stop: vi.fn(), kind: 'video' },
    { stop: vi.fn(), kind: 'video' },
  ];
  return { stream: tracks as unknown as MediaStream, tracks };
}

let mockGetUserMedia: ReturnType<typeof vi.fn>;
let mockEnumerate: ReturnType<typeof vi.fn>;

function installMediaDevicesMock(): void {
  mockGetUserMedia = vi.fn();
  mockEnumerate = vi.fn();
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: { getUserMedia: mockGetUserMedia, enumerateDevices: mockEnumerate },
    configurable: true,
  });
}

beforeEach(() => {
  installMediaDevicesMock();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useVideoPreview', () => {
  it('does not request a stream until start() is called', () => {
    const { result } = renderHook(() => useVideoPreview('browser-1'));
    expect(mockGetUserMedia).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
  });

  it('calls getUserMedia with the BROWSER deviceId and audio:false after start()', async () => {
    const { stream, tracks } = makeStream();
    mockGetUserMedia.mockResolvedValue(stream);
    const { result } = renderHook(() => useVideoPreview('browser-1'));

    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
    const constraints = mockGetUserMedia.mock.calls[0]?.[0] as MediaStreamConstraints;
    const video = constraints.video as MediaTrackConstraints;
    expect((video.deviceId as MediaTrackConstraintSet['deviceId']).exact).toBe('browser-1');
    expect(constraints.audio).toBe(false);
    expect(result.current.active).toBe(true);
    expect(tracks.every((track) => track.stop.mock.calls.length === 0)).toBe(true);
  });

  it('stops every track and clears the video srcObject on stop()', async () => {
    const { stream, tracks } = makeStream();
    mockGetUserMedia.mockResolvedValue(stream);
    const video = document.createElement('video');
    Object.defineProperty(video, 'srcObject', { value: null, writable: true });
    const { result, rerender } = renderHook(() => useVideoPreview('browser-1'));

    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });
    await act(async () => {
      result.current.videoRef.current = video;
      await Promise.resolve();
    });
    rerender();

    await act(async () => {
      result.current.stop();
      await Promise.resolve();
    });

    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    expect(video.srcObject).toBeNull();
    expect(result.current.active).toBe(false);
  });

  it('stops every track on unmount', async () => {
    const { stream, tracks } = makeStream();
    mockGetUserMedia.mockResolvedValue(stream);
    const { result, unmount } = renderHook(() => useVideoPreview('browser-1'));

    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });

    unmount();

    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
  });

  it('maps the four getUserMedia errors to PreviewError codes', async () => {
    const cases: Array<[string, string]> = [
      ['NotAllowedError', 'NotAllowedError'],
      ['NotFoundError', 'NotFoundError'],
      ['OverconstrainedError', 'OverconstrainedError'],
      ['NotReadableError', 'NotReadableError'],
    ];

    for (const [name, code] of cases) {
      mockGetUserMedia.mockRejectedValueOnce(new Error('boom'));
      Object.defineProperty(Error.prototype, 'name', { value: name, configurable: true });
      const { result } = renderHook(() => useVideoPreview('browser-1'));
      await act(async () => {
        result.current.start();
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.error?.code).toBe(code);
      expect(result.current.active).toBe(false);
    }
  });
});
