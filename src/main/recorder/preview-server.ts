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
// No new dependencies — Node's `net` + `http` stdlib only.

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
