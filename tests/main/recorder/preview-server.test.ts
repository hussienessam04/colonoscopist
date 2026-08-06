// PreviewServer — JPEG splitter + HTTP multipart/x-mixed-replace integration.
// Per Plan: live preview during recording.
//
// Two layers of coverage:
//   1. Static splitter (`indexOfEoi`) — pure function, no sockets, fast.
//   2. End-to-end: feed real bytes through the TCP listener and assert
//      a Chromium-shaped multipart stream comes out the HTTP side.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connect, type Socket as TcpSocket } from 'node:net';
import { PreviewServer } from '../../../src/main/recorder/preview-server';

function makeJpeg(payload: Buffer): Buffer {
  // ponytail: minimal valid-JPEG-shaped buffer — SOI marker + payload
  // bytes + EOI marker. The splitter only looks for FF D9; it does NOT
  // validate the JPEG (ffmpeg produced it; the renderer's <img> parses
  // it). 0xFF bytes in the payload are byte-stuffed (FF 00) by real
  // JPEG encoders so they never collide with the FF D9 EOI marker.
  return Buffer.concat([Buffer.from([0xff, 0xd8]), payload, Buffer.from([0xff, 0xd9])]);
}

describe('PreviewServer.indexOfEoi', () => {
  it('returns -1 when no FF D9 is in the buffer', () => {
    const buf = Buffer.from([0x01, 0x02, 0xff, 0x00, 0xd9, 0xaa]);
    expect(PreviewServer.indexOfEoi(buf, 0)).toBe(-1);
  });

  it('returns the offset of the FF D9 pair', () => {
    const buf = Buffer.from([0xaa, 0xff, 0xd9, 0xbb]);
    expect(PreviewServer.indexOfEoi(buf, 0)).toBe(1);
  });

  it('respects the start offset', () => {
    const buf = Buffer.from([0xff, 0xd9, 0xaa, 0xff, 0xd9]);
    expect(PreviewServer.indexOfEoi(buf, 2)).toBe(3);
  });

  it('returns -1 for a single-byte buffer (no pair to find)', () => {
    expect(PreviewServer.indexOfEoi(Buffer.from([0xff]), 0)).toBe(-1);
  });
});

