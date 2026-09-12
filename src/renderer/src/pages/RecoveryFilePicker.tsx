// Per D-04 + Fix 7: "Forgot admin PIN?" affordance on the login screen.
// Two-step flow inside a Dialog:
//   1. "Email vendor" → auth.recoveryRequest() → sonner toast
//   2. "Select recovery file" → auth.acceptRecoveryFile() → sonner toast
//      (Phase 8 owns the actual Ed25519 verify — typed deferred response).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

export default function RecoveryFilePicker(): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [emailPending, setEmailPending] = useState(false);
  const [filePending, setFilePending] = useState(false);

  async function handleEmail(): Promise<void> {
    setEmailPending(true);
    try {
      const res = await window.api.auth.recoveryRequest();
      if (res?.mailto) {
        toast.success(t('recovery.toastSuccessWithMailto'), {
          description: res.mailto,
        });
      } else {
        toast.success(t('recovery.toastSuccessNoMailto'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('recovery.toastRequestFailed');
      toast.error(msg);
    } finally {
      setEmailPending(false);
    }
  }

  async function handleFile(): Promise<void> {
    setFilePending(true);
    try {
      // Main handles the OS file picker via dialog.showOpenDialog — Fix 7 surface.
      // The result is the typed deferred response; renderer surfaces the Phase 8
      // hand-off honestly without claiming verification.
      const res = await window.api.auth.acceptRecoveryFile();
      if (res.accepted && res.verificationDeferred) {
        toast.success(t('recovery.toastFileSuccessDeferred'));
      } else {
        toast.success(t('recovery.toastFileSuccess'));
      }
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('recovery.toastFileFailed');
      toast.error(msg);
    } finally {
      setFilePending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="link" size="sm" className="text-muted-foreground">
          {t('recovery.triggerForgot')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('recovery.dialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('recovery.dialogDescription')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleEmail()}
            disabled={emailPending || filePending}
          >
            {emailPending ? t('recovery.sending') : t('recovery.emailButton')}
          </Button>
          <Button
            type="button"
            onClick={() => void handleFile()}
            disabled={emailPending || filePending}
          >
            {filePending ? t('recovery.selecting') : t('recovery.selectFileButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
