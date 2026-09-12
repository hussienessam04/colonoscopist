// DeviceLostBanner — inline, non-modal Alert that surfaces the device-lost
// signal from the supervisor (D-03 + Plan 04). Mounted in the Procedure Room
// side-rail BELOW the notes panel so the doctor sees the recovery hint while
// still being able to click Stop (per UX-Pitfalls: no modal interruption).

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatDurationHHMMSS } from '@/lib/format-duration';
import { useTranslation } from 'react-i18next';
import type { LastLost } from '@/store/recording';

type DeviceLostBannerProps = {
  lastLost: LastLost | null;
  onDismiss: () => void;
};

export default function DeviceLostBanner({
  lastLost,
  onDismiss,
}: DeviceLostBannerProps): JSX.Element | null {
  const { t } = useTranslation();
  if (lastLost === null) return null;
  return (
    <Alert
      variant="destructive"
      data-testid="device-lost-banner"
      className="flex flex-col gap-2"
    >
      <AlertTitle>{t('procedure.deviceLostBannerTitle')}</AlertTitle>
      <AlertDescription>
        Recording preserved up to{' '}
        <span className="font-mono font-medium">
          {formatDurationHHMMSS(lastLost.lastKnownTimestampMs)}
        </span>{' '}
        (device: <span className="font-mono">{lastLost.deviceName}</span>)
      </AlertDescription>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDismiss}
        className="self-end"
        data-testid="device-lost-dismiss"
      >
        {t('procedure.deviceLostDismiss')}
      </Button>
    </Alert>
  );
}