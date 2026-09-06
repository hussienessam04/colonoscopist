// SaveTemplateDialog — quick task 20260812.
//
// Modal that replaces the previous `window.prompt()` for naming
// a new text template. The prompt was ugly, modal-less, and
// blocked the renderer's main thread (Chromium shows a system
// dialog on top of the BrowserWindow). A proper shadcn Dialog
// matches the rest of the UI and gives the doctor a clear
// "scope + label + Save / Cancel" form.
//
// UX:
//   - Pre-populates the input with the trimmed first line of the
//     box's current value (if any) as a hint; doctor can edit or
//     accept.
//   - Enter = submit. Escape = cancel (handled by Dialog).
//   - Submit button is disabled when the label is empty /
//     whitespace-only.
//   - On save, the parent calls addTemplate({ scope, label, body });
//     we close the dialog from the parent's success handler.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type SaveTemplateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scopeLabel: string;
  defaultLabel: string;
  onSave: (label: string) => Promise<void> | void;
  busy?: boolean;
};

export function SaveTemplateDialog({
  open,
  onOpenChange,
  scopeLabel,
  defaultLabel,
  onSave,
  busy = false,
}: SaveTemplateDialogProps): JSX.Element | null {
  const { t } = useTranslation();
  const [label, setLabel] = useState(defaultLabel);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ponytail: reset the input + auto-focus when the dialog opens,
  // so the doctor can immediately type a name (or accept the
  // default which is the first line of the box's body).
  useEffect(() => {
    if (open) {
      setLabel(defaultLabel);
      // requestAnimationFrame so the Input has mounted before we
      // ask the browser to focus it.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, defaultLabel]);

  if (!open) return null;

  const trimmed = label.trim();
  const isValid = trimmed.length > 0;

  const submit = async (): Promise<void> => {
    if (!isValid || busy) return;
    await onSave(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        data-testid="report-editor-save-template-dialog"
        // Intercept Enter at the Dialog level so the doctor can
        // submit without leaving the input.
        onKeyDown={(e) => {
          if (e.key === 'Enter' && isValid && !busy) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t('report.saveTemplateDialog.title', { scope: scopeLabel })}
          </DialogTitle>
          <DialogDescription>
            {t('report.saveTemplateDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label
            htmlFor="report-editor-save-template-dialog-input"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            {t('report.saveTemplateDialog.labelLabel')}
          </label>
          <Input
            id="report-editor-save-template-dialog-input"
            ref={inputRef}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('report.saveTemplateDialog.labelPlaceholder')}
            disabled={busy}
            data-testid="report-editor-save-template-dialog-input"
            autoComplete="off"
          />

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              data-testid="report-editor-save-template-dialog-cancel"
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={!isValid || busy}
              data-testid="report-editor-save-template-dialog-save"
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
