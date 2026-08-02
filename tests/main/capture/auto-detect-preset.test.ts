// auto-detect-preset.test.ts — SET-02 SD/HD regex classification (D-06).
//
// Pure function tests against the heuristic. The first-regex-group
// `MatchedPattern` audit metadata (Q-A) is also asserted here so the
// first-save metadata field in the IPC layer is contract-pinned.

import { describe, expect, it } from 'vitest';
import { autoDetectPreset } from '../../../src/main/capture/auto-detect-preset';

describe('autoDetectPreset — SD patterns win over HD', () => {
  it('matches EasyCap (case-insensitive)', () => {
    expect(autoDetectPreset('EasyCap USB Video')).toEqual({
      preset: 'sd',
      matched: 'sd-pattern-EasyCap',
    });
    expect(autoDetectPreset('EASYCAP something')).toEqual({
      preset: 'sd',
      matched: 'sd-pattern-EasyCap',
    });
  });

  it('matches "USB Video" with optional whitespace', () => {
    expect(autoDetectPreset('USB Video')).toEqual({
      preset: 'sd',
      matched: 'sd-pattern-USBVideo',
    });
    expect(autoDetectPreset('USB   Video')).toEqual({
      preset: 'sd',
      matched: 'sd-pattern-USBVideo',
    });
    expect(autoDetectPreset('USBVideo')).toEqual({
      preset: 'sd',
      matched: 'sd-pattern-USBVideo',
    });
  });

  it('matches "USB 2.0 TV" with flexible spacing + dots', () => {
    expect(autoDetectPreset('USB2.0 TV')).toEqual({
      preset: 'sd',
      matched: 'sd-pattern-USB2.0TV',
    });
    expect(autoDetectPreset('USB 2.0 TV')).toEqual({
      preset: 'sd',
      matched: 'sd-pattern-USB2.0TV',
    });
    expect(autoDetectPreset('USB 2.0TV')).toEqual({
      preset: 'sd',
      matched: 'sd-pattern-USB2.0TV',
    });
  });

  it('matches CVBS, Composite, S-Video (the S-Video pattern tolerates punctuation)', () => {
    expect(autoDetectPreset('CVBS Input')).toEqual({
      preset: 'sd',
      matched: 'sd-pattern-CVBS',
    });
    expect(autoDetectPreset('Composite Video')).toEqual({
      preset: 'sd',
      matched: 'sd-pattern-Composite',
    });
    expect(autoDetectPreset('S-Video')).toEqual({
      preset: 'sd',
      matched: 'sd-pattern-SVideo',
    });
    expect(autoDetectPreset('SVideo')).toEqual({
      preset: 'sd',
      matched: 'sd-pattern-SVideo',
    });
    expect(autoDetectPreset('SVideo Capture')).toEqual({
      preset: 'sd',
      matched: 'sd-pattern-SVideo',
    });
  });

  it('SD wins over HD when the canonical name matches both regexes', () => {
    // Hypothetical hybrid name; SD pattern must be checked first.
    expect(autoDetectPreset('EasyCap HDMI Bridge')).toEqual({
      preset: 'sd',
      matched: 'sd-pattern-EasyCap',
    });
  });
});

describe('autoDetectPreset — HD patterns', () => {
  it('matches HDMI (case-insensitive)', () => {
    expect(autoDetectPreset('HDMI Capture')).toEqual({
      preset: 'hd',
      matched: 'hd-pattern-HDMI',
    });
    expect(autoDetectPreset('hdmi capture')).toEqual({
      preset: 'hd',
      matched: 'hd-pattern-HDMI',
    });
  });

  it('matches "1080p" anywhere in the name', () => {
    expect(autoDetectPreset('Generic Webcam 1080p')).toEqual({
      preset: 'hd',
      matched: 'hd-pattern-1080p',
    });
  });

  it('matches word-boundary HD (only standalone "HD" tokens)', () => {
    expect(autoDetectPreset('HD Capture')).toEqual({
      preset: 'hd',
      matched: 'hd-pattern-HD',
    });
    // ponytail: "HDVideo" doesn't contain the literal "HD" with a word
    // boundary, but the DVI substring regex (case-insensitive) DOES match
    // "DVi" at positions 1-3. The first matching HD pattern wins.
    expect(autoDetectPreset('HDVideo')).toEqual({
      preset: 'hd',
      matched: 'hd-pattern-DVI',
    });
    // A canonical name with NO HD/HDMI/1080p/DVI/Digital/UVC token falls back.
    expect(autoDetectPreset('My Random Webcam')).toEqual({
      preset: 'hd',
      matched: 'hd-pattern-fallback',
    });
  });

  it('matches Digital, DVI, UVC', () => {
    expect(autoDetectPreset('Digital Video')).toEqual({
      preset: 'hd',
      matched: 'hd-pattern-Digital',
    });
    expect(autoDetectPreset('DVI Input')).toEqual({
      preset: 'hd',
      matched: 'hd-pattern-DVI',
    });
    expect(autoDetectPreset('UVC Webcam')).toEqual({
      preset: 'hd',
      matched: 'hd-pattern-UVC',
    });
  });

  it('returns HD fallback with matched "hd-pattern-fallback" when no pattern matches', () => {
    expect(autoDetectPreset('Random Capture Card')).toEqual({
      preset: 'hd',
      matched: 'hd-pattern-fallback',
    });
    expect(autoDetectPreset('')).toEqual({
      preset: 'hd',
      matched: 'hd-pattern-fallback',
    });
  });

  it('first matching HD regex wins (order is HDMI > 1080p > HD > Digital > DVI > UVC)', () => {
    expect(autoDetectPreset('HDMI Digital 1080p Capture')).toEqual({
      preset: 'hd',
      matched: 'hd-pattern-HDMI',
    });
    expect(autoDetectPreset('1080p Digital UVC')).toEqual({
      preset: 'hd',
      matched: 'hd-pattern-1080p',
    });
  });
});