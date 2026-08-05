// ponytail: one child per procedureId + busy error (per D-01 + Anti-Pattern 5).

import { afterEach, describe, expect, it } from 'vitest';
import { RecorderBusyError } from '../../../src/shared/errors';
import {
  recorderRegistry,
  __resetRecorderRegistry,
} from '../../../src/main/recorder/registry';
import type { Recorder } from '../../../src/main/recorder/recorder';

const fakeRecorder = (id: string): Recorder => ({}) as Recorder;

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

  it('rejects a second recorder for the same procedureId with RecorderBusyError', () => {
    recorderRegistry.set('p1', fakeRecorder('r1'));
    expect(() => recorderRegistry.set('p1', fakeRecorder('r2'))).toThrow(RecorderBusyError);
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