// @vitest-environment happy-dom
// ProcedureReview — pause markers + DeviceLostBanner + Back-to-Patient +
// StatusBadge wiring. Plan 02 polish over the Plan 01 baseline.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../setup';
import { getApi, mockApi } from '../setup';
import { setRoute } from '@/store/route';
import { recordingStore } from '@/store/recording';
import { screenshotToastStore } from '@/store/screenshot-toast';
import ProcedureReview from '@/pages/ProcedureReview';
import type {
  Patient,
  Procedure,
  ProcedureSegment,
  ProcedureStatus,
  Screenshot,
} from '@shared/ipc-contract';

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
);
vi.mock('sonner', () => ({ toast: toastMock }));

afterEach(() => {
  screenshotToastStore.reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const patient: Patient = {
  id: 'pat-1',
  fullName: 'Jane Doe',
  dob: '1970-01-01',
  gender: 'female',
  mrn: 'MRN-1',
  phone: null,
  notes: null,
  createdAt: 1_000,
  updatedAt: 1_000,
  deletedAt: null,
};

function makeProcedure(overrides: Partial<Procedure> = {}): Procedure {
  return {
    id: 'proc-1',
    patientId: 'pat-1',
    doctorId: 'doc-1',
    startedAt: 1_000,
    endedAt: 2_500_000,
    durationSeconds: 2_499,
    status: 'completed',
    videoPath: 'data/media/patients/pat-1/proc-1/video.mp4',
    presetSummary: { kind: 'hd', resolution: '1920x1080', framerate: 30, bitrate: '10M' },
    audioDeviceName: null,
    createdAt: 1_000,
    ...overrides,
  };
}

function makeSegments(count: number): ProcedureSegment[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    procedureId: 'proc-1',
    segmentIndex: i,
    filePath: `data/media/patients/pat-1/proc-1/seg${i}.mp4`,
    startedAt: (i + 1) * 30_000,
    endedAt: (i + 1) * 30_000 + 20_000,
  }));
}

function setupApiForStatus(
  status: ProcedureStatus,
  videoPath: string,
  segmentCount: number,
): void {
  const api = getApi();
  const proc = makeProcedure({ status, videoPath });
  api.procedures.get.mockResolvedValue(proc);
  api.procedures.listSegments.mockResolvedValue(makeSegments(segmentCount));
  api.procedureNotes.list.mockResolvedValue([]);
  api.screenshots.list.mockResolvedValue([]);
  api.screenshots.add.mockResolvedValue({
    id: 1,
    procedureId: 'proc-1',
    timestampInVideoMs: 0,
    filePath: 'data/x.jpg',
    annotation: null,
    createdAt: 0,
  });
  api.screenshots.updateAnnotation.mockImplementation((input) =>
    Promise.resolve({
      id: input.id,
      procedureId: 'proc-1',
      timestampInVideoMs: 0,
      filePath: 'data/x.jpg',
      annotation: input.annotation,
      createdAt: 0,
    }),
  );
  api.patients.get.mockResolvedValue(patient);
}

const deleteScreenshots: Screenshot[] = [
  {
    id: 21,
    procedureId: 'proc-1',
    timestampInVideoMs: 1_000,
    filePath: 'data/media/patients/pat-1/proc-1/screenshots/1000.jpg',
    annotation: null,
    createdAt: 1_000,
  },
  {
    id: 22,
    procedureId: 'proc-1',
    timestampInVideoMs: 2_000,
    filePath: 'data/media/patients/pat-1/proc-1/screenshots/2000.jpg',
    annotation: null,
    createdAt: 2_000,
  },
];

function setupDeleteApi(): void {
  setupApiForStatus('completed', 'data/media/video.mp4', 0);
  getApi().screenshots.list.mockResolvedValue(deleteScreenshots);
}

