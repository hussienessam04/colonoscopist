// canonicalize.test.ts — CAPT-10 + D-11 normalization edge cases.
// Pure unit tests, no DB, no Electron.

import { describe, expect, it } from 'vitest';
import {
  canonicalizeName,
  canonicalizeOrThrow,
  EmptyDeviceNameError,
  MAX_DEVICE_NAME_LENGTH,
} from '../../../src/main/capture/canonicalize';

describe('canonicalizeName', () => {
  it('returns the same string when already clean', () => {
    expect(canonicalizeName('USB Video Device')).toBe('USB Video Device');
    expect(canonicalizeName('HDMI Capture')).toBe('HDMI Capture');
  });

  it('trims leading and trailing whitespace', () => {
    expect(canonicalizeName('  USB Video Device  ')).toBe('USB Video Device');
    expect(canonicalizeName('\tEasyCap\n')).toBe('EasyCap');
  });

  it('collapses internal double spaces to single', () => {
    expect(canonicalizeName('USB  Video  Device')).toBe('USB Video Device');
    expect(canonicalizeName('A   B   C')).toBe('A B C');
  });

  it('collapses mixed whitespace (tabs, newlines) to single space', () => {
    expect(canonicalizeName('USB\tVideo\nDevice')).toBe('USB Video Device');
    expect(canonicalizeName('A \t B \n C')).toBe('A B C');
  });

  it('strips zero-width characters (U+200B, U+200C, U+200D, U+FEFF)', () => {
    expect(canonicalizeName('USB\u200B Video')).toBe('USB Video');
    expect(canonicalizeName('HDMI\u200C\u200D Capture')).toBe('HDMI Capture');
    expect(canonicalizeName('\uFEFFEasyCap')).toBe('EasyCap');
  });

  it('NF-normalizes decomposed Unicode to composed form (NFC)', () => {
    // "ÜSB" (U+00DC + SB) where the diaeresis is decomposed into U+0308
    const decomposed = 'U\u0308SB Video';
    const composed = '\u00DCSB Video';
    expect(canonicalizeName(decomposed)).toBe(canonicalizeName(composed));
    expect(canonicalizeName(decomposed)).toBe('ÜSB Video');
  });

  it('combines all normalizations in one call', () => {
    expect(canonicalizeName('  \uFEFFUSB\u200B  Video  Device  \t\n')).toBe('USB Video Device');
  });

  it('returns empty string for an all-whitespace input', () => {
    expect(canonicalizeName('   ')).toBe('');
    expect(canonicalizeName('\t\n\r')).toBe('');
  });

  it('returns empty string for an input that is only zero-width chars', () => {
    expect(canonicalizeName('\u200B\u200C\u200D\uFEFF')).toBe('');
  });

  it('preserves other punctuation and casing', () => {
    expect(canonicalizeName('EasyCap USB2.0 TV (CVBS)')).toBe('EasyCap USB2.0 TV (CVBS)');
    expect(canonicalizeName('HDMI-1080p')).toBe('HDMI-1080p');
  });

  it('throws on non-string input', () => {
    expect(() => canonicalizeName(null as unknown as string)).toThrow(EmptyDeviceNameError);
    expect(() => canonicalizeName(undefined as unknown as string)).toThrow(EmptyDeviceNameError);
    expect(() => canonicalizeName(42 as unknown as string)).toThrow(EmptyDeviceNameError);
  });
});

describe('canonicalizeOrThrow', () => {
  it('returns the canonical string for valid input', () => {
    expect(canonicalizeOrThrow('USB Video Device')).toBe('USB Video Device');
  });

  it('throws EmptyDeviceNameError for empty canonical result', () => {
    expect(() => canonicalizeOrThrow('   ')).toThrow(EmptyDeviceNameError);
    expect(() => canonicalizeOrThrow('\u200B')).toThrow(EmptyDeviceNameError);
    expect(() => canonicalizeOrThrow('')).toThrow(EmptyDeviceNameError);
  });

  it('throws EmptyDeviceNameError for an over-length string', () => {
    const tooLong = 'a'.repeat(MAX_DEVICE_NAME_LENGTH + 1);
    expect(() => canonicalizeOrThrow(tooLong)).toThrow(EmptyDeviceNameError);
  });

  it('Round-trip preservation: same input -> same output', () => {
    const inputs = [
      'USB Video Device',
      '  EasyCap  ',
      'HDMI Capture (1080p)',
      'Ümlauts',
      'A  B  C',
    ];
    for (const input of inputs) {
      const once = canonicalizeOrThrow(input);
      const twice = canonicalizeOrThrow(once);
      expect(twice).toBe(once);
    }
  });
});
