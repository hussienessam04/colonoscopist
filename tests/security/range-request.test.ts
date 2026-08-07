// @vitest-environment node
// Phase 5 / Plan 04 task 3 — MediaServer security audit.
//
// The /media/<patientId>/<procedureId>/<file> route is the doctor-facing
// LonglivedMediaServer on 127.0.0.1:<random>. Browser fetch from the
// <video> element issues GET + Range requests. The route already
// constrains each URL segment via the MEDIA_ROUTE_RE regex and
// double-checks with path.relative() that the resolved file stays
// inside data/media/patients (T-05-08). Plan 04 ships an explicit
// security audit file so the boundary is regression-protected.
//
// Coverage matrix mirrors the test plan's range-request security
// cases plus the canonical boundary attacks:
//   1. URL-encoded path-escape `/media/..%2F..%2Fetc/passwd` -> 403/404
//   2. Absolute path injection `/media/C:/Users/foo/video.mp4`   -> 404
//   3. Null byte injection `/media/%00/etc/passwd`              -> 400/404
//   4. Out-of-tree file lookup `/media/foo/bar/baz.mp4`         -> 404
//   5. Range bytes=-100 (suffix-length)                         -> 206 + last 100
//   6. Range bytes=99999999-99999999 (out of bounds, clamps)    -> 206 + clamp
//   7. Range bytes=100-50 (start > end)                         -> 416 + Content-Range: bytes */<size>
//   8. Range bytes=abc-def (malformed)                           -> 200 + full file

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connect, type Socket as TcpSocket } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MediaServer } from '../../src/main/recorder/preview-server';

let mediaTmpDir: string;

// ponytail: same Electron stub shape as the preview-server suite
// (the route calls app.getPath('userData') during the path-escape
// guard).
vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => (key === 'userData' ? mediaTmpDir : mediaTmpDir),
  },
}));

function rawHttpRequest(
  port: number,
  routePath: string,
  method: 'GET' | 'HEAD' = 'GET',
  rangeHeader?: string,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const rangeLine = rangeHeader !== undefined ? `Range: ${rangeHeader}\r\n` : '';
    const sock = connect(port, '127.0.0.1', () => {
      sock.write(
        `${method} ${routePath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n${rangeLine}\r\n`,
      );
    });
    const chunks: Buffer[] = [];
    sock.on('data', (c: Buffer) => chunks.push(c));
    sock.on('error', (err) => reject(err));
    sock.on('close', () => {
      const raw = Buffer.concat(chunks);
      const headerEnd = raw.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        reject(new Error('No HTTP headers in response'));
        return;
      }
      const headerText = raw.subarray(0, headerEnd).toString('utf8');
      const statusLine = headerText.split('\r\n')[0] ?? '';
      const statusMatch = statusLine.match(/^HTTP\/1\.[01] (\d+)/);
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      const headers: Record<string, string> = {};
      for (const line of headerText.split('\r\n').slice(1)) {
        const idx = line.indexOf(':');
        if (idx > 0) {
          headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
        }
      }
      resolve({ status, headers, body: raw.subarray(headerEnd + 4) });
    });
  });
}

function writeMp4(relPath: string, bytes = 2048): void {
  const abs = path.join(mediaTmpDir, relPath);
  const dir = path.dirname(abs);
  mkdirSync(dir, { recursive: true });
  writeFileSync(abs, Buffer.alloc(bytes, 0xab));
}

