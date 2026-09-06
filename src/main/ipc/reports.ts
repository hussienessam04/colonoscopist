// Reports IPC handlers (RPT-01..05 + RPT-07).
// Per CONTEXT.md D-05..D-08 + Phase 2 BLOCKER 4 (renderer never sends a
// doctorId — main derives it from `requireSession()`).
//
// Audit surface (per CONTEXT.md §Audit surface):
//   report.created (via getOrCreate first time only — currently emitted
//                    from the repo's insert path; the handler emits the
//                    post-insert audit row)
//   report.updated
//   report.admin_edited        (post-finalize edits — D-08)
//   report.finalized
//   report.pdf_generated        (emitted by renderReportPdf)
//   report.pdf_opened
//   report.screenshot_attached
//   report.screenshot_detached
//   report.screenshots_reordered
//
// D-09: PDF cached on disk at finalize; re-rendered on every edit. The
// renderReportPdf orchestrator writes the pdf_path + pdf_generated_at
// + emits report.pdf_generated (see pdf/render-report-pdf.ts).

import { ipcMain, shell, app, BrowserWindow } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';
import {
  IPC,
  type Report,
  type ReportScreenshot,
} from '@shared/ipc-contract';
import { IpcErrorException, ipcError } from '@shared/errors';

import {
  reportUpdateSchema,
  reportIdSchema,
  reportProcedureSchema,
  reportProcedureTypeInput,
  reportInstrumentInput,
  reportPremedicationOverrideInput,
} from '@shared/validators';
import { reportsRepo } from '../db/reports-repo';
import { reportScreenshotsRepo } from '../db/report-screenshots-repo';
import { audit } from '../db/audit';
import { session } from '../auth/session';
import { renderReportPdf } from '../pdf/render-report-pdf';
import { reportPdfPath } from '../paths';
import { existsSync, readFileSync } from 'node:fs';
// Phase 7 / Plan 07-04 — I18N-03 + RPT-06 + D-26 verbatim: resolve the
// doctor's preferred language server-side so the renderer never supplies
// it. Falls back doctor_profile.language → users.language → 'en'.
import { doctorProfileRepo } from '../db/doctor-profile-repo';
import { userRepo } from '../db/users';
import { licenseGated } from '../license';

function fromZodError(err: z.ZodError, fallbackField?: string): IpcErrorException {
  const issue = err.issues[0];
  const field = (issue?.path[0] as string | undefined) ?? fallbackField;
  return new IpcErrorException(
    ipcError('IPC_VALIDATION', issue?.message ?? 'Invalid input', field ? { field } : {}),
  );
}

function safeParse<T>(schema: z.ZodType<T>, raw: unknown, fallbackField?: string): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) throw fromZodError(err, fallbackField);
    throw err;
  }
}

function requireSession(): string {
  const id = session.currentUserId;
  if (!id) {
    throw new IpcErrorException(ipcError('IPC_AUTH_REQUIRED', 'Not authenticated'));
  }
  return id;
}

