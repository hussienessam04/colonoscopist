// D-12 + per-preset bitrate matrix. Pure function — no I/O.

import { describe, expect, it } from 'vitest';
import { buildFfmpegArgs } from '../../../src/main/recorder/ffmpeg-args';

describe('buildFfmpegArgs', () => {
  it('returns the D-12 arg array for SD preset', () => {
    const args = buildFfmpegArgs({
      deviceName: 'USB Cam',
      preset: { preset: 'sd' },
      outputPath: 'C:\\Users\\demo\\video.mp4',
    });
    expect(args).toEqual([
      '-f', 'dshow',
      '-rtbufsize', '100M',
      '-i', 'video=USB Cam',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-movflags', '+faststart',
      '-pix_fmt', 'yuv420p',
      '-r', '30',
      '-s', '720x480',
      '-b:v', '4M',
      '-y', 'C:\\Users\\demo\\video.mp4',
    ]);
  });

  it('uses 10M bitrate + 1920x1080 for HD preset', () => {
    const args = buildFfmpegArgs({
      deviceName: 'HDMI Cam',
      preset: { preset: 'hd' },
      outputPath: '/tmp/video.mp4',
    });
    expect(args).toContain('-b:v');
    expect(args[args.indexOf('-b:v') + 1]).toBe('10M');
    expect(args[args.indexOf('-s') + 1]).toBe('1920x1080');
    expect(args[args.indexOf('-r') + 1]).toBe('30');
  });

  it('uses the custom preset resolution + 25fps for custom preset', () => {
    const args = buildFfmpegArgs({
      deviceName: 'Custom Cam',
      preset: { preset: 'custom', resolution: '1280x720', framerate: 25 },
      outputPath: '/tmp/video.mp4',
    });
    expect(args[args.indexOf('-s') + 1]).toBe('1280x720');
    expect(args[args.indexOf('-r') + 1]).toBe('25');
    expect(args[args.indexOf('-b:v') + 1]).toBe('5M');
  });

  it('preserves spaces in the device name (dshow video-only form)', () => {
    const args = buildFfmpegArgs({
      deviceName: ' USB  Cam ',
      preset: { preset: 'sd' },
      outputPath: 'C:\\Users\\demo\\video.mp4',
    });
    expect(args[args.indexOf('-i') + 1]).toBe('video= USB  Cam ');
  });

  it('throws EmptyFfmpegArgsError for empty device name', () => {
    expect(() =>
      buildFfmpegArgs({ deviceName: '', preset: { preset: 'sd' }, outputPath: '/tmp/out.mp4' }),
    ).toThrow(/Empty ffmpeg args|empty/);
  });

  it('throws EmptyFfmpegArgsError for empty output path', () => {
    expect(() =>
      buildFfmpegArgs({ deviceName: 'Cam', preset: { preset: 'sd' }, outputPath: '' }),
    ).toThrow(/Empty ffmpeg args|empty/);
  });
});