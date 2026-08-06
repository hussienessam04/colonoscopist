// ponytail: one child per procedureId + busy error (per D-01 + Anti-Pattern 5).

import { afterEach, describe, expect, it } from 'vitest';
import {
  recorderRegistry,
  __resetRecorderRegistry,
} from '../../../src/main/recorder/registry';
import type { Recorder } from '../../../src/main/recorder/recorder';

const fakeRecorder = (id: string, state: 'idle' | 'recording' = 'idle'): Recorder =>
  ({ getState: () => state }) as unknown as Recorder;

afterEach(() => {
  __resetRecorderRegistry();
});

describe('recorderRegistry', () => {
  it('stores a recorder under a procedureId', () => {
    const r = fakeRecorder('p1');
    recorderRegistry.set('p1', r);
    expect(recorderRegistry.get('p1')).toBe(r);
    expect(recorderRegistry.has('p1')).toBe(true);
  });

  it('replaces an active recorder by force-cleaning it (never blocks the doctor)', () => {
    // The renderer is the only place that can fire recording:start for
    // a given procedureId. If it fires twice (e.g. user clicks Start
    // after a hung previous session) we MUST unblock them — the
    // supervisor orphans an active child via forceCleanup and
    // accepts the new Recorder.
    recorderRegistry.set('p1', fakeRecorder('r1', 'recording'));
    expect(() => recorderRegistry.set('p1', fakeRecorder('r2'))).not.toThrow();
    expect(recorderRegistry.get('p1')).toBeDefined();
  });

  it('allows a fresh recorder to replace a stuck \'starting\' entry (stale-spawn cleanup)', () => {
    recorderRegistry.set('p1', fakeRecorder('r1', 'starting'));
    // Previous ffmpeg child died without reaching onExit; the new Start
    // takes over instead of locking the doctor out.
    expect(() => recorderRegistry.set('p1', fakeRecorder('r2'))).not.toThrow();
    expect(recorderRegistry.get('p1')).toBeDefined();
  });

  it('allows a fresh recorder to replace an idle entry (stale-session cleanup)', () => {
    recorderRegistry.set('p1', fakeRecorder('r1', 'idle'));
    // Should NOT throw — replaces the stale idle entry.
    expect(() => recorderRegistry.set('p1', fakeRecorder('r2'))).not.toThrow();
    expect(recorderRegistry.get('p1')).toBeDefined();
  });

  it('delete() lets a fresh recorder claim the procedureId', () => {
    const r1 = fakeRecorder('r1');
    const r2 = fakeRecorder('r2');
    recorderRegistry.set('p1', r1);
    recorderRegistry.delete('p1');
    expect(() => recorderRegistry.set('p1', r2)).not.toThrow();
    expect(recorderRegistry.get('p1')).toBe(r2);
  });
});