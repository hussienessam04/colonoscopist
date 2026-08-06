// @vitest-environment happy-dom
// trim-clamp — pure helper for the trim handles on the Scrubber.

import { describe, expect, it } from 'vitest';
import { clampHandle } from '@/lib/trim-clamp';

describe('clampHandle', () => {
  it('clamps the in-handle at outMs - 1000ms (1000ms minimum gap)', () => {
    const result = clampHandle(20_000, 25_000, true, 60_000);
    expect(result.inMs).toBe(19_000);
    expect(result.outMs).toBe(20_000);
  });

  it('clamps the in-handle at 0 when attempt goes negative', () => {
    const result = clampHandle(20_000, -5_000, true, 60_000);
    expect(result.inMs).toBe(0);
    expect(result.outMs).toBe(20_000);
  });

  it('clamps the out-handle at inMs + 1000ms (1000ms minimum gap)', () => {
    const result = clampHandle(10_000, 5_000, false, 60_000);
    expect(result.inMs).toBe(10_000);
    expect(result.outMs).toBe(11_000);
  });

  it('clamps the out-handle at durationMs when attempt exceeds total', () => {
    const result = clampHandle(10_000, 90_000, false, 60_000);
    expect(result.inMs).toBe(10_000);
    expect(result.outMs).toBe(60_000);
  });

  it('returns inMs = 0 / outMs = otherMs for the edge case of dragging in to the start', () => {
    const result = clampHandle(20_000, 0, true, 60_000);
    expect(result.inMs).toBe(0);
    expect(result.outMs).toBe(20_000);
  });

  it('returns inMs = otherMs / outMs = durationMs for the edge case of dragging out to the end', () => {
    const result = clampHandle(10_000, 60_000, false, 60_000);
    expect(result.inMs).toBe(10_000);
    expect(result.outMs).toBe(60_000);
  });
});
