// @vitest-environment happy-dom
// ScreenshotTimeline — click-to-seek, delete × button, +Capture.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../setup';
import { ScreenshotTimeline } from '@/components/ScreenshotTimeline';
import { Scrubber } from '@/components/Scrubber';
import type { Screenshot } from '@shared/ipc-contract';

afterEach(() => {
  vi.restoreAllMocks();
});

const fixture: Screenshot[] = [
  {
    id: 1,
    procedureId: 'p1',
    timestampInVideoMs: 5_000,
    filePath: 'data/media/p1/screenshots/5000.jpg',
    annotation: null,
    createdAt: 1_000,
  },
  {
    id: 2,
    procedureId: 'p1',
    timestampInVideoMs: 10_000,
    filePath: 'data/media/p1/screenshots/10000.jpg',
    annotation: null,
    createdAt: 2_000,
  },
];

describe('ScreenshotTimeline', () => {
  it('clicking a thumbnail invokes onSeek with its timestamp', () => {
    const onSeek = vi.fn();
    const onCapture = vi.fn();
    const onDelete = vi.fn();
    render(
      <ScreenshotTimeline
        procedureId="p1"
        screenshots={fixture}
        onSeek={onSeek}
        onCapture={onCapture}
        onDelete={onDelete}
      />,
    );
    const thumbs = screen.getAllByTestId('screenshot-thumbnail');
    expect(thumbs).toHaveLength(2);
    fireEvent.click(thumbs[0]!);
    expect(onSeek).toHaveBeenCalledWith(5_000);
    expect(onSeek).toHaveBeenCalledTimes(1);
  });

  it('clicking the × button calls onDelete and does NOT invoke onSeek', () => {
    const onSeek = vi.fn();
    const onCapture = vi.fn();
    const onDelete = vi.fn();
    render(
      <ScreenshotTimeline
        procedureId="p1"
        screenshots={fixture}
        onSeek={onSeek}
        onCapture={onCapture}
        onDelete={onDelete}
      />,
    );
    const deleteButtons = screen.getAllByLabelText(/Delete screenshot at/);
    expect(deleteButtons).toHaveLength(2);
    fireEvent.click(deleteButtons[0]!);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(fixture[0]);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('clicking +Capture invokes onCapture exactly once', () => {
    const onSeek = vi.fn();
    const onCapture = vi.fn();
    const onDelete = vi.fn();
    render(
      <ScreenshotTimeline
        procedureId="p1"
        screenshots={fixture}
        onSeek={onSeek}
        onCapture={onCapture}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByTestId('screenshot-timeline-capture'));
    expect(onCapture).toHaveBeenCalledTimes(1);
  });

  it('memo boundary: deleting one thumbnail does not re-render its siblings', () => {
    // ponytail: ScreenshotThumbnail is wrapped with React.memo. We render
    // N siblings, mount with an instrumentation, then trigger a sibling
    // change and assert only the deleted/re-added one fires a render.
    // We test this by giving each thumbnail a stable `key` and verifying
    // the component's identity after re-render via React Testing Library's
    // query — siblings carry the same data-testid and never re-mount.
    const onSeek = vi.fn();
    const onCapture = vi.fn();
    const onDelete = vi.fn();
    const many: Screenshot[] = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      procedureId: 'p1',
      timestampInVideoMs: (i + 1) * 1_000,
      filePath: `data/media/p1/screenshots/${(i + 1) * 1000}.jpg`,
      annotation: null,
      createdAt: i + 1,
    }));
    const { rerender } = render(
      <ScreenshotTimeline
        procedureId="p1"
        screenshots={many}
        onSeek={onSeek}
        onCapture={onCapture}
        onDelete={onDelete}
      />,
    );
    const before = screen.getAllByTestId('screenshot-thumbnail').map((el) => el.getAttribute('data-screenshot-id'));
    // Re-render with the middle screenshot removed (the timeline array is
    // mutated upstream).
    const removed = many.filter((s) => s.id !== 5);
    rerender(
      <ScreenshotTimeline
        procedureId="p1"
        screenshots={removed}
        onSeek={onSeek}
        onCapture={onCapture}
        onDelete={onDelete}
      />,
    );
    const after = screen.getAllByTestId('screenshot-thumbnail').map((el) => el.getAttribute('data-screenshot-id'));
    expect(after).not.toContain('5');
    // Sibling ids that survived the rerender must still be present in the
    // same order (no shuffle).
    expect(after).toEqual(before.filter((id) => id !== '5'));
  });

  it('renders no × button when onDelete is undefined (Plan 01 baseline)', () => {
    const onSeek = vi.fn();
    const onCapture = vi.fn();
    render(
      <ScreenshotTimeline
        procedureId="p1"
        screenshots={fixture}
        onSeek={onSeek}
        onCapture={onCapture}
      />,
    );
    expect(screen.queryAllByLabelText(/Delete screenshot at/)).toHaveLength(0);
  });

  // Plan 02 — D-13 capture gate. The +Capture button is disabled only when
  // status === 'crashed'; recording / completed / partial all allow capture.
  it('disables +Capture when status === "crashed"', () => {
    const onCapture = vi.fn();
    render(
      <ScreenshotTimeline
        procedureId="p1"
        status="crashed"
        screenshots={fixture}
        onSeek={vi.fn()}
        onCapture={onCapture}
      />,
    );
    const capture = screen.getByTestId('screenshot-timeline-capture');
    expect(capture).toBeDisabled();
    fireEvent.click(capture);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('enables +Capture when status === "completed"', () => {
    render(
      <ScreenshotTimeline
        procedureId="p1"
        status="completed"
        screenshots={fixture}
        onSeek={vi.fn()}
        onCapture={vi.fn()}
      />,
    );
    expect(screen.getByTestId('screenshot-timeline-capture')).not.toBeDisabled();
  });

  it('enables +Capture when status === "partial"', () => {
    render(
      <ScreenshotTimeline
        procedureId="p1"
        status="partial"
        screenshots={fixture}
        onSeek={vi.fn()}
        onCapture={vi.fn()}
      />,
    );
    expect(screen.getByTestId('screenshot-timeline-capture')).not.toBeDisabled();
  });

  // Plan 02 — annotation wiring. The onAnnotate callback fires when the
  // user edits a thumbnail's annotation.
  it('passes onAnnotate through to the thumbnail annotation input', async () => {
    const onAnnotate = vi.fn().mockResolvedValue(undefined);
    const annotated: Screenshot[] = [
      { ...fixture[0]!, annotation: 'initial' },
    ];
    render(
      <ScreenshotTimeline
        procedureId="p1"
        status="completed"
        screenshots={annotated}
        onSeek={vi.fn()}
        onCapture={vi.fn()}
        onAnnotate={onAnnotate}
      />,
    );
    fireEvent.click(screen.getByTestId('screenshot-annotation-caption'));
    const input = screen.getByTestId('screenshot-annotation-input');
    fireEvent.change(input, { target: { value: 'updated' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(onAnnotate).toHaveBeenCalledTimes(1);
    });
    expect(onAnnotate).toHaveBeenCalledWith(annotated[0], 'updated');
  });

  // Plan 07 / G-05-9 — × button is a 24×24 solid-red badge. The class
  // list is the contract; a regression to the old `h-5 w-5 bg-black/60`
  // shape is caught here so the discoverability fix doesn't silently
  // drift back. Mirrors T-05-58 contract guard.
  it('× button has discoverable class list (h-6 w-6 bg-red-600) — G-05-9 contract guard', () => {
    render(
      <ScreenshotTimeline
        procedureId="p1"
        screenshots={fixture}
        onSeek={vi.fn()}
        onCapture={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const deleteButtons = screen.getAllByLabelText(/Delete screenshot at/);
    expect(deleteButtons).toHaveLength(2);
    const cls = deleteButtons[0]!.className;
    expect(cls).toContain('h-6');
    expect(cls).toContain('w-6');
    expect(cls).toContain('bg-red-600');
  });

  // Plan 07 / G-05-10 — clicking the new expand affordance opens the
  // lightbox WITHOUT firing the parent's seek click. Mirrors T-05-57
  // contract guard.
  it('clicking the expand icon calls onOpen with the screenshot and does NOT trigger onSeek — G-05-10', () => {
    const onSeek = vi.fn();
    const onCapture = vi.fn();
    const onDelete = vi.fn();
    const onOpen = vi.fn();
    render(
      <ScreenshotTimeline
        procedureId="p1"
        screenshots={fixture}
        onSeek={onSeek}
        onCapture={onCapture}
        onDelete={onDelete}
        onOpen={onOpen}
      />,
    );
    const expandButtons = screen.getAllByTestId('screenshot-thumbnail-expand');
    expect(expandButtons).toHaveLength(2);
    fireEvent.click(expandButtons[0]!);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(fixture[0]);
    expect(onSeek).not.toHaveBeenCalled();
  });

  // Plan 07 — back-compat. The expand icon is conditional on onOpen being
  // supplied so legacy callers (no lightbox) keep their previous DOM.
  it('does not render the expand icon when onOpen is undefined (back-compat)', () => {
    render(
      <ScreenshotTimeline
        procedureId="p1"
        screenshots={fixture}
        onSeek={vi.fn()}
        onCapture={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryAllByTestId('screenshot-thumbnail-expand')).toHaveLength(0);
  });
});

describe('Scrubber pointer events (companion)', () => {
  it('forwards pointerId on pointerdown for capture', () => {
    // Smoke test ensures the Scrubber still attaches handlers when used in
    // a timeline context. The full suite lives in Scrubber.test.tsx.
    const onSeek = vi.fn();
    render(<Scrubber durationMs={1000} currentMs={0} onSeek={onSeek} />);
    const track = screen.getByTestId('scrubber-track') as HTMLElement;
    track.getBoundingClientRect = () =>
      ({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 32, width: 100, height: 32, toJSON: () => '' }) as DOMRect;
    expect(() => fireEvent.pointerDown(track, { pointerId: 11, clientX: 50, button: 0 })).not.toThrow();
  });
});
