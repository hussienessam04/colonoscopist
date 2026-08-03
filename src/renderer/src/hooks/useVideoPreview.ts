import { useCallback, useEffect, useRef, useState } from 'react';
import type { QualityPreset } from '@shared/ipc-contract';

export type PreviewError = {
  code:
    | 'NotAllowedError'
    | 'NotFoundError'
    | 'OverconstrainedError'
    | 'NotReadableError'
    | 'Unknown';
  message: string;
};

const ERROR_MESSAGES: Record<PreviewError['code'], string> = {
  NotAllowedError: 'Camera access was denied. Allow camera access and try again.',
  NotFoundError: 'The selected capture device is not available.',
  OverconstrainedError: 'The selected device cannot use this quality preset.',
  NotReadableError: 'The selected device is busy or could not be opened.',
  Unknown: 'Preview could not be started.',
};

function previewError(error: unknown): PreviewError {
  const name = error instanceof Error ? error.name : '';
  const code = name in ERROR_MESSAGES ? (name as PreviewError['code']) : 'Unknown';
  return { code, message: ERROR_MESSAGES[code] };
}

function presetHints(preset?: QualityPreset): {
  resolution?: [number, number];
  framerate?: number;
} {
  if (!preset) return {};
  if (preset.preset === 'sd') return { resolution: [720, 480], framerate: 30 };
  if (preset.preset === 'hd') return { resolution: [1920, 1080], framerate: 30 };
  // ponytail: defensive guard — corrupt row may carry empty/missing resolution;
  // skip the WxH hint and let the device constrain by framerate alone.
  const raw = preset.resolution?.trim();
  if (!raw) return { framerate: preset.framerate };
  const [width, height] = raw.split(/[x×]/).map(Number);
  return width && height
    ? { resolution: [width, height], framerate: preset.framerate }
    : { framerate: preset.framerate };
}

export function useVideoPreview(browserDeviceId: string | null, preset?: QualityPreset): {
  videoRef: React.RefObject<HTMLVideoElement>;
  startRequested: boolean;
  active: boolean;
  starting: boolean;
  error: PreviewError | null;
  start: () => void;
  stop: () => void;
} {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef(0);
  const [startRequested, setStartRequested] = useState(false);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<PreviewError | null>(null);

  // ponytail: deterministic release ordering — requestRef.current += 1
  // FIRST (cancels in-flight .then), THEN capture streamRef.current,
  // THEN null streamRef.current, THEN stop tracks. The .then's
  // cancellation branch stops tracks when request !== requestRef.current,
  // so tracks are always stopped exactly once even if release() runs
  // before the .then resolves (e.g. when the test clicks Stop/Finish
  // before the getUserMedia promise settles). Pinned by G-03-8
  // integration-contract regex in tests/integration/renderer-main-capture-contract.test.ts.
  const release = useCallback(() => {
    requestRef.current += 1;
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream && typeof stream.getTracks === 'function') {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    release();
    setStartRequested(false);
    setActive(false);
    setStarting(false);
  }, [release]);

  const start = useCallback(() => {
    if (!browserDeviceId) return;
    setError(null);
    setStartRequested(true);
  }, [browserDeviceId]);

  const resolution = presetHints(preset).resolution;
  const framerate = presetHints(preset).framerate;

  useEffect(() => {
    if (!startRequested || !browserDeviceId) return;

    release();
    const request = requestRef.current;
    setStarting(true);
    setActive(false);
    setError(null);

    const video: MediaTrackConstraints = {
      deviceId: { exact: browserDeviceId },
      ...(resolution && {
        width: { ideal: resolution[0] },
        height: { ideal: resolution[1] },
      }),
      ...(framerate && { frameRate: { ideal: framerate } }),
    };

    void navigator.mediaDevices
      .getUserMedia({ video, audio: false })
      .then((stream) => {
        if (request !== requestRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          // Attach the stream; the <video> element has the autoPlay attribute
          // and Chromium will start playback once the MediaStream delivers
          // frames. We deliberately do not call .play() because (a) autoPlay
          // is enough in production and (b) some test environments throw
          // synchronously on .play() with no source attached yet.
          try {
            videoRef.current.srcObject = stream;
          } catch {
            // some test environments (e.g. happy-dom) reject non-MediaStream
            // objects on srcObject assignment; ignore so the preview can
            // still be tracked in state.
          }
        }
        setStarting(false);
        setActive(true);
      })
      .catch((cause: unknown) => {
        if (request !== requestRef.current) return;
        setStarting(false);
        setActive(false);
        setStartRequested(false);
        setError(previewError(cause));
      });

    return release;
  }, [browserDeviceId, framerate, release, startRequested, resolution?.[0], resolution?.[1]]);

  useEffect(() => {
    return () => {
      release();
    };
  }, [release]);

  return { videoRef, startRequested, active, starting, error, start, stop };
}
