import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CaptureDevice } from '@shared/ipc-contract';
import { safeInvoke } from '@/lib/ipc-result';
import { useLicenseChangeRefresh } from '@/hooks/useLicenseStatus';

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

  // ponytail: extracted into a stable callback so the LICENSE_CHANGED_EVENT
  // listener below can re-run the same fetch logic. Quick task 260913-rp5 —
  // the previous version had `useEffect(() => {...}, [])` which meant the
  // hook never recovered after activation. Re-fetching on license change
  // clears the stale "License required — activate to list capture devices."
  // error and lets the capture page work normally.
  const refetch = useCallback((): void => {
    let cancelled = false;
    // Plan 08-12 / G-08-6 — wrap capture.listDevices through safeInvoke.
    // On license state 'expired' / 'unactivated' the main-process gate
    // returns {ok:false, code:'IPC_LICENSE_*'}; safeInvoke yields null
    // and we surface an empty device list + a license-aware error so
    // downstream SettingsCapture / ProcedureRoom render the EmptyStateCard
    // path instead of crashing on dshow.find() (which would receive the
    // {ok:false} object as if it were CaptureDevice[]).
    setLoading(true);
    void safeInvoke(window.api.capture.listDevices())
      .then((dshowDevices) => {
        if (cancelled) return;
        if (dshowDevices === null) {
          setDshow([]);
          setError('License required — activate to list capture devices.');
          return;
        }
        setError(null);
        return navigator.mediaDevices.enumerateDevices().then((mediaDevices) => {
          if (cancelled) return;
          setDshow(dshowDevices);
          setBrowser(mediaDevices.filter((device) => device.kind === 'videoinput'));
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Capture devices could not be listed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Quick task 260913-rp5 — when the user activates the license, re-fetch
  // so the stale "License required" error clears and the device list
  // populates. LICENSE_CHANGED_EVENT fires only from the License sub-page
  // on successful activation, so this listener is safe to fire on every
  // event.
  useLicenseChangeRefresh(refetch);

  const namesByBrowserId = useMemo(() => {
    const names = new Map<string, string>();
    for (const browserDevice of browser) {
      // ponytail: Windows browser labels often append "(0408:30c3)" USB
      // vendor:product IDs that dshow listings do NOT carry. Strip the suffix
      // before matching so the lookup falls back to the clean dshow name
      // (or, on miss, the stripped label).
      const stripped = browserDevice.label.replace(
        /\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i,
        '',
      );
      const match = dshow.find(
        (dshowDevice) => comparable(dshowDevice.rawName) === comparable(stripped),
      );
      names.set(browserDevice.deviceId, match?.deviceId ?? stripped);
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
