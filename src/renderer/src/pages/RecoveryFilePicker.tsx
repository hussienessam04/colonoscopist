// Per D-04 + Fix 7: "Forgot admin PIN?" affordance on the login screen.
// Two-step flow inside a Dialog:
//   1. "Email vendor" → auth.recoveryRequest() → sonner toast
//   2. "Select recovery file" → auth.acceptRecoveryFile() → sonner toast
//      (Phase 8 owns the actual Ed25519 verify — typed deferred response).

import { useState } from 'react';
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
  const [open, setOpen] = useState(false);
  const [emailPending, setEmailPending] = useState(false);
  const [filePending, setFilePending] = useState(false);

  async function handleEmail(): Promise<void> {
    setEmailPending(true);
    try {
      const res = await window.api.auth.recoveryRequest();
      if (res?.mailto) {
        toast.success('Recovery email queued — vendor will reply with a `.recover` file.', {
          description: res.mailto,
        });
      } else {
        toast.success('Recovery email queued — vendor will reply with a `.recover` file.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Recovery request failed';
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
        toast.success(
          'Recovery file accepted. License verification will complete in Phase 8.',
        );
      } else {
        toast.success('Recovery file accepted.');
      }
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Recovery file failed';
      toast.error(msg);
    } finally {
      setFilePending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="link" size="sm" className="text-muted-foreground">
          Forgot admin PIN?
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recover admin PIN</DialogTitle>
          <DialogDescription>
            Request a recovery file from the vendor. Once you receive the
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">.recover</code>
            file, select it to unlock the admin PIN.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleEmail()}
            disabled={emailPending || filePending}
          >
            {emailPending ? 'Sending…' : 'Email vendor'}
          </Button>
          <Button
            type="button"
            onClick={() => void handleFile()}
            disabled={emailPending || filePending}
          >
            {filePending ? 'Selecting…' : 'Select recovery file'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
