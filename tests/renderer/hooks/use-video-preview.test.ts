// @vitest-environment happy-dom
// Plan 03-02 Task 1 — useVideoPreview lifecycle (CAPT-03, BLOCKER 3/6/8).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useVideoPreview } from '@/hooks/useVideoPreview';

type Track = { stop: ReturnType<typeof vi.fn>; kind: string };

function makeStream(): { stream: MediaStream; tracks: Track[] } {
  const tracks: Track[] = [
    { stop: vi.fn(), kind: 'video' },
    { stop: vi.fn(), kind: 'video' },
  ];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  return { stream, tracks };
}

function makeFailingStream(name: string): MediaStream {
  class Failure extends Error {
    override name = name;
  }
  return Promise.reject(new Failure('boom')) as unknown as MediaStream;
}

let mockGetUserMedia: ReturnType<typeof vi.fn>;

function installMediaDevicesMock(): void {
  mockGetUserMedia = vi.fn();
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: { getUserMedia: mockGetUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
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

    act(() => {
      result.current.start();
    });

    await waitFor(() => expect(result.current.active).toBe(true));
    expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
    const constraints = mockGetUserMedia.mock.calls[0]?.[0] as MediaStreamConstraints;
    const video = constraints.video as MediaTrackConstraints;
    expect((video.deviceId as MediaTrackConstraintSet['deviceId']).exact).toBe('browser-1');
    expect(constraints.audio).toBe(false);
    expect(tracks.every((track) => track.stop.mock.calls.length === 0)).toBe(true);
  });

  it('stops every track and clears the video srcObject on stop()', async () => {
    const { stream, tracks } = makeStream();
    mockGetUserMedia.mockResolvedValue(stream);
    const video = document.createElement('video');
    Object.defineProperty(video, 'srcObject', { value: null, writable: true });
    const { result } = renderHook(() => useVideoPreview('browser-1'));

    act(() => {
      result.current.start();
      result.current.videoRef.current = video;
    });

    await waitFor(() => expect(result.current.active).toBe(true));

    act(() => {
      result.current.stop();
    });

    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    expect(video.srcObject).toBeNull();
    expect(result.current.active).toBe(false);
  });

  it('stops every track on unmount', async () => {
    const { stream, tracks } = makeStream();
    mockGetUserMedia.mockResolvedValue(stream);
    const { result, unmount } = renderHook(() => useVideoPreview('browser-1'));

    act(() => {
      result.current.start();
    });

    await waitFor(() => expect(result.current.active).toBe(true));

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
      mockGetUserMedia.mockImplementation(() => makeFailingStream(name));
      const { result } = renderHook(() => useVideoPreview('browser-1'));

      act(() => {
        result.current.start();
      });

      await waitFor(() => expect(result.current.error?.code).toBe(code));
      expect(result.current.active).toBe(false);
    }
  });
});
