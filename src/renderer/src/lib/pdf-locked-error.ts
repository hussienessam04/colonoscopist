// isPdfLockedError — detects Windows file-lock errors thrown by
// `writePdfAtomic` in `src/main/pdf/render-report-pdf.ts`.
//
// Context: when the doctor clicks "Open PDF", shell.openPath hands
// the file to the OS default viewer (Edge / Adobe Reader / etc.).
// That viewer takes a long-lived handle on the file. A subsequent
// "Re-render PDF" or "Finalize" then runs writePdfAtomic — the
// temp-file write succeeds, but the `rename` over the destination
// fails with EPERM/EBUSY/EACCES because the viewer still holds
// the destination's previous handle.
//
// Without this check, the renderer surfaces the raw OS message
// ("EPERM: operation not permitted, rename ...tmp -> ...pdf"),
// which is unhelpful — the doctor doesn't know the viewer is the
// problem. The friendly message tells them to close the PDF
// window + retry.
//
// `err` shape: Node's `fs.promises.rename` rejects with an Error
// whose `.code` is one of the three lock codes on Windows. The IPC
// layer (`asIpcError` in `src/main/ipc/reports.ts`) returns a new
// `Error` whose `.message` starts with that same OS code — `.code`
// itself is NOT preserved across the boundary, so we fall back to
// message-text matching. The message text is stable across Node
// versions (it comes from libuv's string table, not the doctor's
// locale).
export function isPdfLockedError(err: unknown): boolean {
  if (err instanceof Error) {
    // Some errors keep their `.code` (regular Node Error thrown
    // from our own code, not the IPC boundary). This branch is the
    // primary path during unit tests + the local-orchestrator
    // call site.
    const code = (err as { code?: unknown }).code;
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') return true;
    // IPC boundary: asIpcError returns a fresh Error with the OS
    // code embedded in the message prefix. Node's libuv
    // stringifies these as `EBUSY: ...` / `EPERM: ...` /
    // `EACCES: ...` regardless of the doctor's locale.
    if (/^EBUSY:|^EPERM:|^EACCES:/i.test(err.message)) return true;
  }
  return false;
}
