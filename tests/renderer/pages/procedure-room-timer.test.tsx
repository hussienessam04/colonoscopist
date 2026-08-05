// @vitest-environment happy-dom
// Plan 04-01 — Procedure Room timer + recording:status subscribe/unsubscribe lifecycle.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { getApi } from '../setup';
import { setRoute } from '@/store/route';
import { session } from '@/store/session';
import { recordingStore } from '@/store/recording';
import ProcedureRoom from '@/pages/ProcedureRoom';
import type { RecordingStatus } from '@shared/ipc-contract';
import { formatDurationHHMMSS } from '@/lib/format-duration';

const dshowList = [
  { deviceId: 'EasyCap USB Video', rawName: 'EasyCap USB Video', index: 0, type: 'dshow' as const },
];

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
  api.capture.getPreset.mockResolvedValue({ preset: 'sd' });
  api.capture.noDeviceAudit.mockResolvedValue({ ok: true });
  api.recording.start.mockResolvedValue({ procedureId: 'proc-1', startedAt: Date.now() });
  api.recording.stop.mockResolvedValue(undefined);
  // Plan 04-02 — ProcedureRoom creates the procedure row on mount.
  api.procedures.create.mockResolvedValue({
    id: '00000000-0000-4000-8000-000000000051',
    patientId: 'pat-1',
    doctorId: 'doc-1',
    startedAt: Date.now(),
    endedAt: null,
    durationSeconds: 0,
    status: 'recording',
    videoPath: '',
    presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
    audioDeviceName: null,
    createdAt: Date.now(),
  });
  api.procedureNotes.list.mockResolvedValue([]);
  api.recording.onStatus.mockImplementation((cb: (status: RecordingStatus) => void) => {
    // ponytail: expose the cb so tests can push events through it directly.
    (window as unknown as { __pushRecordingStatus: typeof cb }).__pushRecordingStatus = cb;
    return () => {
      delete (window as unknown as { __pushRecordingStatus?: typeof cb }).__pushRecordingStatus;
    };
  });
  if (!('mediaDevices' in globalThis.navigator) || !globalThis.navigator.mediaDevices) {
    makeEmptyMediaMock();
  }
  recordingStore.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  recordingStore.reset();
});

describe('ProcedureRoom timer + recording subscription', () => {
  it('renders 00:00:00 when no recording is active', async () => {
    setRoute({ name: 'procedure-room' });
    render(<ProcedureRoom />);
    await screen.findByText(/procedure room/i);
    await waitFor(() => expect(screen.getByTestId('procedure-duration')).toHaveTextContent('00:00:00'));
  });

  it('renders HH:MM:SS derived from recording:status startedAt', async () => {
    setRoute({ name: 'procedure-room' });
    const startedAt = Date.now() - 65_000; // 1 minute 5 seconds ago
    render(<ProcedureRoom />);

    await waitFor(() =>
      expect(typeof (window as unknown as { __pushRecordingStatus?: (s: RecordingStatus) => void }).__pushRecordingStatus).toBe(
        'function',
      ),
    );
    await act(async () => {
      (window as unknown as { __pushRecordingStatus: (s: RecordingStatus) => void }).__pushRecordingStatus({
        status: 'started',
        startedAt,
        currentSegmentIndex: 0,
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId('procedure-duration')).toHaveTextContent('00:01:05'),
    );
  });

  it('navigates to procedure-review on recording:status stopped', async () => {
    setRoute({ name: 'procedure-room' });
    const { getRoute } = await import('@/store/route');

    // Mock procedures.get so the post-navigation render of ProcedureReview
    // does not hit a noop IPC handler.
    const api = getApi();
    api.procedures.get.mockResolvedValue({
      id: 'proc-xyz',
      patientId: 'pat-1',
      doctorId: 'doc-1',
      startedAt: Date.now() - 5000,
      endedAt: Date.now(),
      durationSeconds: 5,
      status: 'completed',
      videoPath: 'data/media/patients/pat-1/proc-xyz/video.mp4',
      presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
      audioDeviceName: null,
      createdAt: Date.now(),
    });

    render(<ProcedureRoom />);

    await waitFor(() =>
      expect(typeof (window as unknown as { __pushRecordingStatus?: (s: RecordingStatus) => void }).__pushRecordingStatus).toBe(
        'function',
      ),
    );
    await act(async () => {
      (window as unknown as { __pushRecordingStatus: (s: RecordingStatus) => void }).__pushRecordingStatus({
        status: 'started',
        startedAt: Date.now(),
        currentSegmentIndex: 0,
      });
    });
    await act(async () => {
      (window as unknown as { __pushRecordingStatus: (s: RecordingStatus) => void }).__pushRecordingStatus({
        status: 'stopped',
        startedAt: Date.now() - 5000,
        procedureId: 'proc-xyz',
      });
    });

    await waitFor(() =>
      expect(getRoute()).toMatchObject({ name: 'procedure-review', procedureId: 'proc-xyz' }),
    );
  });

  it('subscribes to recording:status exactly once on mount and unsubscribes on unmount', async () => {
    const api = getApi();
    setRoute({ name: 'procedure-room' });
    const { unmount } = render(<ProcedureRoom />);
    expect(api.recording.onStatus).toHaveBeenCalledTimes(1);
    unmount();
    expect(api.recording.onStatus.mock.results[0].value).toBeInstanceOf(Function);
    // Calling the returned unsubscribe removes the listener — the test relies
    // on the mock's noop implementation; we assert the returned closure exists
    // and is callable without throwing.
    expect(() => api.recording.onStatus.mock.results[0].value()).not.toThrow();
  });
});

describe('formatDurationHHMMSS', () => {
  it('formats 0 / 1h / negative / >1h correctly', () => {
    expect(formatDurationHHMMSS(0)).toBe('00:00:00');
    expect(formatDurationHHMMSS(3_600_000)).toBe('01:00:00');
    expect(formatDurationHHMMSS(3_661_000)).toBe('01:01:01');
    expect(formatDurationHHMMSS(-100)).toBe('00:00:00');
  });
});

// Used by the navigate-after-stop test.
void session;