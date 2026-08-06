// useMediaUrl — fetch + cache the long-lived MediaServer URL on mount.
// The renderer's <video> element composes
//   `mediaUrl + '/media/' + patientId + '/' + procedureId + '/' + filename`
// to source the canonical / trimmed mp4. The URL is loopback-only and
// stays bound across ProcedureReview sessions.
//
// ponytail: returns `null` while loading — the <video> element skips
// rendering until the URL lands. Avoids a flash of empty src.

import { useEffect, useState } from 'react';

export type UseMediaUrlResult = {
  url: string | null;
  loading: boolean;
};

export function useMediaUrl(): UseMediaUrlResult {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
  }, []);

  return { url, loading };
}
