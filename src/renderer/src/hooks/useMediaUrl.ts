// useMediaUrl — fetch + cache the long-lived MediaServer URL on mount.
// The renderer's <video> element composes
//   `mediaUrl + '/media/' + patientId + '/' + procedureId + '/' + filename`
// to source the canonical / trimmed mp4. The URL is loopback-only and
// stays bound across ProcedureReview sessions.
//
// ponytail: returns `null` while loading — the <video> element skips
// rendering until the URL lands. Avoids a flash of empty src.

import { useCallback, useEffect, useState } from 'react';

export type UseMediaUrlResult = {
  url: string | null;
  loading: boolean;
  retry: () => void;
};

export function useMediaUrl(): UseMediaUrlResult {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // ponytail: bumping `retryKey` forces the mount effect to re-run so
  // the user can ping the media server without remounting the whole
  // page. The Retry button on the placeholder card ticks this.
  const [retryKey, setRetryKey] = useState(0);
  const retry = useCallback(() => setRetryKey((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.api.recording
      .getMediaUrl()
      .then((u) => {
        if (!cancelled) {
          setUrl(u);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUrl(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  return { url, loading, retry };
}
