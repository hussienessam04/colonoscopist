// PreviewServer — bridges ffmpeg's MJPEG-over-TCP output to a localhost HTTP
// multipart/x-mixed-replace stream that the renderer's <img> consumes.
//
// Why this exists: Windows DirectShow locks the capture device to one process.
// ffmpeg has the lock for the recording, so the renderer's getUserMedia
// stream is starved. Single ffmpeg process emits TWO outputs: the canonical
// mp4 file + a low-res MJPEG stream on TCP localhost. This server accepts
// that MJPEG stream (raw concatenated JPEG frames), splits on JPEG EOI
// markers (FF D9 — uniquely the EOI terminator in valid JPEG, since FF in
// entropy-coded data is byte-stuffed as FF 00), buffers the latest complete
// frame, and re-serves it as `multipart/x-mixed-replace` over HTTP. Chromium's
// <img> tag handles that MIME natively, displaying each new part as it
// arrives — no JS in the renderer.
//
// Lifecycle:
//   - start() allocates two consecutive free ports (TCP for ffmpeg, HTTP for
//     renderer). Returns { tcpPort, httpUrl }.
//   - stop() closes every active HTTP client socket + both servers. Safe to
//     call multiple times.
//   - start() is idempotent only in the failure path — calling it twice
//     without stop() is a bug at the call-site (recorder.ts guards it).
//
// Phase 5 / Plan 03 — sibling MediaServer (same file) is the long-lived
// localhost HTTP server that serves the canonical / trimmed mp4 to the
// renderer's <video> element via `/media/<patientId>/<procedureId>/<file>`.
// The MediaServer is independent of the recording-lifecycle PreviewServer
// — it stays bound across many ProcedureReview sessions and is killed on
// `before-quit` (main/index.ts shutdown hook).
//
// No new dependencies — Node's `net` + `http` + `fs` stdlib only.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { app } from 'electron';
import path from 'node:path';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createTcpServer, type Server as NetServer, type Socket as TcpSocket } from 'node:net';

export type PreviewServerHandle = {
  /** Port ffmpeg should target with `tcp://127.0.0.1:<tcpPort>`. */
  tcpPort: number;
  /** URL the renderer's <img src=...> should consume. */
  httpUrl: string;
};

export type PreviewServerOptions = {
  /** Optional reporter for non-fatal errors (frame-split malformation, client write failures). */
  onError?: (err: Error) => void;
};

// T-05-08 + T-05-28 + G-05-14 — strict regex for the /media/ route.
// Each segment is alphanumeric + hyphens; the file segment adds `.` to
// allow `.mp4` / `.jpg`. The route accepts both the flat shape
// (`/media/<p>/<proc>/<file>` — video files) and the subdir shape
// (`/media/<p>/<proc>/<subdir>/<file>` — screenshots live under a
// literal `screenshots/` segment per `paths.ts::screenshotsDir`).
// Any character outside this set (e.g. `?`, null bytes, `..`) is
// rejected by the regex match before the filesystem is touched. The
// optional subdir group is constrained to alphanumeric+hyphen; the
// handler enforces an allow-list of known subdir names as
// defense-in-depth (G-05-14).
const MEDIA_ROUTE_RE =
  /^\/media\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)\/(?:([a-zA-Z0-9-]+)\/)?([\w.-]+)$/;

// G-05-14 — defense-in-depth allow-list for the optional subdir segment.
// The regex already constrains it to alphanumeric+hyphen, but an
// allow-list ensures that expanding the route surface is a deliberate
// code change. v1: only `screenshots` is allowed. New subdirs must be
// added to this set explicitly (PR review + contract-guard tests catch
// unauthorized additions).
const ALLOWED_SUBDIRS: ReadonlySet<string> = new Set(['screenshots']);

// ponytail: multipart/x-mixed-replace boundary. Standard Chromium-handled
// MIME type for an MJPEG feed via <img>. The boundary itself can be any
// token — using a literal `frame` keeps the wire dump readable in tcpdump.
const MJPEG_BOUNDARY = 'frame';

export class PreviewServer {
  private tcpServer: NetServer | null = null;
  private httpServer: ReturnType<typeof createHttpServer> | null = null;
  private httpPort = 0;
  private tcpSocket: TcpSocket | null = null;
  private frameBuffer: Buffer = Buffer.alloc(0);
  private latestFrame: Buffer | null = null;
  private clients: Set<ServerResponse> = new Set();
  private starting = false;
  private started = false;
  private readonly onError: (err: Error) => void;

