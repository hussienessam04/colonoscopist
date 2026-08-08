// Tagged union for IPC errors. Phase 2 expands with AUTH-02/03/04 + validation codes.
// Renderer can `switch (e.code)` reliably.

export type IpcError =
  | { code: 'IPC_AUTH_FAILED'; message: string }
  | { code: 'IPC_RATE_LIMITED'; message: string; retryAt: number }
  | { code: 'IPC_LOCKED'; message: string; retryAt: number }
  | { code: 'IPC_VALIDATION'; message: string; field?: string }
  | { code: 'IPC_NOT_FOUND'; message: string }
  | { code: 'IPC_ENCRYPTION_UNAVAILABLE'; message: string }
  // Phase 6 — used by the PDF embed helper when a non-PNG/JPEG file is
  // detected at the read side (defense-in-depth alongside the IPC upload
  // magic-byte sniff).
  | { code: 'IPC_BAD_REQUEST'; message: string }
  // Plan 01 stub: handlers whose real implementation lands in Plan 03
  // throw this so the renderer contract surface doesn't need to shift.
  | { code: 'IPC_NOT_IMPLEMENTED'; message: string };

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
    case 'IPC_BAD_REQUEST':
      return { code, message };
    case 'IPC_NOT_IMPLEMENTED':
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