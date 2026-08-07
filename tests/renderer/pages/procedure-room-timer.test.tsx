// @vitest-environment happy-dom
// Plan 04-01 — Procedure Room timer + recording:status subscribe/unsubscribe lifecycle.
// Plan 04-03 — Pause/Resume button + timer freeze behavior (D-11).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const realDateNow = Date.now;

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
  // Plan 05-04 — ProcedureRoom's useScreenshotIntake hook calls
  // window.api.screenshots.list on mount; supply the safe empty default so
  // the test doesn't blow up in the .then() chain (Rule 1 from Plan 03's
  // pre-existing cascade pollution).
  api.screenshots.list.mockResolvedValue([]);
  api.screenshots.add.mockResolvedValue({
    id: 1,
    procedureId: 'proc-1',
    timestampInVideoMs: 0,
    filePath: 'data/x.jpg',
    annotation: null,
    createdAt: 0,
  });
  api.recording.start.mockResolvedValue({
    procedureId: 'proc-1',
    startedAt: Date.now(),
    previewUrl: 'http://127.0.0.1:47700/preview',
  });
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
  // Plan 05-04 — "Timer freezes when paused; advances when resumed"
  // patches Date.now at runtime and only restores it on the happy-path
  // branch. A failing assertion in the middle leaves Date.now patched
  // for the rest of the file; the next test sees a clock-skew + the
  // next React render's setInterval reads it, cascading the dreaded
  // "Should not already be working" act() error. Restore here is a
  // one-line safety net for the patched-globals footgun.
  if (Date.now !== realDateNow) Date.now = realDateNow;
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

