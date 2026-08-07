// @vitest-environment happy-dom
// Scrubber.tsx — pointer-event click-to-seek + drag-to-seek + setPointerCapture.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '../setup';
import { Scrubber } from '@/components/Scrubber';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Scrubber', () => {
  it('calls onSeek with the duration midpoint on a 50% click', () => {
    const onSeek = vi.fn();
    render(<Scrubber durationMs={10_000} currentMs={0} onSeek={onSeek} />);
    const track = screen.getByTestId('scrubber-track') as HTMLElement;
    // Mock the bounding rect: width 200, left 0.
    track.getBoundingClientRect = () =>
      ({ x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 32, width: 200, height: 32, toJSON: () => '' }) as DOMRect;
    fireEvent.pointerDown(track, {
      pointerId: 1,
      clientX: 100, // 50% of 200
      button: 0,
    });
    fireEvent.pointerUp(track, { pointerId: 1, clientX: 100 });
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(5_000);
  });

  it('drag-to-seek calls onSeek again on a pointermove with captured pointer', () => {
    const onSeek = vi.fn();
    render(<Scrubber durationMs={10_000} currentMs={0} onSeek={onSeek} />);
    const track = screen.getByTestId('scrubber-track') as HTMLElement;
    track.getBoundingClientRect = () =>
      ({ x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 32, width: 200, height: 32, toJSON: () => '' }) as DOMRect;
    fireEvent.pointerDown(track, { pointerId: 2, clientX: 100, button: 0 });
    fireEvent.pointerMove(track, { pointerId: 2, clientX: 160 });
    fireEvent.pointerUp(track, { pointerId: 2, clientX: 160 });
    // First call: click at 50% -> 5_000. Second call: drag to 80% -> 8_000.
    expect(onSeek).toHaveBeenCalledTimes(2);
    expect(onSeek).toHaveBeenNthCalledWith(1, 5_000);
    expect(onSeek).toHaveBeenNthCalledWith(2, 8_000);
  });

  it('calls setPointerCapture on pointerdown (PITFALLS §8)', () => {
    const onSeek = vi.fn();
    render(<Scrubber durationMs={10_000} currentMs={0} onSeek={onSeek} />);
    const track = screen.getByTestId('scrubber-track') as HTMLElement;
    track.getBoundingClientRect = () =>
      ({ x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 32, width: 200, height: 32, toJSON: () => '' }) as DOMRect;
    const spy = vi.spyOn(track, 'setPointerCapture');
    fireEvent.pointerDown(track, { pointerId: 7, clientX: 0, button: 0 });
    expect(spy).toHaveBeenCalledWith(7);
    fireEvent.pointerUp(track, { pointerId: 7, clientX: 0 });
  });

  it('renders a progress fill width matching currentMs/durationMs', () => {
    const onSeek = vi.fn();
    render(<Scrubber durationMs={200} currentMs={50} onSeek={onSeek} />);
    const fill = screen.getByTestId('scrubber-fill') as HTMLDivElement;
    // 50 / 200 = 25%
    expect(fill.style.width).toBe('25%');
  });

  it('clamps progress width to 100% when currentMs > durationMs', () => {
    const onSeek = vi.fn();
    render(<Scrubber durationMs={100} currentMs={250} onSeek={onSeek} />);
    const fill = screen.getByTestId('scrubber-fill') as HTMLDivElement;
    expect(fill.style.width).toBe('100%');
  });

  // Plan 02 — D-11 pause markers from procedure_segments.
  it('renders one pause marker per segment at startedAt/durationMs percent', () => {
    const onSeek = vi.fn();
    const segments = [
      { id: 1, procedureId: 'p1', segmentIndex: 0, filePath: '', startedAt: 2500, endedAt: 7500 },
      { id: 2, procedureId: 'p1', segmentIndex: 1, filePath: '', startedAt: 5000, endedAt: 10000 },
      { id: 3, procedureId: 'p1', segmentIndex: 2, filePath: '', startedAt: 7500, endedAt: 12500 },
    ];
    render(<Scrubber durationMs={10_000} currentMs={0} onSeek={onSeek} segments={segments} />);
    const markers = screen.getAllByTestId('scrubber-pause-marker');
    expect(markers).toHaveLength(3);
    expect(markers[0]?.getAttribute('aria-label')).toMatch(/^Pause 1:/);
    expect(markers[1]?.getAttribute('aria-label')).toMatch(/^Pause 2:/);
    expect(markers[2]?.getAttribute('aria-label')).toMatch(/^Pause 3:/);
    // 2500/10000 = 25%
    expect((markers[0] as HTMLElement).style.left).toBe('25%');
  });

  it('renders zero pause markers when segments prop is absent', () => {
    const onSeek = vi.fn();
    render(<Scrubber durationMs={10_000} currentMs={0} onSeek={onSeek} />);
    expect(screen.queryAllByTestId('scrubber-pause-marker')).toHaveLength(0);
  });

  it('renders zero pause markers when segments prop is empty array', () => {
    const onSeek = vi.fn();
    render(<Scrubber durationMs={10_000} currentMs={0} onSeek={onSeek} segments={[]} />);
    expect(screen.queryAllByTestId('scrubber-pause-marker')).toHaveLength(0);
  });

  // Plan 03 — trim handles (D-06).
  it('renders two trim handles + a trim region when trimMode=true + inMs/outMs supplied', () => {
    const onSeek = vi.fn();
    const onTrim = vi.fn();
    render(
      <Scrubber
        durationMs={20_000}
        currentMs={0}
        onSeek={onSeek}
        trimMode={true}
        inMs={2_000}
        outMs={18_000}
        onTrim={onTrim}
      />,
    );
    expect(screen.getByTestId('scrubber-trim-handle-in')).toBeInTheDocument();
    expect(screen.getByTestId('scrubber-trim-handle-out')).toBeInTheDocument();
    expect(screen.getByTestId('scrubber-trim-region')).toBeInTheDocument();
  });

  it('does NOT render trim handles when trimMode=false (default)', () => {
    const onSeek = vi.fn();
    render(<Scrubber durationMs={20_000} currentMs={0} onSeek={onSeek} />);
    expect(screen.queryByTestId('scrubber-trim-handle-in')).toBeNull();
    expect(screen.queryByTestId('scrubber-trim-handle-out')).toBeNull();
    expect(screen.queryByTestId('scrubber-trim-region')).toBeNull();
  });

  it('in-handle drag clamps at outMs - 1000ms (1000ms minimum gap)', () => {
    const onSeek = vi.fn();
    const onTrim = vi.fn();
    render(
      <Scrubber
        durationMs={20_000}
        currentMs={0}
        onSeek={onSeek}
        trimMode={true}
        inMs={2_000}
        outMs={10_000}
        onTrim={onTrim}
      />,
    );
    const inHandle = screen.getByTestId('scrubber-trim-handle-in') as HTMLElement;
    inHandle.getBoundingClientRect = () =>
      ({ x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 32, width: 200, height: 32, toJSON: () => '' }) as DOMRect;
    const track = screen.getByTestId('scrubber-track') as HTMLElement;
    track.getBoundingClientRect = () =>
      ({ x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 32, width: 200, height: 32, toJSON: () => '' }) as DOMRect;
    // Attempt to drag the in-handle to 90% (18_000ms), past outMs (10_000ms).
    // clampHandle should pin it at outMs - 1000 = 9_000ms.
    fireEvent.pointerDown(inHandle, { pointerId: 1, clientX: 180, button: 0 });
    expect(onTrim).toHaveBeenCalledWith({ inMs: 9_000, outMs: 10_000 });
  });

  it('out-handle drag clamps at inMs + 1000ms (1000ms minimum gap)', () => {
    const onSeek = vi.fn();
    const onTrim = vi.fn();
    render(
      <Scrubber
        durationMs={20_000}
        currentMs={0}
        onSeek={onSeek}
        trimMode={true}
        inMs={5_000}
        outMs={10_000}
        onTrim={onTrim}
      />,
    );
    const outHandle = screen.getByTestId('scrubber-trim-handle-out') as HTMLElement;
    const track = screen.getByTestId('scrubber-track') as HTMLElement;
    track.getBoundingClientRect = () =>
      ({ x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 32, width: 200, height: 32, toJSON: () => '' }) as DOMRect;
    // Attempt to drag the out-handle to 10% (2_000ms), past inMs (5_000ms).
    // clampHandle should pin it at inMs + 1000 = 6_000ms.
    fireEvent.pointerDown(outHandle, { pointerId: 2, clientX: 20, button: 0 });
    expect(onTrim).toHaveBeenCalledWith({ inMs: 5_000, outMs: 6_000 });
  });

  // Plan 09 / G-05-12 — screenshot position dots on the track.
  it('renders one screenshot marker per row at the expected left percent (G-05-12)', () => {
    const onSeek = vi.fn();
    const screenshots = [
      { id: 1, procedureId: 'p1', timestampInVideoMs: 5_000, filePath: '/x.jpg', annotation: null, createdAt: 1 },
      { id: 2, procedureId: 'p1', timestampInVideoMs: 20_000, filePath: '/y.jpg', annotation: null, createdAt: 2 },
    ];
    render(
      <Scrubber
        durationMs={30_000}
        currentMs={0}
        onSeek={onSeek}
        screenshots={screenshots}
      />,
    );
    const markers = screen.getAllByTestId('scrubber-screenshot-marker');
    expect(markers).toHaveLength(2);
    // 5_000 / 30_000 * 100 = 16.666...%
    expect(parseFloat((markers[0] as HTMLElement).style.left)).toBeCloseTo(16.666, 1);
    // 20_000 / 30_000 * 100 = 66.666...%
    expect(parseFloat((markers[1] as HTMLElement).style.left)).toBeCloseTo(66.666, 1);
    // aria-label carries the formatted HH:MM:SS timestamp.
    expect(markers[0]?.getAttribute('aria-label')).toBe('Screenshot at 00:00:05');
    expect(markers[1]?.getAttribute('aria-label')).toBe('Screenshot at 00:00:20');
  });

  // Plan 09 / G-05-12 — tick scale strip rendered below the track.
  it('renders the tick scale ONLY when trimMode === true (G-05-12)', () => {
    const onSeek = vi.fn();

    // (a) trimMode=false — the wrapper carries no testid (to avoid
    // duplicate `scrubber-track` matches against the inner track), and
    // the tick scale div is absent.
    const { rerender } = render(
      <Scrubber durationMs={30_000} currentMs={0} onSeek={onSeek} trimMode={false} />,
    );
    expect(screen.queryByTestId('scrubber-tick-scale')).toBeNull();
    expect(screen.queryByTestId('scrubber-with-ticks')).toBeNull();

    // (b) trimMode=true — the wrapper carries `scrubber-with-ticks`,
    // the tick scale div is present, and 7 ticks render at 5s intervals
    // (0s, 5s, 10s, 15s, 20s, 25s, 30s) for a 30-second recording.
    rerender(<Scrubber durationMs={30_000} currentMs={0} onSeek={onSeek} trimMode={true} />);
    expect(screen.getByTestId('scrubber-with-ticks')).toBeInTheDocument();
    expect(screen.getByTestId('scrubber-tick-scale')).toBeInTheDocument();
    const shortTicks = screen.getAllByTestId('scrubber-tick');
    expect(shortTicks).toHaveLength(7);

    // (c) trimMode=true + durationMs > 60_000 — 10s interval; a 120s
    // recording renders 13 ticks (0s, 10s, 20s, …, 120s).
    rerender(<Scrubber durationMs={120_000} currentMs={0} onSeek={onSeek} trimMode={true} />);
    const longTicks = screen.getAllByTestId('scrubber-tick');
    expect(longTicks).toHaveLength(13);
  });
});