  constructor(opts: PreviewServerOptions = {}) {
    this.onError = opts.onError ?? (() => undefined);
  }

  /**
   * Bind TCP + HTTP servers on free OS-assigned ports and start accepting
   * ffmpeg's MJPEG stream + renderer's <img> requests. Resolves once both
   * listeners are bound; ffmpeg may not be connected yet at resolve time.
   */
  async start(): Promise<PreviewServerHandle> {
    if (this.started) {
      throw new Error('PreviewServer: start() called while already started');
    }
    if (this.starting) {
      throw new Error('PreviewServer: start() called concurrently');
    }
    this.starting = true;

    // 1. TCP listener — ffmpeg connects here, sends raw MJPEG byte stream.
    this.tcpServer = createTcpServer((socket) => {
      // ponytail: if ffmpeg reconnects (e.g. after a pause resume), accept
      // the new socket and drop the old one. We only need ONE writer at a
      // time — multiple writers would interleave frames.
      if (this.tcpSocket && !this.tcpSocket.destroyed) {
        this.tcpSocket.destroy();
      }
      this.tcpSocket = socket;
      this.frameBuffer = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => this.onTcpData(chunk));
      socket.on('error', (err) => this.onError(err));
      socket.on('close', () => {
        if (this.tcpSocket === socket) this.tcpSocket = null;
      });
    });
    const tcpPort = await this.listenOn(this.tcpServer, 0);

    // 2. HTTP listener — renderer <img src=http://127.0.0.1:<port>/preview>
    // requests a multipart/x-mixed-replace stream of the latest frame.
    this.httpServer = createHttpServer((req, res) => this.onHttpRequest(req, res));
    this.httpPort = await this.listenOnHttp(this.httpServer, 0);