function asIpcError(err: unknown): Error {
  if (err instanceof z.ZodError) return asIpcError(fromZodError(err));
  if (err instanceof IpcErrorException) {
    const wrapped = new Error(err.ipc.message) as Error & { ipcError?: unknown };
    wrapped.ipcError = err.ipc;
    return wrapped;
  }
  // ponytail: a bare `ipcError(...)` plain object thrown by accident
  // (instead of `throw new IpcErrorException(ipcError(...))`) would
  // stringify as "[object Object]" and surface a useless toast. Detect
  // the structural shape and surface the real message.
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    'message' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    typeof (err as { message: unknown }).message === 'string'
  ) {
    const ipcErr = err as { code: string; message: string };
    const wrapped = new Error(ipcErr.message) as Error & { ipcError?: unknown };
    wrapped.ipcError = ipcErr;
    return wrapped;
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

function fieldList(patch: Record<string, unknown>): string[] {
  return Object.keys(patch).filter((k) => patch[k] !== undefined);
}

export function registerReportsIpc(): void {
  // Phase 8 / Plan 03 — wrap every handler with `licenseGated`. REPORTS_*
  // channels are GATED; expired licenses cannot view / create / edit /
  // finalize / regenerate / open / print any clinical report.
  ipcMain.handle(IPC.REPORTS_GET_OR_CREATE, licenseGated(IPC.REPORTS_GET_OR_CREATE, (_e, raw) => {
    try {
      const doctorId = requireSession();
      const { procedureId } = safeParse(reportProcedureSchema, raw, 'procedureId');

      const existing = reportsRepo.getByProcedure(procedureId);
      const report: Report = existing ?? reportsRepo.getOrCreate(procedureId, doctorId);

      if (!existing) {
        audit({
          action: 'report.created',
          entityType: 'report',
          entityId: report.id,
          userId: doctorId,
          metadata: { procedureId, doctorId },
        });
      }
      return report;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.REPORTS_GET, licenseGated(IPC.REPORTS_GET, (_e, raw) => {
    try {
      requireSession();
      const { id } = safeParse(reportIdSchema, raw, 'id');
      return reportsRepo.getById(id);
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  // Phase 7 / Plan 07-02 — SRCH-03 + D-03: read-only lookup of a
  // report by procedureId. Returns null when no report exists (vs
  // getOrCreate which would create a draft). Used by the Patient
  // List accordion expansion.
  ipcMain.handle(IPC.REPORTS_GET_BY_PROCEDURE, licenseGated(IPC.REPORTS_GET_BY_PROCEDURE, (_e, raw) => {
    try {
      requireSession();
      const { procedureId } = safeParse(reportProcedureSchema, raw, 'procedureId');
      return reportsRepo.getByProcedure(procedureId);
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.REPORTS_UPDATE_DRAFT, licenseGated(IPC.REPORTS_UPDATE_DRAFT, (_e, raw) => {
    try {
      const userId = requireSession();
      const {
        id,
        esophagus,
        stomach,
        pylorus,
        duodenum,
        colon,
        ileum,
        conclusion,
        recommendation,
      } = safeParse(
        reportUpdateSchema.extend({ id: z.string().min(1) }),
        raw,
        'id',
      );
      const updated = reportsRepo.updateDraft(id, {
        esophagus,
        stomach,
        pylorus,
        duodenum,
        colon,
        ileum,
        conclusion,
        recommendation,
      });
      audit({
        action: 'report.updated',
        entityType: 'report',
        entityId: id,
        userId,
        metadata: {
          fields: fieldList({
            esophagus,
            stomach,
            pylorus,
            duodenum,
            colon,
            ileum,
            conclusion,
            recommendation,
          }),
        },
      });
      return updated;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.REPORTS_UPDATE_FINALIZED, licenseGated(IPC.REPORTS_UPDATE_FINALIZED, (_e, raw) => {
    try {
      const userId = requireSession();
      const {
        id,
        esophagus,
        stomach,
        pylorus,
        duodenum,
        colon,
        ileum,
        conclusion,
        recommendation,
      } = safeParse(
        reportUpdateSchema.extend({ id: z.string().min(1) }),
        raw,
        'id',
      );
      const updated = reportsRepo.updateFinalized(id, {
        esophagus,
        stomach,
        pylorus,
        duodenum,
        colon,
        ileum,
        conclusion,
        recommendation,
      });
      audit({
        action: 'report.admin_edited',
        entityType: 'report',
        entityId: id,
        userId,
        metadata: {
          fields: fieldList({
            esophagus,
            stomach,
            pylorus,
            duodenum,
            colon,
            ileum,
            conclusion,
            recommendation,
          }),
        },
      });
      return updated;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  // Quick task 20260812-redesign-report — set procedure_type ONCE.
  // The repo's setProcedureType guards on the empty-state invariant
  // (procedure_type still 'colon' AND every box column = ''). The
  // audit row marks this as report.type_changed for traceability.
  ipcMain.handle(IPC.REPORTS_SET_PROCEDURE_TYPE, licenseGated(IPC.REPORTS_SET_PROCEDURE_TYPE, (_e, raw) => {
    try {
      const userId = requireSession();
      const { id, procedureType } = safeParse(reportProcedureTypeInput, raw, 'id');
      const updated = reportsRepo.setProcedureType(id, procedureType);
      audit({
        action: 'report.type_changed',
        entityType: 'report',
        entityId: id,
        userId,
        metadata: { procedureType },
      });
      return updated;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  // Quick task 20260812-redesign-report — set the instrument picker
  // (a used_devices.id) on the report. NULL clears.
  ipcMain.handle(IPC.REPORTS_SET_INSTRUMENT, licenseGated(IPC.REPORTS_SET_INSTRUMENT, (_e, raw) => {
    try {
      const userId = requireSession();
      const { id, instrument } = safeParse(reportInstrumentInput, raw, 'id');
      const updated = reportsRepo.setInstrument(id, instrument);
      audit({
        action: 'report.instrument_changed',
        entityType: 'report',
        entityId: id,
        userId,
        metadata: { instrument },
      });
      return updated;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  // Quick task 20260812-redesign-report — per-report premedication
  // override. NULL clears (renderer falls back to profile default).
  ipcMain.handle(IPC.REPORTS_SET_PREMEDICATION_OVERRIDE, licenseGated(IPC.REPORTS_SET_PREMEDICATION_OVERRIDE, (_e, raw) => {
    try {
      const userId = requireSession();
      const { id, override } = safeParse(reportPremedicationOverrideInput, raw, 'id');
      const updated = reportsRepo.setPremedicationOverride(id, override);
      audit({
        action: 'report.premedication_changed',
        entityType: 'report',
        entityId: id,
        userId,
        metadata: { overrideLength: override === null ? 0 : override.length },
      });
      return updated;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.REPORTS_FINALIZE, licenseGated(IPC.REPORTS_FINALIZE, (_e, raw) => {
    try {
      const userId = requireSession();
      const { id } = safeParse(reportIdSchema, raw, 'id');
      const finalized = reportsRepo.finalize(id);
      audit({
        action: 'report.finalized',
        entityType: 'report',
        entityId: id,
        userId,
        metadata: { finalizedAt: finalized.finalizedAt },
      });
      return finalized;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.REPORTS_REGEN_PDF, licenseGated(IPC.REPORTS_REGEN_PDF, async (_e, raw) => {
    try {
      const userId = requireSession();
      const { id } = safeParse(reportIdSchema, raw, 'id');
      // Phase 7 / Plan 07-04 — I18N-03 + RPT-06 + D-26: resolve the
      // language server-side from the report's doctor profile.
      // The renderer's IPC contract is unchanged — main owns the
      // language lookup so the renderer can't spoof AR / EN output.
      const reportRow = reportsRepo.getById(id);
      let language: 'en' | 'ar' = 'en';
      if (reportRow) {
        const profile = doctorProfileRepo.get(reportRow.doctorId);
        const user = userRepo.get(reportRow.doctorId);
        language = profile?.language ?? user?.language ?? 'en';
      }
      const result = await renderReportPdf(id, { language });
      audit({
        action: 'report.pdf_regenerated',
        entityType: 'report',
        entityId: id,
        userId,
        metadata: { pdfPath: result.pdfPath, language },
      });
      return result;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  // Phase 6 UAT G-06-11 — return the PDF bytes so the renderer can build
  // a blob: URL and load it in the print-preview iframe. The PDF lives
  // under <userData>/data/reports/<reportId>.pdf which the MediaServer
  // does NOT serve (its path-safety check restricts to
  // data/media/patients/). A direct IPC is the cleanest bridge.
  ipcMain.handle(IPC.REPORTS_GET_PDF_BLOB, licenseGated(IPC.REPORTS_GET_PDF_BLOB, async (_e, raw) => {
    try {
      // ponytail: requireSession() is invoked for its gate side-effect (throws
      // IPC_AUTH_REQUIRED if no session). The userId itself isn't needed in
      // this read-only handler — there's no audit row to attribute the read
      // to. The phase-7 audit.log IPC channel is the right path if/when a
      // render-time audit row is desired.
      requireSession();
      const { id } = safeParse(reportIdSchema, raw, 'id');
      const report = reportsRepo.getById(id);
      if (report === null || report.pdfPath === null) {
        throw new IpcErrorException(
          ipcError('IPC_NOT_FOUND', 'pdf not generated yet'),
        );
      }
      const userData = app.getPath('userData');
      const absPath = path.join(userData, report.pdfPath.split('/').join(path.sep));
      if (!existsSync(absPath)) {
        throw new IpcErrorException(
          ipcError('IPC_NOT_FOUND', 'pdf file is missing on disk'),
        );
      }
      // readFileSync returns a Buffer; Uint8Array view lets the
      // renderer wrap it in a blob: URL via URL.createObjectURL(new
      // Blob([bytes], { type: 'application/pdf' })).
      const bytes = readFileSync(absPath);
      return { bytes: new Uint8Array(bytes), mime: 'application/pdf' as const };
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.REPORTS_OPEN_PDF, licenseGated(IPC.REPORTS_OPEN_PDF, async (_e, raw) => {
    try {
      const userId = requireSession();
      // ponytail: accept an optional `reveal` flag — when true, the
      // handler invokes `shell.showItemInFolder(abs)` to highlight the
      // PDF in the OS file manager instead of opening it. The default
      // (omit or false) preserves the prior "open in default viewer"
      // behavior so existing renderer callers keep working.
      const { id, reveal } = safeParse(
        reportIdSchema.extend({ reveal: z.boolean().optional() }),
        raw,
        'id',
      );
      const report = reportsRepo.getById(id);
      if (!report || !report.pdfPath) {
        throw new IpcErrorException(
          ipcError('IPC_NOT_FOUND', 'pdf not generated yet'),
        );
      }
      const abs = reportPdfPath(id);
      if (!existsSync(abs)) {
        throw new IpcErrorException(
          ipcError('IPC_NOT_FOUND', 'pdf file missing on disk'),
        );
      }
      if (reveal === true) {
        // ponytail: shell.showItemInFolder is synchronous and does not
        // return a status — Electron guarantees it returns synchronously
        // on all platforms. We audit regardless of visual confirmation.
        shell.showItemInFolder(abs);
      } else {
        // ponytail: shell.openPath returns an empty string on success and
        // a non-empty error string on failure. Anything non-empty is a
        // hard error (no PDF viewer installed, etc.) — surface as
        // IPC_INTERNAL so the renderer shows a retry affordance.
        const openedError = await shell.openPath(abs);
        if (openedError) {
          throw new IpcErrorException(
            ipcError('IPC_INTERNAL', openedError),
          );
        }
      }
      audit({
        action: 'report.pdf_opened',
        entityType: 'report',
        entityId: id,
        userId,
        metadata: { pdfPath: report.pdfPath, reveal: reveal === true },
      });
      return { opened: true } as const;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  // Quick task 20260906-print-via-webcontents-save-changes-at-end —
  // route the OS print dialog through Electron's `webContents.print`
  // instead of the iframe `contentWindow.print()` path. The iframe
  // approach surfaces "This app doesn't support print preview" for
  // PDF blob: URLs in Electron; `webContents.print` uses the OS-native
  // print pipeline with full preview.
  ipcMain.handle(IPC.REPORTS_PRINT, licenseGated(IPC.REPORTS_PRINT, async (_e, raw) => {
    try {
      const userId = requireSession();
      const { id } = safeParse(reportIdSchema, raw, 'id');
      const report = reportsRepo.getById(id);
      if (!report || !report.pdfPath) {
        throw new IpcErrorException(
          ipcError('IPC_NOT_FOUND', 'pdf not generated yet'),
        );
      }
      const abs = reportPdfPath(id);
      if (!existsSync(abs)) {
        throw new IpcErrorException(
          ipcError('IPC_NOT_FOUND', 'pdf file missing on disk'),
        );
      }
      // Open the PDF in a hidden BrowserWindow so the OS print dialog
      // has a real PDF document to preview + print. The window is
      // `show: false` (hidden from the user) + `webPreferences.offscreen`
      // would be heavier than necessary — a hidden window with the
      // default Chromium PDF viewer is enough.
      const printWin = new BrowserWindow({
        show: false,
        webPreferences: {
          plugins: true, // Chromium PDF viewer
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      try {
        await printWin.loadURL(pathToFileURL(abs).toString());
        // webContents.print returns a callback that fires when the
        // dialog closes (success = true / failure = false).
        const printed: boolean = await new Promise<boolean>((resolve) => {
          printWin.webContents.print(
            { silent: false, printBackground: true, pageSize: 'Letter' },
            (success: boolean) => resolve(success),
          );
        });
        audit({
          action: 'report.pdf_printed',
          entityType: 'report',
          entityId: id,
          userId,
          metadata: { pdfPath: report.pdfPath, success: printed },
        });
        return { ok: true } as const;
      } finally {
        if (!printWin.isDestroyed()) printWin.destroy();
      }
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.REPORTS_ATTACH_SCREENSHOT, licenseGated(IPC.REPORTS_ATTACH_SCREENSHOT, (_e, raw) => {
    try {
      const userId = requireSession();
      const input = safeParse(
        z
          .object({
            id: z.string().min(1),
            screenshotId: z.number().int().positive(),
            sortOrder: z.number().int().nonnegative(),
          })
          .strict(),
        raw,
        'id',
      );
      reportScreenshotsRepo.attach(input.id, input.screenshotId, input.sortOrder);
      audit({
        action: 'report.screenshot_attached',
        entityType: 'report',
        entityId: input.id,
        userId,
        metadata: { screenshotId: input.screenshotId, sortOrder: input.sortOrder },
      });
      return { ok: true } as const;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.REPORTS_DETACH_SCREENSHOT, licenseGated(IPC.REPORTS_DETACH_SCREENSHOT, (_e, raw) => {
    try {
      const userId = requireSession();
      const input = safeParse(
        z
          .object({
            id: z.string().min(1),
            screenshotId: z.number().int().positive(),
          })
          .strict(),
        raw,
        'id',
      );
      reportScreenshotsRepo.detach(input.id, input.screenshotId);
      audit({
        action: 'report.screenshot_detached',
        entityType: 'report',
        entityId: input.id,
        userId,
        metadata: { screenshotId: input.screenshotId },
      });
      return { ok: true } as const;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.REPORTS_REORDER_SCREENSHOTS, licenseGated(IPC.REPORTS_REORDER_SCREENSHOTS, (_e, raw) => {
    try {
      const userId = requireSession();
      const input = safeParse(
        z
          .object({
            id: z.string().min(1),
            orderedIds: z.array(z.number().int().positive()),
          })
          .strict(),
        raw,
        'id',
      );
      reportScreenshotsRepo.reorder(input.id, input.orderedIds);
      audit({
        action: 'report.screenshots_reordered',
        entityType: 'report',
        entityId: input.id,
        userId,
        metadata: { count: input.orderedIds.length },
      });
      return { ok: true } as const;
    } catch (err) {
      throw asIpcError(err);
    }
  }));

  ipcMain.handle(IPC.REPORTS_LIST_SCREENSHOTS, licenseGated(IPC.REPORTS_LIST_SCREENSHOTS, (_e, raw) => {
    try {
      requireSession();
      const { id } = safeParse(reportIdSchema, raw, 'id');
      const rows = reportScreenshotsRepo.listByReport(id);
      const result: ReportScreenshot[] = rows.map((r) => ({
        reportId: r.report_id,
        screenshotId: r.screenshot_id,
        sortOrder: r.sort_order,
      }));
      return result;
    } catch (err) {
      throw asIpcError(err);
    }
  }));
}

// Re-export for the test suite; not part of the IPC surface.
export const __test = {
  safeParse,
  fromZodError,
  asIpcError,
  requireSession,
  fieldList,
};