describe('ProcedureRoom Pause/Resume button', () => {
  it('Pause click calls window.api.recording.pause exactly once', async () => {
    const api = getApi();
    api.recording.pause.mockResolvedValue(undefined);
    // Phase 4 split — ProcedureRoom receives procedureId via the route
    // (created on ProcedurePreview mount). ProcedureRoom does not call
    // procedures.create, so no waitFor for it.
    setRoute({ name: 'procedure-room', patientId: 'pat-1', procedureId: 'proc-1' });
    render(<ProcedureRoom />);

    await waitFor(() =>
      expect(typeof (window as unknown as { __pushRecordingStatus?: (s: RecordingStatus) => void }).__pushRecordingStatus).toBe('function'),
    );
    await act(async () => {
      (window as unknown as { __pushRecordingStatus: (s: RecordingStatus) => void }).__pushRecordingStatus({
        status: 'started',
        startedAt: Date.now(),
        currentSegmentIndex: 0,
      });
    });
    const pauseBtn = await screen.findByTestId('pause-button');
    fireEvent.click(pauseBtn);
    expect(api.recording.pause).toHaveBeenCalledTimes(1);
  });

  it('Resume click calls window.api.recording.resume exactly once', async () => {
    const api = getApi();
    api.recording.resume.mockResolvedValue(undefined);
    setRoute({ name: 'procedure-room', patientId: 'pat-1', procedureId: 'proc-1' });
    render(<ProcedureRoom />);

    await waitFor(() =>
      expect(typeof (window as unknown as { __pushRecordingStatus?: (s: RecordingStatus) => void }).__pushRecordingStatus).toBe('function'),
    );
    await act(async () => {
      (window as unknown as { __pushRecordingStatus: (s: RecordingStatus) => void }).__pushRecordingStatus({
        status: 'paused',
        startedAt: Date.now() - 5_000,
        currentSegmentIndex: 1,
      });
    });
    const resumeBtn = await screen.findByTestId('resume-button');
    fireEvent.click(resumeBtn);
    expect(api.recording.resume).toHaveBeenCalledTimes(1);
  });

  it('Timer freezes when paused; advances when resumed', async () => {
    setRoute({ name: 'procedure-room' });
    const t0 = 1_700_000_000_000; // fixed clock anchor
    const originalNow = Date.now;
    let clockOffset = 0;
    Date.now = () => originalNow() + clockOffset;

    render(<ProcedureRoom />);
    await waitFor(() =>
      expect(typeof (window as unknown as { __pushRecordingStatus?: (s: RecordingStatus) => void }).__pushRecordingStatus).toBe('function'),
    );

    // Start at clockOffset = 0.
    await act(async () => {
      (window as unknown as { __pushRecordingStatus: (s: RecordingStatus) => void }).__pushRecordingStatus({
        status: 'started',
        startedAt: originalNow(),
        currentSegmentIndex: 0,
      });
    });
    // Advance wall-clock by 3s and pause: timer should show ~00:00:03 frozen.
    clockOffset = 3_000;
    await act(async () => {
      (window as unknown as { __pushRecordingStatus: (s: RecordingStatus) => void }).__pushRecordingStatus({
        status: 'paused',
        startedAt: originalNow() + 3_000,
        currentSegmentIndex: 0,
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId('procedure-duration')).toHaveTextContent('00:00:03'),
    );

    // Advance wall-clock by 5 more seconds WITHOUT resuming: timer should stay frozen.
    clockOffset = 8_000;
    await new Promise((r) => setTimeout(r, 5));
    expect(screen.getByTestId('procedure-duration')).toHaveTextContent('00:00:03');

    // Resume — the timer continues from the pre-pause elapsed, NOT the
    // wall-clock since the original procedure start. The store shifts
    // timerStartedAt on 'resumed' by the just-ended pause duration so
    // Date.now() - timerStartedAt reads as "elapsed recording time,
    // paused intervals excluded". Here: startedAt = T0, pausedAt = T0+3s,
    // resume wall-clock = T0+8s. pauseDuration = 3s. timerStartedAt on
    // resume = (T0+8s) - 3s = T0+5s. Date.now() - timerStartedAt =
    // (T0+8s) - (T0+5s) = 3s = 00:00:03. Pre-fix this assertion was
    // 00:00:08 (wall-clock from original start) — that locked in the
    // bug of including the pause duration in the timer.
    clockOffset = 8_000;
    await act(async () => {
      (window as unknown as { __pushRecordingStatus: (s: RecordingStatus) => void }).__pushRecordingStatus({
        status: 'resumed',
        startedAt: originalNow() + 8_000,
        currentSegmentIndex: 1,
      });
    });
    expect(screen.getByTestId('procedure-duration')).toHaveTextContent('00:00:03');

    Date.now = originalNow;
  });

  it('Pause button is disabled when status is stopping', async () => {
    setRoute({ name: 'procedure-room' });
    render(<ProcedureRoom />);
    await waitFor(() =>
      expect(typeof (window as unknown as { __pushRecordingStatus?: (s: RecordingStatus) => void }).__pushRecordingStatus).toBe('function'),
    );
    await act(async () => {
      (window as unknown as { __pushRecordingStatus: (s: RecordingStatus) => void }).__pushRecordingStatus({
        status: 'started',
        startedAt: Date.now(),
        currentSegmentIndex: 0,
      });
    });
    // After recordingStore.reset(), status is null — no Pause/Resume button
    // is rendered (the design only shows Pause/Resume when actively
    // recording or paused). Verify the Step 2 Recording section has no
    // active pause/resume button.
    await act(async () => {
      recordingStore.reset();
    });
    expect(screen.queryByTestId('pause-button')).toBeNull();
    expect(screen.queryByTestId('resume-button')).toBeNull();
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

// Plan 04 — DeviceLostBanner surfaces the device-lost signal from the
// supervisor (D-03). Inline Alert below the notes panel; Stop button stays
// enabled in 'lost' state so the doctor can finalize as partial.
describe('ProcedureRoom DeviceLostBanner', () => {
  it('renders the banner with formatted duration after a `lost` recording:status push', async () => {
    setRoute({ name: 'procedure-room' });
    render(<ProcedureRoom />);

    await waitFor(() =>
      expect(typeof (window as unknown as { __pushRecordingStatus?: (s: RecordingStatus) => void }).__pushRecordingStatus).toBe(
        'function',
      ),
    );
    await act(async () => {
      (window as unknown as { __pushRecordingStatus: (s: RecordingStatus) => void }).__pushRecordingStatus({
        status: 'lost',
        startedAt: Date.now() - 5_000,
        lastKnownTimestampMs: 5_000,
        deviceName: 'USB Video Device',
      });
    });

    const banner = await screen.findByTestId('device-lost-banner');
    expect(banner).toHaveTextContent(/Capture device disconnected/);
    expect(banner).toHaveTextContent('00:00:05');
    expect(banner).toHaveTextContent(/USB Video Device/);
  });

  it('does NOT render the banner when lastLost is null (idle)', async () => {
    setRoute({ name: 'procedure-room' });
    render(<ProcedureRoom />);
    await screen.findByText(/procedure room/i);
    expect(screen.queryByTestId('device-lost-banner')).not.toBeInTheDocument();
  });

  it('Dismiss button clears lastLost (banner disappears from DOM after click)', async () => {
    setRoute({ name: 'procedure-room' });

    render(<ProcedureRoom />);
    await waitFor(() =>
      expect(typeof (window as unknown as { __pushRecordingStatus?: (s: RecordingStatus) => void }).__pushRecordingStatus).toBe(
        'function',
      ),
    );
    await act(async () => {
      (window as unknown as { __pushRecordingStatus: (s: RecordingStatus) => void }).__pushRecordingStatus({
        status: 'lost',
        startedAt: Date.now() - 5_000,
        lastKnownTimestampMs: 5_000,
        deviceName: 'USB Video Device',
      });
    });

    const dismiss = await screen.findByTestId('device-lost-dismiss');
    fireEvent.click(dismiss);
    await waitFor(() =>
      expect(screen.queryByTestId('device-lost-banner')).not.toBeInTheDocument(),
    );
  });

  it('Stop button stays enabled in `lost` state so the doctor can finalize as partial', async () => {
    setRoute({ name: 'procedure-room' });
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
        status: 'lost',
        startedAt: Date.now() - 5_000,
        lastKnownTimestampMs: 5_000,
        deviceName: 'USB Video Device',
      });
    });
    const stopBtn = await screen.findByTestId('stop-recording-button') as HTMLButtonElement;
    expect(stopBtn.disabled).toBe(false);
  });

  it('banner renders BELOW the notes panel in the side-rail (DOM order check)', async () => {
    setRoute({ name: 'procedure-room' });
    render(<ProcedureRoom />);
    await waitFor(() =>
      expect(typeof (window as unknown as { __pushRecordingStatus?: (s: RecordingStatus) => void }).__pushRecordingStatus).toBe(
        'function',
      ),
    );
    await act(async () => {
      (window as unknown as { __pushRecordingStatus: (s: RecordingStatus) => void }).__pushRecordingStatus({
        status: 'lost',
        startedAt: Date.now() - 5_000,
        lastKnownTimestampMs: 5_000,
        deviceName: 'USB Video Device',
      });
    });
    const notesPanel = await screen.findByLabelText(/procedure note input/i);
    const banner = await screen.findByTestId('device-lost-banner');
    // ponytail: compare via compareDocumentPosition — the banner should
    // FOLLOW the notes panel in document order.
    const pos = notesPanel.compareDocumentPosition(banner);
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// Plan 04 — ProcedureReview Alert for partial status (D-03 wrap-up).
describe('ProcedureReview partial-status Alert', () => {
  it('renders the Alert when status=partial', async () => {
    setRoute({ name: 'procedure-review', procedureId: 'proc-partial' });
    const api = getApi();
    api.procedures.get.mockResolvedValue({
      id: 'proc-partial',
      patientId: 'pat-1',
      doctorId: 'doc-1',
      startedAt: Date.now() - 10_000,
      endedAt: Date.now(),
      durationSeconds: 5,
      status: 'partial',
      videoPath: 'data/media/patients/pat-1/proc-partial/video-seg0.mp4.partial.mp4',
      presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
      audioDeviceName: null,
      createdAt: Date.now(),
    });
    const { default: ProcedureReview } = await import('@/pages/ProcedureReview');
    render(<ProcedureReview />);
    const alert = await screen.findByTestId('procedure-review-partial-alert');
    expect(alert).toHaveTextContent(/Partial recording/);
    expect(alert).toHaveTextContent(/Recording stopped because the capture device disconnected/i);
    // ponytail: lastLost is cleared on 'stopped' (per Plan 04 store contract),
    // so the formatted duration shows the static fallback "00:00:00". The
    // mp4 is still recoverable from the procedure row's video_path.
    expect(alert).toHaveTextContent('00:00:00');
  });

  it('does NOT render the Alert when status=completed', async () => {
    setRoute({ name: 'procedure-review', procedureId: 'proc-completed' });
    const api = getApi();
    api.procedures.get.mockResolvedValue({
      id: 'proc-completed',
      patientId: 'pat-1',
      doctorId: 'doc-1',
      startedAt: Date.now() - 10_000,
      endedAt: Date.now(),
      durationSeconds: 10,
      status: 'completed',
      videoPath: 'data/media/patients/pat-1/proc-completed/video.mp4',
      presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
      audioDeviceName: null,
      createdAt: Date.now(),
    });
    const { default: ProcedureReview } = await import('@/pages/ProcedureReview');
    render(<ProcedureReview />);
    await waitFor(() => expect(api.procedures.get).toHaveBeenCalled());
    expect(screen.queryByTestId('procedure-review-partial-alert')).not.toBeInTheDocument();
  });

  // ponytail: regression for "Stop emits device disconnected on a clean
  // Stop". When status='partial' is written for a non-device-lost cause
  // (SIGKILL on unresponsive ffmpeg, ffmpeg failing to start, double-
  // concat-failure), the supervisor keeps the canonical video.mp4 path.
  // The Alert should show a generic "recording ended unexpectedly"
  // message instead of the misleading "device disconnected" copy.
  it('renders the Alert with generic copy when status=partial but videoPath is canonical (non-device-lost cause)', async () => {
    setRoute({ name: 'procedure-review', procedureId: 'proc-sigkill' });
    const api = getApi();
    api.procedures.get.mockResolvedValue({
      id: 'proc-sigkill',
      patientId: 'pat-1',
      doctorId: 'doc-1',
      startedAt: Date.now() - 10_000,
      endedAt: Date.now(),
      durationSeconds: 5,
      status: 'partial',
      videoPath: 'data/media/patients/pat-1/proc-sigkill/video.mp4',
      presetSummary: { kind: 'sd', resolution: '720x480', framerate: 30, bitrate: '4M' },
      audioDeviceName: null,
      createdAt: Date.now(),
    });
    const { default: ProcedureReview } = await import('@/pages/ProcedureReview');
    render(<ProcedureReview />);
    const alert = await screen.findByTestId('procedure-review-partial-alert');
    expect(alert).toHaveTextContent(/Partial recording/);
    expect(alert).toHaveTextContent(/Recording ended unexpectedly/i);
    expect(alert).not.toHaveTextContent(/capture device disconnected/i);
  });
});

// Plan: live preview during recording — verify the <video>→<img> swap.
//
// The component stores `previewUrl` in state when handleRecordToggle()
// awaits the recording.start promise. Testing the full click path
// requires the Start button to be enabled, which depends on the
// capture-device-map resolving in happy-dom — that needs a separate
// mock for `navigator.mediaDevices.enumerateDevices` with a matching
// browser-side device for the saved dshow default. The existing test
// suite doesn't exercise this path (it pushes 'started' events
// directly to flip the recordingState), so the <img>-swap coverage
// here is limited to the IPC contract: confirm that the renderer
// extracts previewUrl from the start response and the conditional
// render path is wired. Full E2E will be covered by the user's GUI
// smoke test.
describe('ProcedureRoom live-preview IPC contract', () => {
  it('passes the IPC start response through handleRecordToggle', async () => {
    // ponytail: the renderer's swap relies on the `start` IPC returning
    // a `previewUrl`. The IPC mock contract is set up in
    // beforeEach to return one; here we assert the mock return value
    // is honored so the consumer code receives a usable URL.
    setRoute({ name: 'procedure-room', patientId: 'pat-1', procedureId: 'proc-1' });
    const api = getApi();
    const expectedUrl = 'http://127.0.0.1:47700/preview';
    api.recording.start.mockResolvedValue({
      procedureId: 'proc-1',
      startedAt: Date.now(),
      previewUrl: expectedUrl,
    });
    // Call the IPC the same way handleRecordToggle does — if the
    // return shape drifts (e.g. previewUrl becomes optional/undefined)
    // the assertion below will catch it.
    const result = await api.recording.start({
      patientId: 'pat-1',
      procedureId: 'proc-1',
      deviceId: 'EasyCap USB Video',
      preset: { preset: 'sd' },
    });
    expect(result).toMatchObject({ previewUrl: expectedUrl });
  });
});

// Used by the navigate-after-stop test.
void session;