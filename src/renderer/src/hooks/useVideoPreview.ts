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
  const [width, height] = preset.resolution.split(/[x×]/).map(Number);
  return width && height
    ? { resolution: [width, height], framerate: preset.framerate }
    : { framerate: preset.framerate };
}

export function useVideoPreview(browserDeviceId: string | null, preset?: QualityPreset): {
  videoRef: React.RefObject<HTMLVideoElement>;
  active: boolean;
  starting: boolean;
  error: PreviewError | null;
  start: () => void;
  stop: () => void;
} {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef(0);
  const [requested, setRequested] = useState(false);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<PreviewError | null>(null);

  const release = useCallback(() => {
    requestRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    release();
    setRequested(false);
    setActive(false);
    setStarting(false);
  }, [release]);

  const start = useCallback(() => {
    if (!browserDeviceId) return;
    setError(null);
    setRequested(true);
  }, [browserDeviceId]);

  const resolution = presetHints(preset).resolution;
  const framerate = presetHints(preset).framerate;

  useEffect(() => {
    if (!requested || !browserDeviceId) return;

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
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
        setStarting(false);
        setActive(true);
      })
      .catch((cause: unknown) => {
        if (request !== requestRef.current) return;
        setStarting(false);
        setActive(false);
        setRequested(false);
        setError(previewError(cause));
      });

    return release;
  }, [browserDeviceId, framerate, release, requested, resolution?.[0], resolution?.[1]]);

  useEffect(() => release, [release]);

  return { videoRef, active, starting, error, start, stop };
}
