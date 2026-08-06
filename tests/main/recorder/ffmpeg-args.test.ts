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

  it('omits the MJPEG preview output when previewTcpPort is not provided', () => {
    const args = buildFfmpegArgs({
      deviceName: 'Cam',
      preset: { preset: 'sd' },
      outputPath: '/tmp/video.mp4',
    });
    expect(args).not.toContain('mjpeg');
    expect(args).not.toContain('tcp://127.0.0.1:47700');
  });

  it('appends a localhost MJPEG-tee output when previewTcpPort is set (SD scales to recording width)', () => {
    const args = buildFfmpegArgs({
      deviceName: 'Cam',
      preset: { preset: 'sd' },
      outputPath: '/tmp/video.mp4',
      previewTcpPort: 47700,
    });
    // The new -map block reuses the same dshow input.
    expect(args).toContain('-map');
    expect(args[args.indexOf('-map') + 1]).toBe('0:v');
    // ponytail: preview scale tracks the recording width — 720 for SD
    // (recording resolution 720x480). 320 wide was too small for the
    // doctor to see what's being captured.
    expect(args).toContain('-vf');
    expect(args[args.indexOf('-vf') + 1]).toBe('scale=720:-1');
    // 15 fps cap so the renderer isn't drowned in redundant frames.
    expect(args).toContain('-r');
    expect(args.lastIndexOf('-r')).toBeGreaterThan(args.indexOf('-r'));
    expect(args[args.lastIndexOf('-r') + 1]).toBe('15');
    // MJPEG muxer + quality knob. The input also uses `-f dshow`, so
    // grab the LAST `-f` (the MJPEG output) instead of the first.
    const fIndices = args.reduce<number[]>((acc, v, i) => (v === '-f' ? [...acc, i] : acc), []);
    expect(fIndices.length).toBeGreaterThanOrEqual(2);
    expect(args[fIndices[fIndices.length - 1] + 1]).toBe('mjpeg');
    expect(args).toContain('-q:v');
    expect(args[args.indexOf('-q:v') + 1]).toBe('5');
    // Localhost TCP target on the chosen port.
    expect(args[args.length - 1]).toBe('tcp://127.0.0.1:47700');
  });

  it('caps preview scale at 1280 for HD (recording is 1920x1080)', () => {
    const args = buildFfmpegArgs({
      deviceName: 'HDMI Cam',
      preset: { preset: 'hd' },
      outputPath: '/tmp/video.mp4',
      previewTcpPort: 47800,
    });
    expect(args).toContain('-vf');
    // Recording width 1920 → capped at 1280 to keep TCP bandwidth low.
    expect(args[args.indexOf('-vf') + 1]).toBe('scale=1280:-1');
  });

  it('uses the custom preset resolution for preview scale', () => {
    const args = buildFfmpegArgs({
      deviceName: 'Cam',
      preset: { preset: 'custom', resolution: '1024x768', framerate: 25 },
      outputPath: '/tmp/video.mp4',
      previewTcpPort: 47900,
    });
    expect(args[args.indexOf('-vf') + 1]).toBe('scale=1024:-1');
  });

  it('uses a different preview port when set', () => {
    const args = buildFfmpegArgs({
      deviceName: 'Cam',
      preset: { preset: 'hd' },
      outputPath: '/tmp/video.mp4',
      previewTcpPort: 47800,
    });
    expect(args[args.length - 1]).toBe('tcp://127.0.0.1:47800');
  });

  it('treats previewTcpPort=0 as not-set (no MJPEG output)', () => {
    const args = buildFfmpegArgs({
      deviceName: 'Cam',
      preset: { preset: 'sd' },
      outputPath: '/tmp/video.mp4',
      previewTcpPort: 0,
    });
    expect(args).not.toContain('mjpeg');
  });
});