    this.starting = false;
    this.started = true;
    return { tcpPort, httpUrl: `http://127.0.0.1:${this.httpPort}/preview` };
  }

  /**
   * Close every active HTTP client socket, then both servers. Idempotent.
   */
  async stop(): Promise<void> {
    if (!this.started && !this.starting) return;
    this.started = false;
    this.starting = false;

    // Drop every <img> client so Chromium stops the multipart stream cleanly.
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        // ignore — socket may already be torn down
      }
      try {
        client.destroy();
      } catch {
        // ignore
      }
    }
    this.clients.clear();

    if (this.tcpSocket) {
      try {
        this.tcpSocket.destroy();
      } catch {
        // ignore
      }
      this.tcpSocket = null;
    }

    const tcpClosed = this.tcpServer ? this.closeTcp(this.tcpServer) : Promise.resolve();
    const httpServer = this.httpServer;
    const httpClosed = httpServer ? this.closeHttp(httpServer) : Promise.resolve();
    this.tcpServer = null;
    this.httpServer = null;
    this.frameBuffer = Buffer.alloc(0);
    this.latestFrame = null;

    await Promise.all([tcpClosed, httpClosed]);
  }

  isRunning(): boolean {
    return this.started;
  }

  /** Test hook — most recent complete JPEG frame, or null. */
  getLatestFrame(): Buffer | null {
    return this.latestFrame;
  }

  // -------- internals --------

  private onTcpData(chunk: Buffer): void {
    this.frameBuffer = this.frameBuffer.length === 0 ? chunk : Buffer.concat([this.frameBuffer, chunk]);
    // Slice off complete JPEG frames (everything up to and including FF D9).
    // Repeat in case the chunk delivered multiple frames in one read.
    while (this.frameBuffer.length >= 2) {
      const eoi = PreviewServer.indexOfEoi(this.frameBuffer, 0);
      if (eoi < 0) break;
      // Copy (not subarray) so the latestFrame buffer is independent of
      // frameBuffer's underlying memory — otherwise a future Buffer.concat
      // could reallocate and we'd hand Chromium a torn frame.
      this.latestFrame = Buffer.from(this.frameBuffer.subarray(0, eoi + 2));
      this.broadcastFrame(this.latestFrame);
      this.frameBuffer = Buffer.from(this.frameBuffer.subarray(eoi + 2));
    }
  }

  private broadcastFrame(frame: Buffer): void {
    const header = Buffer.from(
      `--${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`,
      'utf8',
    );
    const footer = Buffer.from('\r\n', 'utf8');
    for (const client of this.clients) {
      try {
        client.write(header);
        client.write(frame);
        client.write(footer);
      } catch (err) {
        // Client write failed — drop it so the next frame doesn't keep
        // failing against a dead socket. Chromium auto-reconnects the <img>
        // when the socket drops, so this is transparent.
        this.clients.delete(client);
        this.onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private onHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    // G-05-3 + D-01 cross-origin posture: the renderer's <img> loads the
    // MJPEG stream from a different origin (localhost:vite / file:// vs
    // 127.0.0.1:<random>). Without this header Chromium treats the load as
    // opaque and any subsequent canvas.drawImage taints the canvas. The
    // header MUST be set as the FIRST line of the handler — before any
    // method check or early return — so every response path (200, 404, 405,
    // and any future error branch) inherits it.
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET');
      res.end('Method Not Allowed');
      return;
    }
    // Accept both `/preview` and `/` so a bare-URL test (root path) works.
    const url = req.url ?? '/';
    if (url !== '/preview' && url !== '/') {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    // Initial CRLF before the first boundary — Chromium expects the body to
    // start with CRLF per RFC 2046.
    res.write('\r\n');
    // If we already have a frame buffered (ffmpeg connected before the
    // renderer subscribed), send it immediately so <img> shows something
    // on first paint instead of a placeholder.
    if (this.latestFrame) {
      const header = Buffer.from(
        `--${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${this.latestFrame.length}\r\n\r\n`,
        'utf8',
      );
      try {
        res.write(header);
        res.write(this.latestFrame);
        res.write('\r\n');
      } catch (err) {
        this.onError(err instanceof Error ? err : new Error(String(err)));
        return;
      }
    }
    this.clients.add(res);
    req.on('close', () => {
      this.clients.delete(res);
    });
  }

  // Phase 5 — /media/<patientId>/<procedureId>/<file> route handler lives on
  // the MediaServer class below. PreviewServer does NOT serve /media/ —
  // the long-lived media server is a separate instance with a separate
  // lifecycle (boots at app start, dies at app shutdown — independent of
  // any single recording session).

  private listenOn(server: NetServer, port: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const onError = (err: Error): void => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = (): void => {
        server.off('error', onError);
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          resolve(addr.port);
        } else {
          reject(new Error('PreviewServer: could not read assigned port'));
        }
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
  }

  // ponytail: Node's net.Server and http.Server share the listen() signature
  // but the TS types differ per import — separate thin wrappers so each
  // call site uses the right type.
  private listenOnHttp(
    server: ReturnType<typeof createHttpServer>,
    port: number,
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const onError = (err: Error): void => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = (): void => {
        server.off('error', onError);
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          resolve(addr.port);
        } else {
          reject(new Error('PreviewServer: could not read assigned port'));
        }
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
  }

  private closeTcp(server: NetServer): Promise<void> {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private closeHttp(server: ReturnType<typeof createHttpServer>): Promise<void> {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Force-close any keep-alive sockets so close() actually resolves.
      // Node's close() waits for sockets to drain otherwise; for a test-
      // shutdown path we don't want to wait.
      const maybe = server as unknown as { closeAllConnections?: () => void };
      maybe.closeAllConnections?.();
    });
  }

  // ponytail: static so unit tests can exercise the splitter without
  // standing up the full server. Returns -1 when no FF D9 is in
  // buffer[start..]. JPEG EOI marker is FF D9 — in valid JPEG, FF in
  // entropy-coded data is byte-stuffed as FF 00, so FF D9 in the byte
  // stream is UNIQUE to the EOI terminator. Safe delimiter.
  static indexOfEoi(buffer: Buffer, start: number): number {
    for (let i = start; i < buffer.length - 1; i++) {
      if (buffer[i] === 0xff && buffer[i + 1] === 0xd9) return i;
    }
    return -1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MediaServer — long-lived localhost HTTP server that serves the canonical /
// trimmed mp4 to the renderer's <video> element. Boots at app start (so the
// renderer can fetch the URL on any Procedure Review page-load), dies at
// app shutdown via the existing `before-quit` hook. Independent of any
// single recording session — a doctor's ProcedureReview walk happens across
// many sessions, and the renderer can navigate back-and-forth without the
// server being torn down.
//
// Route: `/media/<patientId>/<procedureId>/<file>` serves the mp4 with
// `Accept-Ranges: bytes` + Content-Type + Content-Length. Single-200
// response per A7 — Chromium re-requests on seek; full Range support is a
// v1.1 hardening (Plan 04 / T-05-22).
//
// Path safety (T-05-08 + T-05-28):
//   1. URL regex constrains each segment to alphanumeric + hyphens +
//      `[\w.-]` for the file segment.
//   2. `path.relative(userDataRoot, resolvedPath)` must start with
//      `data/media/patients` — anything else returns 403.
//   3. `fs.existsSync` confirms the file is on disk; otherwise 404.
//
// No new dependencies — Node's `http` + `fs` stdlib only.
// ─────────────────────────────────────────────────────────────────────────────

export type MediaServerHandle = {
  /** Port for the renderer's `<video>` to compose `/media/...` against. */
  httpPort: number;
};

export class MediaServer {
  private httpServer: ReturnType<typeof createHttpServer> | null = null;
  private httpPort = 0;
  private starting = false;
  private started = false;

  async start(): Promise<MediaServerHandle> {
    if (this.started) {
      throw new Error('MediaServer: start() called while already started');
    }
    if (this.starting) {
      throw new Error('MediaServer: start() called concurrently');
    }
    this.starting = true;

    this.httpServer = createHttpServer((req, res) => this.onHttpRequest(req, res));
    this.httpPort = await this.listenOnHttp(this.httpServer, 0);

    this.starting = false;
    this.started = true;
    return { httpPort: this.httpPort };
  }

  async stop(): Promise<void> {
    if (!this.started && !this.starting) return;
    this.started = false;
    this.starting = false;
    const httpServer = this.httpServer;
    this.httpServer = null;
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        // Force-close keep-alive sockets so close() actually resolves.
        const maybe = httpServer as unknown as { closeAllConnections?: () => void };
        maybe.closeAllConnections?.();
      });
    }
  }

  isRunning(): boolean {
    return this.started;
  }

  // Returns the localhost URL the renderer's <video> composes against.
  // Per Phase 4 plan: `http://127.0.0.1:<port>` — bound to loopback only,
  // never reachable from outside the workstation.
  getMediaUrl(): string {
    return `http://127.0.0.1:${this.httpPort}`;
  }

  // ponytail: expose the port for tests that want to construct raw HTTP
  // requests without round-tripping through getMediaUrl.
  getPort(): number {
    return this.httpPort;
  }

  private onHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    // G-05-3 + D-01 cross-origin posture: the renderer's <video> loads the
    // mp4 from a different origin (localhost:vite / file:// vs
    // 127.0.0.1:<random>). Without this header Chromium treats the load as
    // cross-origin and any subsequent canvas.drawImage taints the canvas.
    // The header MUST be set as the FIRST line of the handler — before any
    // method check, range parse, regex match, existsSync, or early return —
    // so EVERY response path (200, 206, 416, 404, 403, 405) carries it.
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.end('Method Not Allowed');
      return;
    }
    const url = req.url ?? '/';
    const match = MEDIA_ROUTE_RE.exec(url);
    if (!match) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    const patientId = match[1] ?? '';
    const procedureId = match[2] ?? '';
    const subdir = match[3] ?? ''; // '' = flat (video.mp4); 'screenshots' = subdir
    const file = match[4] ?? '';

    // G-05-14 — allow-list check: reject unknown subdirs with 404 before
    // any filesystem access. The regex already constrains the subdir
    // shape, but a future refactor that loosens the regex must NOT
    // silently expand the route surface. This guard makes the
    // subdir-segment surface an explicit allow-list.
    if (subdir !== '' && !ALLOWED_SUBDIRS.has(subdir)) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    // T-05-08 — resolve the file path and verify it stays inside userData.
    // `path.relative` returns the diff; if the path escaped the userData
    // root, the relative form will start with `..`.
    const userDataRoot = app.getPath('userData');
    const resolved = path.join(
      userDataRoot,
      'data',
      'media',
      'patients',
      patientId,
      procedureId,
      subdir, // '' is a no-op for path.join (flat layout preserved)
      file,
    );
    const rel = path.relative(
      path.join(userDataRoot, 'data', 'media', 'patients'),
      resolved,
    );
    // ponytail: `rel` may legitimately point UP into data/media/patients/<id>
    // when the file is in a procedure subfolder — the regex already pinned
    // it there. Reject only `..` (escape) or absolute paths.
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    if (!existsSync(resolved)) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    let stat;
    try {
      stat = statSync(resolved);
    } catch {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    // T-05-22 — Chromium's <video> element uses Range requests to seek.
    // Parse `Range: bytes=START-END` and return 206 Partial Content with the
    // requested byte slice. Malformed ranges (or absent Range header) fall
    // back to the full 200 response with `Accept-Ranges: bytes` so the
    // client can re-issue on seek.
    //
    // ponytail: rejects multi-range (`bytes=0-100,200-300`) and malformed
    // (`bytes=abc-def`, `bytes=-0`) — Chromium never sends these for a
    // single <video> URL. Multi-range would require multipart/byteranges
    // (RFC 7233) which is not in scope for v1.
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');

    const rangeHeader = req.headers.range;
    if (rangeHeader !== undefined && rangeHeader !== '') {
      // Multi-range requests contain a comma — reject at this layer.
      if (!rangeHeader.includes(',')) {
        const parsed = MediaServer.parseRange(rangeHeader, stat.size);
        if (parsed !== null && !('invalidRange' in parsed)) {
          const { start, end } = parsed;
          const length = end - start + 1;
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
          res.setHeader('Content-Length', String(length));
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          // Stream the requested byte slice directly from disk — Node's
          // createReadStream honours { start, end } without buffering the
          // file in memory.
          const stream = createReadStream(resolved, { start, end });
          stream.on('error', () => {
            try {
              res.destroy();
            } catch {
              // ignore
            }
          });
          stream.pipe(res);
          return;
        }
        if (parsed !== null && 'invalidRange' in parsed) {
          // ponytail: well-formed shape with start > end after clamping
          // (e.g. `bytes=100-50` against a 1024-byte file). The canonical
          // Chromium posture is 416 with `Content-Range: bytes */<size>`.
          res.statusCode = 416;
          res.setHeader('Content-Range', `bytes */${stat.size}`);
          res.end();
          return;
        }
        // Malformed Range header — fall through to the full 200 response.
      }
    }

    // No Range header (or malformed Range) — return the full body.
    res.statusCode = 200;
    res.setHeader('Content-Length', String(stat.size));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(resolved);
    stream.on('error', () => {
      try {
        res.destroy();
      } catch {
        // ignore
      }
    });
    stream.pipe(res);
  }

  /**
   * Parse a single-range `Range` header against the file's size.
   *
   *   `bytes=START-END`   -> { start, end } with both clamped to [0, size-1]
   *   `bytes=START-`      -> { start: START, end: size-1 }  (open-ended)
   *   `bytes=-N`          -> { start: size-N, end: size-1 } (suffix-length)
   *   `bytes=START-END`   where START > END (after clamp) -> { invalidRange: true }
   *
   * Returns `null` for:
   *   - empty / missing / non-bytes specifiers
   *   - malformed values (`bytes=abc-def`)
   *   - multi-range (`bytes=0-100,200-300`)
   *   - `bytes=-0` (suffix of zero bytes is meaningless)
   *
   * ponytail: write a small pure parser instead of pulling the
   * `range-parser` npm package — the package is ~70 lines and the
   * surgeon-spec only needs the three forms above. Keep the API
   * surface inside this file; the tests exercise the surface directly.
   */
  static parseRange(
    header: string,
    size: number,
  ): { start: number; end: number } | { invalidRange: true } | null {
    // Strict regex: `bytes=` prefix is literal; both halves must be digits
    // (suffix-length uses empty start, open-ended uses empty end).
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match) return null;
    const startStr = match[1] ?? '';
    const endStr = match[2] ?? '';
    if (startStr === '' && endStr === '') return null;
    const lastIndex = size - 1;
    let start: number;
    let end: number;
    if (startStr === '') {
      // Suffix-length: last N bytes. RFC 7233 forbids `-0` (zero bytes).
      const suffixLen = Number(endStr);
      if (suffixLen <= 0) return null;
      start = Math.max(0, lastIndex - suffixLen + 1);
      end = lastIndex;
    } else {
      start = Number(startStr);
      if (endStr === '') {
        end = lastIndex;
      } else {
        end = Number(endStr);
      }
      // Clamp both into [0, lastIndex].
      start = Math.max(0, Math.min(start, lastIndex));
      end = Math.max(0, Math.min(end, lastIndex));
    }
    if (start > end) return { invalidRange: true };
    return { start, end };
  }

  private listenOnHttp(
    server: ReturnType<typeof createHttpServer>,
    port: number,
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const onError = (err: Error): void => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = (): void => {
        server.off('error', onError);
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          resolve(addr.port);
        } else {
          reject(new Error('MediaServer: could not read assigned port'));
        }
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
  }
}
