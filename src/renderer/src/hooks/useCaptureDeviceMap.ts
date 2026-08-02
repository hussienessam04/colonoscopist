import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CaptureDevice } from '@shared/ipc-contract';

const comparable = (value: string): string => value.trim().toLocaleLowerCase();

export function useCaptureDeviceMap(): {
  dshow: CaptureDevice[];
  browser: MediaDeviceInfo[];
  loading: boolean;
  error: string | null;
  lookup: (browserId: string) => string | undefined;
  pickBrowserId: (canonicalName: string) => string | undefined;
} {
  const [dshow, setDshow] = useState<CaptureDevice[]>([]);
  const [browser, setBrowser] = useState<MediaDeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      window.api.capture.listDevices(),
      navigator.mediaDevices.enumerateDevices(),
    ])
      .then(([dshowDevices, mediaDevices]) => {
        if (cancelled) return;
        setDshow(dshowDevices);
        setBrowser(mediaDevices.filter((device) => device.kind === 'videoinput'));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Capture devices could not be listed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const namesByBrowserId = useMemo(() => {
    const names = new Map<string, string>();
    for (const browserDevice of browser) {
      const match = dshow.find(
        (dshowDevice) => comparable(dshowDevice.rawName) === comparable(browserDevice.label),
      );
      names.set(browserDevice.deviceId, match?.deviceId ?? browserDevice.label);
    }
    return names;
  }, [browser, dshow]);

  const lookup = useCallback(
    (browserId: string): string | undefined => namesByBrowserId.get(browserId),
    [namesByBrowserId],
  );

  const pickBrowserId = useCallback(
    (canonicalName: string): string | undefined => {
      const wanted = comparable(canonicalName);
      for (const [browserId, name] of namesByBrowserId) {
        if (comparable(name) === wanted) return browserId;
      }
      return undefined;
    },
    [namesByBrowserId],
  );

  return { dshow, browser, loading, error, lookup, pickBrowserId };
}