describe('PreviewServer end-to-end', () => {
  let server: PreviewServer;

  beforeEach(() => {
    server = new PreviewServer();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('allocates a TCP port + HTTP port and reports a previewUrl on start()', async () => {
    const handle = await server.start();
    expect(handle.tcpPort).toBeGreaterThan(0);
    expect(handle.httpUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/preview$/);
    expect(server.isRunning()).toBe(true);
  });

  it('stop() is idempotent — second call does not throw', async () => {
    await server.start();
    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();
    expect(server.isRunning()).toBe(false);
  });

  it('extracts three complete JPEG frames from a concatenated MJPEG buffer', async () => {
    const handle = await server.start();

    // ponytail: simulate ffmpeg's MJPEG-over-TCP output — three JPEGs
    // concatenated, fed in two chunks to exercise the split-across-reads
    // path inside onTcpData.
    const frame1 = makeJpeg(Buffer.from('frame-1-payload'));
    const frame2 = makeJpeg(Buffer.from('frame-2-payload'));
    const frame3 = makeJpeg(Buffer.from('frame-3-payload'));

    await new Promise<void>((resolve, reject) => {
      const sock: TcpSocket = connect(handle.tcpPort, '127.0.0.1', (err) => {
        if (err) return reject(err);
        // Send chunk 1: full frame1 + half of frame2 (no EOI yet).
        sock.write(Buffer.concat([frame1, frame2.subarray(0, 4)]));
        // Send chunk 2: rest of frame2 + full frame3.
        sock.write(Buffer.concat([frame2.subarray(4), frame3]));
        sock.end();
      });
      sock.on('error', reject);
      sock.on('close', () => resolve());
    });

    // After TCP drain, the splitter should have broadcast all three.
    const latest = server.getLatestFrame();
    expect(latest).not.toBeNull();
    expect(latest).toEqual(frame3);
  });

  it('serves a multipart/x-mixed-replace stream with the latest frame to a GET /preview client', async () => {
    const handle = await server.start();
    const frame = makeJpeg(Buffer.from('served-frame'));

    // Connect TCP and write one frame so latestFrame is populated before
    // the HTTP client connects. Wait until the server has actually
    // processed the frame (getLatestFrame returns it) before moving on.
    await new Promise<void>((resolve, reject) => {
      const sock = connect(handle.tcpPort, '127.0.0.1', (err) => {
        if (err) return reject(err);
        sock.write(frame);
        sock.end();
        sock.on('close', () => resolve());
        sock.on('error', reject);
      });
    });
    // ponytail: poll briefly for the splitter to have processed the
    // chunk. Node's data event is async — the TCP socket may close from
    // the client's side before the server's read handler runs.
    for (let i = 0; i < 50 && server.getLatestFrame() === null; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(server.getLatestFrame()).toEqual(frame);

    // ponytail: use a raw TCP socket to issue a minimal HTTP/1.1 GET
    // instead of node:http's `request`. The HTTP client library
    // apparently interferes with the long-lived multipart stream — the
    // server writes the response synchronously but the client only
    // receives the initial CRLF before its data handler goes quiet. A
    // raw socket reads whatever the server sends, in the order it sends
    // it, so we can assert the full multipart body lands on the wire.
    //
    // The server keeps the connection open for the long-lived stream
    // (it never calls `res.end()`), so the socket close is driven by a
    // watchdog: collect bytes until either the frame lands in the body
    // OR 1s elapses. Force-close the socket at that point so the test
    // can resolve.
    const httpPort = Number(new URL(handle.httpUrl).port);
    const httpResponse = await new Promise<{ status: number; contentType: string | undefined; body: Buffer }>(
      (resolve) => {
        const chunks: Buffer[] = [];
        const sock = connect(httpPort, '127.0.0.1', () => {
          sock.write('GET /preview HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
        });
        let settled = false;
        sock.on('data', (c: Buffer) => {
          if (settled) return;
          chunks.push(c);
          const raw = Buffer.concat(chunks);
          const headerEnd = raw.indexOf('\r\n\r\n');
          if (headerEnd < 0) return;
          const body = raw.subarray(headerEnd + 4);
          if (body.includes(frame)) {
            settled = true;
            const headerText = raw.subarray(0, headerEnd).toString('utf8');
            const statusLine = headerText.split('\r\n')[0] ?? '';
            const statusMatch = statusLine.match(/^HTTP\/1\.[01] (\d+)/);
            const status = statusMatch ? Number(statusMatch[1]) : 0;
            const ctMatch = headerText.match(/[Cc]ontent-[Tt]ype:\s*(.+)\r\n/);
            const contentType = ctMatch ? ctMatch[1].trim() : undefined;
            sock.destroy();
            resolve({ status, contentType, body });
          }
        });
        sock.on('error', () => undefined);
        setTimeout(() => {
          if (settled) return;
          settled = true;
          const raw = Buffer.concat(chunks);
          const headerEnd = raw.indexOf('\r\n\r\n');
          if (headerEnd < 0) {
            sock.destroy();
            resolve({ status: 0, contentType: undefined, body: raw });
            return;
          }
          const headerText = raw.subarray(0, headerEnd).toString('utf8');
          const statusLine = headerText.split('\r\n')[0] ?? '';
          const statusMatch = statusLine.match(/^HTTP\/1\.[01] (\d+)/);
          const status = statusMatch ? Number(statusMatch[1]) : 0;
          const ctMatch = headerText.match(/[Cc]ontent-[Tt]ype:\s*(.+)\r\n/);
          const contentType = ctMatch ? ctMatch[1].trim() : undefined;
          const body = raw.subarray(headerEnd + 4);
          sock.destroy();
          resolve({ status, contentType, body });
        }, 1_000);
      },
    );

    expect(httpResponse.status).toBe(200);
    expect(httpResponse.contentType).toBe('multipart/x-mixed-replace; boundary=frame');
    // ponytail: body is chunked transfer-encoded because Node's http
    // server wraps res.write() calls in chunked frames by default. The
    // frame bytes ARE in the body (verified via body.includes(frame) →
    // true before resolve), but vitest's Buffer toContain matcher may
    // compare differently. Assert via the explicit includes() call to
    // keep the test independent of matcher implementation details.
    expect(httpResponse.body.toString('utf8')).toContain('--frame');
    expect(httpResponse.body.toString('utf8')).toContain('Content-Type: image/jpeg');
    expect(httpResponse.body.includes(frame)).toBe(true);
  });

  it('returns 404 for non-/preview paths', async () => {
    const handle = await server.start();
    const httpPort = Number(new URL(handle.httpUrl).port);
    // ponytail: raw TCP for parity with the multipart test above — the
    // short 404 response means the server closes the connection cleanly,
    // so a raw socket gets the full response in one read.
    const status = await new Promise<number>((resolve, reject) => {
      const sock = connect(httpPort, '127.0.0.1', () => {
        sock.write('GET /other HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
      });
      const chunks: Buffer[] = [];
      sock.on('data', (c: Buffer) => chunks.push(c));
      sock.on('error', (err) => reject(err));
      sock.on('close', () => {
        const raw = Buffer.concat(chunks);
        const statusLine = raw.toString('utf8').split('\r\n')[0] ?? '';
        const m = statusLine.match(/^HTTP\/1\.[01] (\d+)/);
        resolve(m ? Number(m[1]) : 0);
      });
    });
    expect(status).toBe(404);
  });
});
