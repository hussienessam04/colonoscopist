// TemplatesDialog — quick task 20260812.
//
// A proper modal for browsing + inserting + deleting saved
// text templates for a given report-box scope (esophagus /
// stomach / …). Replaces the previous inline `<select>` dropdown
// which was a tiny element the doctor could easily miss and
// which offered no way to delete a stale template.
//
// UX:
//   - Dialog opens with a list of templates for the scope, sorted
//     by label (case-insensitive).
//   - Each row: template label + small "Insert" button. Clicking
//     "Insert" calls onInsert(template) and closes the dialog.
//   - Each row also has a "Delete" button (X icon). Deleting is
//     destructive — confirmed via the standard browser confirm().
//   - Empty state: "No templates saved yet. Type something in the
//     box below and click Save as Template."
//   - Header: scope label + scope name (e.g. "Stomach templates").
//
// Render path: pure controlled component. The parent owns the
// template list (via useReportTemplates) and the IPC calls.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

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

import { useReportTemplates } from '@/hooks/useReportTemplates';
import type { ReportTemplate } from '@shared/ipc-contract';

export type TemplatesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ReportTemplate['scope'];
  scopeLabel: string;
  onInsert: (template: ReportTemplate) => void;
};

export function TemplatesDialog({
  open,
  onOpenChange,
  scope,
  scopeLabel,
  onInsert,
}: TemplatesDialogProps): JSX.Element | null {
  const { t } = useTranslation();
  const { templates, remove } = useReportTemplates({ scope });
  const [filter, setFilter] = useState('');

  // ponytail: reset the filter when the dialog opens so a stale
  // search term from a prior scope doesn't surprise the doctor.
  useEffect(() => {
    if (open) setFilter('');
  }, [open, scope]);

  if (!open) return null;

  const filtered = templates
    .filter((tpl) =>
      filter.trim() === ''
        ? true
        : tpl.label.toLowerCase().includes(filter.trim().toLowerCase()),
    )
    .sort((a, b) => a.label.localeCompare(b.label));

  const handleInsert = (template: ReportTemplate): void => {
    onInsert(template);
    onOpenChange(false);
  };

  const handleDelete = async (template: ReportTemplate): Promise<void> => {
    const ok = window.confirm(
      t('report.templatesDialog.deleteConfirm', { label: template.label }),
    );
    if (!ok) return;
    try {
      await remove(template.id);
      toast.success(t('report.templatesDialog.deleted', { label: template.label }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('report.templateSaveFailed');
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="report-editor-templates-dialog">
        <DialogHeader>
          <DialogTitle>
            {t('report.templatesDialog.title', { scope: scopeLabel })}
          </DialogTitle>
          <DialogDescription>
            {t('report.templatesDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            type="text"
            placeholder={t('report.templatesDialog.searchPlaceholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            data-testid="report-editor-templates-dialog-search"
          />

          <div className="max-h-80 overflow-y-auto rounded border border-slate-200">
            {filtered.length === 0 ? (
              <p
                className="p-4 text-center text-sm text-muted-foreground"
                data-testid="report-editor-templates-dialog-empty"
              >
                {t('report.templatesDialog.empty')}
              </p>
            ) : (
              <ul className="divide-y divide-slate-200">
                {filtered.map((tpl) => (
                  <li
                    key={tpl.id}
                    className="flex items-center gap-2 p-2"
                    data-testid={`report-editor-templates-dialog-row-${tpl.id}`}
                  >
                    <span
                      className="flex-1 truncate text-sm font-medium text-slate-900"
                      title={tpl.label}
                    >
                      {tpl.label}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleInsert(tpl)}
                      data-testid={`report-editor-templates-dialog-insert-${tpl.id}`}
                    >
                      {t('report.insertTemplate')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDelete(tpl)}
                      aria-label={t('common.delete')}
                      data-testid={`report-editor-templates-dialog-delete-${tpl.id}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="report-editor-templates-dialog-close"
          >
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
