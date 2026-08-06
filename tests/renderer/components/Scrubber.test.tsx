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
});