describe('MediaServer security audit (Phase 5 / Plan 04 task 3)', () => {
  let server: MediaServer;

  beforeEach(() => {
    mediaTmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-sec-audit-'));
    vi.resetModules();
    server = new MediaServer();
  });

  afterEach(async () => {
    await server.stop();
    try {
      rmSync(mediaTmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('1. URL-encoded path-escape /media/..%2F..%2Fetc/passwd returns 403 or 404 (boundary defense)', async () => {
    // The regex rejects `%2F` because `\w.` doesn't match `/`. The
    // regex pcre's `..` segment is also rejected because the segment
    // is constrained to `[\w.-]+` (which DOES allow `..`). Either way,
    // the resolved path is escaped outside data/media/patients.
    writeMp4('data/media/patients/p1/proc1/video.mp4', 1024);
    const handle = await server.start();
    const response = await rawHttpRequest(
      handle.httpPort,
      '/media/..%2F..%2Fetc%2Fpasswd',
    );
    expect([403, 404]).toContain(response.status);
    // The body may be a short error string ("Not Found" or "Forbidden");
    // what matters is the file CONTENT was not streamed. assert the body
    // is not the canonical 1KiB mp4 payload we wrote to disk.
    expect(response.body.length).toBeLessThan(1024);
  });

  it('2. Absolute path segment C:/Users/foo/video.mp4 returns 404 (regex rejects colon)', async () => {
    writeMp4('data/media/patients/p1/proc1/video.mp4', 1024);
    const handle = await server.start();
    const response = await rawHttpRequest(handle.httpPort, '/media/C:/Users/foo/video.mp4');
    expect(response.status).toBe(404);
  });

  it('3. Null byte injection /media/%00/etc/passwd returns 404 or 400 (regex rejects %00)', async () => {
    writeMp4('data/media/patients/p1/proc1/video.mp4', 1024);
    const handle = await server.start();
    const response = await rawHttpRequest(handle.httpPort, '/media/%00/etc/passwd');
    // The regex disallows percent-encoded chars in path components
    // (the segment matcher is `[\w.-]+`); the resulting 404 is
    // canonical. Some HTTP servers might 400 on raw %00 — accept either.
    expect([400, 404]).toContain(response.status);
  });

  it('4. File outside userData root returns 404 (no /etc/passwd, no /etc/hosts)', async () => {
    const handle = await server.start();
    const response = await rawHttpRequest(handle.httpPort, '/media/foo/bar/secret.mp4');
    expect(response.status).toBe(404);
  });

  it('5. Range bytes=-100 (suffix-length) returns 206 with the last 100 bytes', async () => {
    writeMp4('data/media/patients/p1/proc1/video.mp4', 1024);
    const handle = await server.start();
    const response = await rawHttpRequest(
      handle.httpPort,
      '/media/p1/proc1/video.mp4',
      'GET',
      'bytes=-100',
    );
    expect(response.status).toBe(206);
    expect(response.headers['content-range']).toBe('bytes 924-1023/1024');
    expect(response.headers['content-length']).toBe('100');
    expect(response.body.length).toBe(100);
  });

  it('6. Range bytes=99999999-99999999 (out of bounds) clamps to file size; returns 206 + slice [size-1, size-1]', async () => {
    writeMp4('data/media/patients/p1/proc1/video.mp4', 2048);
    const handle = await server.start();
    const response = await rawHttpRequest(
      handle.httpPort,
      '/media/p1/proc1/video.mp4',
      'GET',
      'bytes=99999999-99999999',
    );
    expect(response.status).toBe(206);
    expect(response.headers['content-range']).toBe('bytes 2047-2047/2048');
    expect(response.headers['content-length']).toBe('1');
    expect(response.body.length).toBe(1);
  });

  it('7. Range bytes=100-50 (start > end) returns 416 + Content-Range: bytes */<size>', async () => {
    writeMp4('data/media/patients/p1/proc1/video.mp4', 2048);
    const handle = await server.start();
    const response = await rawHttpRequest(
      handle.httpPort,
      '/media/p1/proc1/video.mp4',
      'GET',
      'bytes=100-50',
    );
    expect(response.status).toBe(416);
    expect(response.headers['content-range']).toBe('bytes */2048');
  });

  it('8. Range bytes=abc-def (malformed) falls back to 200 + the full file', async () => {
    writeMp4('data/media/patients/p1/proc1/video.mp4', 2048);
    const handle = await server.start();
    const response = await rawHttpRequest(
      handle.httpPort,
      '/media/p1/proc1/video.mp4',
      'GET',
      'bytes=abc-def',
    );
    expect(response.status).toBe(200);
    expect(response.headers['content-length']).toBe('2048');
    expect(response.body.length).toBe(2048);
  });

  // Belt-and-suspenders: even when the Range header is present and the
  // path-escape regex was bypassed somehow, the path.relative() check
  // stops the route from streaming anything outside userData.
  it('9. Range on a path-escape attempt is still rejected (defense-in-depth)', async () => {
    writeMp4('data/media/patients/p1/proc1/video.mp4', 1024);
    const handle = await server.start();
    const response = await rawHttpRequest(
      handle.httpPort,
      '/media/..%2F..%2Fetc%2Fpasswd',
      'GET',
      'bytes=0-100',
    );
    expect([403, 404]).toContain(response.status);
    expect(response.body.length).toBeLessThan(1024);
  });

  // G-05-14 — Range request support for the new `/media/<p>/<proc>/screenshots/<file>`
  // URL shape + allow-list defense. The screenshots subdir lives one
  // level below the procedure directory; Range requests must continue
  // to work against the deeper URL shape (Chromium's <img> doesn't
  // Range-request, but the route surface is shared with the <video>
  // path and a future <img loading='lazy'> Range re-quest is plausible).
  it('10. Range request against /media/<p>/<proc>/screenshots/<file> serves 206 (G-05-14)', async () => {
    writeMp4('data/media/patients/p1/proc1/screenshots/5000.jpg', 4096);
    const handle = await server.start();
    const response = await rawHttpRequest(
      handle.httpPort,
      '/media/p1/proc1/screenshots/5000.jpg',
      'GET',
      'bytes=0-1023',
    );
    expect(response.status).toBe(206);
    expect(response.headers['content-range']).toBe('bytes 0-1023/4096');
    expect(response.headers['content-length']).toBe('1024');
    expect(response.body.length).toBe(1024);
  });

  it('11. Range request against an unknown subdir returns 404 (allow-list defense-in-depth — G-05-14)', async () => {
    // Seed the fixture so a missing-file 404 is NOT what's being
    // asserted. The allow-list check must reject before the Range parse
    // even runs, so the response is a plain 404 — not a 206 (Range
    // parsed), not a 416 (Range parsed but invalid), and not a 200.
    writeMp4('data/media/patients/p1/proc1/garbage/5000.jpg', 4096);
    const handle = await server.start();
    const response = await rawHttpRequest(
      handle.httpPort,
      '/media/p1/proc1/garbage/5000.jpg',
      'GET',
      'bytes=0-1023',
    );
    expect(response.status).toBe(404);
  });
});