describe('ProcedureReview', () => {
  beforeEach(() => {
    setRoute({ name: 'procedure-review', procedureId: 'proc-1' });
    recordingStore.reset();
    // Fresh mock api per test.
    mockApi();
  });

  it('mounts DeviceLostBanner when status=partial + .partial.mp4 suffix', async () => {
    setupApiForStatus('partial', 'data/media/video.partial.mp4', 0);
    recordingStore.setStatus({
      status: 'lost',
      startedAt: 0,
      lastKnownTimestampMs: 30_000,
      deviceName: 'EasyCap USB Video',
    });

    render(<ProcedureReview />);

    await waitFor(() => {
      expect(screen.getByTestId('device-lost-banner')).toBeInTheDocument();
    });
  });

  it('does NOT mount DeviceLostBanner when status=completed', async () => {
    setupApiForStatus('completed', 'data/media/video.mp4', 0);

    render(<ProcedureReview />);

    // Procedure loads.
    await waitFor(() => {
      expect(screen.getByTestId('procedure-review-metadata')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('device-lost-banner')).toBeNull();
  });

  it('renders one pause marker per procedure_segment', async () => {
    setupApiForStatus('completed', 'data/media/video.mp4', 3);

    render(<ProcedureReview />);

    await waitFor(() => {
      expect(screen.getAllByTestId('scrubber-pause-marker')).toHaveLength(3);
    });
    // Each marker carries an aria-label + title in the canonical form.
    const markers = screen.getAllByTestId('scrubber-pause-marker');
    expect(markers[0]?.getAttribute('aria-label')).toMatch(/^Pause 1:/);
    expect(markers[0]?.getAttribute('title')).toMatch(/^Pause 1:/);
  });

  it('renders zero pause markers when segments is empty', async () => {
    setupApiForStatus('completed', 'data/media/video.mp4', 0);

    render(<ProcedureReview />);

    await waitFor(() => {
      expect(screen.getByTestId('scrubber-track')).toBeInTheDocument();
    });
    expect(screen.queryAllByTestId('scrubber-pause-marker')).toHaveLength(0);
  });

  it('navigates to patient-detail when the Back to Patient button is clicked', async () => {
    setupApiForStatus('completed', 'data/media/video.mp4', 0);

    render(<ProcedureReview />);

    const back = await screen.findByTestId('procedure-review-back');
    await userEvent.click(back);

    // useRoute() exposes `current` from the store; verify it flipped.
    const { getRoute } = await import('@/store/route');
    expect(getRoute().name).toBe('patient-detail');
  });

  it('renders the StatusBadge with the procedure status text', async () => {
    setupApiForStatus('completed', 'data/media/video.mp4', 0);

    render(<ProcedureReview />);

    const badge = await screen.findByTestId('status-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent?.toLowerCase()).toContain('completed');
  });

  it('disables the +Capture button when status=crashed (D-13)', async () => {
    setupApiForStatus('crashed', 'data/media/video.mp4', 0);

    render(<ProcedureReview />);

    // ponytail: wait for the procedure to load (status drives the disabled
    // attribute). findByTestId returns the button at first render — when
    // status is undefined (procedure still loading) captureAllowed() returns
    // true, so the button starts enabled. waitFor ensures the post-load
    // re-render has flushed before the disabled assertion.
    await screen.findByTestId('status-badge');
    const capture = screen.getByTestId('screenshot-timeline-capture');
    expect(capture).toBeDisabled();
  });

  it('enables the +Capture button when status=partial (D-13)', async () => {
    setupApiForStatus('partial', 'data/media/video.partial.mp4', 0);

    render(<ProcedureReview />);

    const capture = await screen.findByTestId('screenshot-timeline-capture');
    expect(capture).not.toBeDisabled();
  });

  it('shows the real TrimControls card for non-partial procedures (Plan 03)', async () => {
    setupApiForStatus('completed', 'data/media/video.mp4', 0);

    render(<ProcedureReview />);

    await waitFor(() => {
      // Plan 03 replaces the placeholder card with the real TrimControls.
      expect(screen.getByTestId('trim-controls')).toBeInTheDocument();
      expect(screen.getByTestId('trim-mode-toggle')).toBeInTheDocument();
    });
  });
});

describe('ProcedureReview gallery delete (G-05-13)', () => {
  beforeEach(() => {
    setRoute({ name: 'procedure-review', procedureId: 'proc-1' });
    recordingStore.reset();
    screenshotToastStore.reset();
    mockApi();
    setupDeleteApi();
  });

  it('× click removes the thumbnail from the timeline DOM synchronously', async () => {
    render(<ProcedureReview />);
    await waitFor(() => expect(screen.getAllByTestId('screenshot-thumbnail')).toHaveLength(2));

    fireEvent.click(screen.getAllByLabelText(/Delete screenshot at/)[0]!);

    expect(screen.queryAllByTestId('screenshot-thumbnail')).toHaveLength(1);
    expect(screen.queryByText('00:00:01')).not.toBeInTheDocument();
  });

  it('Undo restores the thumbnail', async () => {
    render(<ProcedureReview />);
    await waitFor(() => expect(screen.getAllByTestId('screenshot-thumbnail')).toHaveLength(2));

    fireEvent.click(screen.getAllByLabelText(/Delete screenshot at/)[0]!);
    expect(screen.queryAllByTestId('screenshot-thumbnail')).toHaveLength(1);

    const deleteToast = toastMock.mock.calls.find(([message]) =>
      String(message).startsWith('Screenshot deleted at'),
    );
    const options = deleteToast?.[1] as
      | { action?: { label?: string; onClick?: () => void } }
      | undefined;
    expect(options?.action?.label).toBe('Undo');
    act(() => options?.action?.onClick?.());

    await waitFor(() => expect(screen.getAllByTestId('screenshot-thumbnail')).toHaveLength(2));
  });

  it('IPC failure fires toast.error', async () => {
    render(<ProcedureReview />);
    await waitFor(() => expect(screen.getAllByTestId('screenshot-thumbnail')).toHaveLength(2));
    getApi().screenshots.delete.mockRejectedValueOnce(new Error('IPC unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.useFakeTimers();

    fireEvent.click(screen.getAllByLabelText(/Delete screenshot at/)[0]!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(toastMock.error).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to delete screenshot: IPC unavailable/),
    );
  });
});

// Plan 08-10 / G-08-4 — gated IPC rejection on any of the useProcedures
// channels (or patients.get) renders <EmptyStateCard> in the left
// rail instead of crashing.
describe('ProcedureReview — gated-IPC graceful degrade (08-10)', () => {
  beforeEach(() => {
    setRoute({ name: 'procedure-review', procedureId: 'proc-1' });
    recordingStore.reset();
    mockApi();
  });

  it('renders <EmptyStateCard> when useProcedures channels return {ok: false}', async () => {
    const api = getApi();
    // procedure gate rejects — should flip gated=true via useProcedures
    // (propagated to the page's `gated = patientGated || proceduresGated`).
    api.procedures.get.mockResolvedValue({ ok: false, code: 'IPC_LICENSE_INVALID' });
    api.procedures.listSegments.mockResolvedValue([]);
    api.procedureNotes.list.mockResolvedValue([]);
    api.screenshots.list.mockResolvedValue([]);
    api.patients.get.mockResolvedValue(patient);

    render(<ProcedureReview />);

    expect(await screen.findByTestId('gated-empty-state')).toBeInTheDocument();
  });
});
