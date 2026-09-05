// Tagged union for IPC errors. Phase 2 expands with AUTH-02/03/04 + validation codes.
// Renderer can `switch (e.code)` reliably.

export type IpcError =
  | { code: 'IPC_AUTH_FAILED'; message: string }
  | { code: 'IPC_RATE_LIMITED'; message: string; retryAt: number }
  | { code: 'IPC_LOCKED'; message: string; retryAt: number }
  | { code: 'IPC_VALIDATION'; message: string; field?: string }
  | { code: 'IPC_NOT_FOUND'; message: string }
  | { code: 'IPC_ENCRYPTION_UNAVAILABLE'; message: string }
  // Phase 6 — used by IPC handlers when the session is missing for an
  // authenticated-only handler (profile.* + reports.* in Plan 06-01).
  | { code: 'IPC_AUTH_REQUIRED'; message: string }
  // Phase 6 — used by REPORTS_OPEN_PDF when shell.openPath returns a
  // non-empty error string (no PDF viewer installed, etc.).
  | { code: 'IPC_INTERNAL'; message: string }
  // Phase 6 — used by the PDF embed helper when a non-PNG/JPEG file is
  // detected at the read side (defense-in-depth alongside the IPC upload
  // magic-byte sniff).
  | { code: 'IPC_BAD_REQUEST'; message: string }
  // Plan 01 stub: handlers whose real implementation lands in Plan 03
  // throw this so the renderer contract surface doesn't need to shift.
  | { code: 'IPC_NOT_IMPLEMENTED'; message: string }
  // Phase 8 / Plan 01 — license gate rejection codes (LIC-02/03/04).
  // INVALID = never activated OR tampered .lic; EXPIRED = trial ran
  // out without activation. Renderer reads the code to choose modal
  // copy (per CONTEXT D-05).
  | { code: 'IPC_LICENSE_INVALID'; message: string }
  | { code: 'IPC_LICENSE_EXPIRED'; message: string }
  // Phase 8 / Plan 14 — screenshot crop (SCRN-02 extended). NOT_FOUND =
  // no screenshots row for the supplied id; INVALID_CROP = the crop rect
  // falls outside the reported original dimensions.
  | { code: 'IPC_SCREENSHOT_NOT_FOUND'; message: string }
  | { code: 'IPC_INVALID_CROP'; message: string };

export class IpcErrorException extends Error {
  readonly ipc: IpcError;
  constructor(ipc: IpcError) {
    super(ipc.message);
    this.name = 'IpcErrorException';
    this.ipc = ipc;
  }
}

export function ipcError(code: IpcError['code'], message: string, extra: Partial<IpcError> = {}): IpcError {
  switch (code) {
    case 'IPC_AUTH_FAILED':
      return { code, message };
    case 'IPC_RATE_LIMITED':
      return { code, message, retryAt: (extra as { retryAt: number }).retryAt };
    case 'IPC_LOCKED':
      return { code, message, retryAt: (extra as { retryAt: number }).retryAt };
    case 'IPC_VALIDATION':
      return { code, message, ...(extra as { field?: string }) };
    case 'IPC_NOT_FOUND':
      return { code, message };
    case 'IPC_ENCRYPTION_UNAVAILABLE':
      return { code, message };
    case 'IPC_AUTH_REQUIRED':
      return { code, message };
    case 'IPC_INTERNAL':
      return { code, message };
    case 'IPC_BAD_REQUEST':
      return { code, message };
    case 'IPC_NOT_IMPLEMENTED':
      return { code, message };
    case 'IPC_LICENSE_INVALID':
      return { code, message };
    case 'IPC_LICENSE_EXPIRED':
      return { code, message };
    case 'IPC_SCREENSHOT_NOT_FOUND':
      return { code, message };
    case 'IPC_INVALID_CROP':
      return { code, message };
  }
}

// ponytail: Recorder supervisor errors are separate from IPC errors — they
// never cross the contextBridge boundary (they're internal to main process).
export class RecorderBusyError extends Error {
  readonly procedureId: string;
  constructor(procedureId: string) {
    super(`Recorder already active for procedure ${procedureId}`);
    this.name = 'RecorderBusyError';
    this.procedureId = procedureId;
  }
}

export class EmptyFfmpegArgsError extends Error {
  constructor(message = 'Empty ffmpeg args after canonicalization') {
    super(message);
    this.name = 'EmptyFfmpegArgsError';
  }
}