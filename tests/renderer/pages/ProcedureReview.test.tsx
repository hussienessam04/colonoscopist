// @vitest-environment happy-dom
// ProcedureReview — pause markers + DeviceLostBanner + Back-to-Patient +
// StatusBadge wiring. Plan 02 polish over the Plan 01 baseline.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../setup';
import { getApi, mockApi } from '../setup';
import { setRoute } from '@/store/route';
import { recordingStore } from '@/store/recording';
import ProcedureReview from '@/pages/ProcedureReview';
import type {
  Patient,
  Procedure,
  ProcedureSegment,
  ProcedureStatus,
} from '@shared/ipc-contract';

afterEach(() => {
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

    const capture = await screen.findByTestId('screenshot-timeline-capture');
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
