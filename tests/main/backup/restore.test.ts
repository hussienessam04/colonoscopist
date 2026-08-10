// Phase 7 / Plan 07-01 — Restore unit tests (D-13..D-16 + D-15 path-traversal).
// Real yauzl round-trip with crafted zip fixtures including a zip-slip entry.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ZipArchive } from 'archiver';
import { createWriteStream } from 'node:fs';

let tmpDir: string;

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => (key === 'userData' ? tmpDir : tmpDir),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b,
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: () => {}, on: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: async () => null },
}));

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-restore-'));
});

afterEach(() => {
  vi.resetModules();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

/** Build a zip via archiver (sanitizes filenames) — used for "good" fixtures
 * where every entry name is a safe relative path. Writes the zip to `zipPath`. */
function buildFixtureZip(opts: {
  zipPath: string;
  entries: Array<{ name: string; data: Buffer }>;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(opts.zipPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const entry of opts.entries) {
      archive.append(entry.data, { name: entry.name });
    }
    void archive.finalize();
  });
}

/** Build a zip with arbitrary file entries (NO path sanitization).
 * Used for testing the path-traversal defense — we need to inject entries
 * whose filenames contain `..` segments or absolute paths, which archiver
 * would strip at write time. This is a tiny hand-rolled ZIP writer that
 * emits the three required sections (local file headers + central directory
 * + end-of-central-directory) with stored (no compression) entries. */
function buildRawZip(
  entries: Array<{ name: string; data: Buffer }>,
): Buffer {
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const data = entry.data;
    const crc = computeCrc32(data);
    // Local file header (30 bytes + filename + data)
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // general purpose flag
    local.writeUInt16LE(0, 8); // compression method (stored)
    local.writeUInt16LE(0, 10); // last mod time
    local.writeUInt16LE(0, 12); // last mod date
    local.writeUInt32LE(crc, 14); // crc32
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26); // filename length
    local.writeUInt16LE(0, 28); // extra length
    localParts.push(local, nameBuf, data);

    // Central directory entry (46 bytes + filename)
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // signature
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // general purpose flag
    cd.writeUInt16LE(0, 10); // compression method
    cd.writeUInt16LE(0, 12); // last mod time
    cd.writeUInt16LE(0, 14); // last mod date
    cd.writeUInt32LE(crc, 16); // crc32
    cd.writeUInt32LE(data.length, 20); // compressed size
    cd.writeUInt32LE(data.length, 24); // uncompressed size
    cd.writeUInt16LE(nameBuf.length, 28); // filename length
    cd.writeUInt16LE(0, 30); // extra length
    cd.writeUInt16LE(0, 32); // file comment length
    cd.writeUInt16LE(0, 34); // disk number start
    cd.writeUInt16LE(0, 36); // internal file attributes
    cd.writeUInt32LE(0, 38); // external file attributes
    cd.writeUInt32LE(offset, 42); // relative offset of local header
    cdParts.push(cd, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const localTotal = Buffer.concat(localParts);
  const cdTotal = Buffer.concat(cdParts);
  const cdSize = cdTotal.length;
  const cdOffset = localTotal.length;
  // End of central directory (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk number with cd
  eocd.writeUInt16LE(entries.length, 8); // entries on disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(cdSize, 12); // size of cd
  eocd.writeUInt32LE(cdOffset, 16); // offset of cd
  eocd.writeUInt16LE(0, 20); // comment length
  return Buffer.concat([localTotal, cdTotal, eocd]);
}

function computeCrc32(buf: Buffer): number {
  // ponytail: minimal CRC32 — only used by the test fixture. zlib.crc32
  // is available on Node 20+ but we don't depend on it so the fixture
  // works on every runtime.
  let table = (computeCrc32 as { table?: Int32Array }).table;
  if (!table) {
    table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c;
    }
    (computeCrc32 as { table?: Int32Array }).table = table;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/** Build a small valid sqlite db file on disk. */
function buildSqliteFixture(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE procedures (id TEXT PRIMARY KEY);
    INSERT INTO procedures VALUES ('p1');
    INSERT INTO procedures VALUES ('p2');
    INSERT INTO procedures VALUES ('p3');
  `);
  db.close();
}

describe('restore.safeEntryPath', () => {
  it('rejects absolute paths', async () => {
    const { safeEntryPath } = await import('../../../src/main/backup/restore');
    const stagingDir = path.join(tmpDir, 'stage');
    const entry = { fileName: '/etc/passwd' } as unknown as import('yauzl').Entry;
    expect(safeEntryPath(entry, stagingDir)).toBeNull();
  });

  it("rejects '..' segments", async () => {
    const { safeEntryPath } = await import('../../../src/main/backup/restore');
    const stagingDir = path.join(tmpDir, 'stage');
    const entry = { fileName: '../escape.txt' } as unknown as import('yauzl').Entry;
    expect(safeEntryPath(entry, stagingDir)).toBeNull();
  });

  it('rejects nested .. segments that escape the staging dir', async () => {
    const { safeEntryPath } = await import('../../../src/main/backup/restore');
    const stagingDir = path.join(tmpDir, 'stage');
    const entry = { fileName: 'foo/../../escape.txt' } as unknown as import('yauzl').Entry;
    expect(safeEntryPath(entry, stagingDir)).toBeNull();
  });

  it('accepts paths inside the staging dir', async () => {
    const { safeEntryPath } = await import('../../../src/main/backup/restore');
    const stagingDir = path.join(tmpDir, 'stage');
    const entry = { fileName: 'media/patients/p1/proc1/screenshots/test.jpg' } as unknown as import(
      'yauzl'
    ).Entry;
    const result = safeEntryPath(entry, stagingDir);
    expect(result).not.toBeNull();
    expect(result).toContain('media');
    expect(result).toContain('test.jpg');
  });

  it('rejects Windows-style backslashes that escape', async () => {
    const { safeEntryPath } = await import('../../../src/main/backup/restore');
    const stagingDir = path.join(tmpDir, 'stage');
    // backslashes are normalized to forward slashes BEFORE the isAbsolute
    // check, so '..\\..\\escape.txt' becomes '../../escape.txt' and is caught
    // by the '..' segment check.
    const entry = { fileName: '..\\..\\escape.txt' } as unknown as import('yauzl').Entry;
    expect(safeEntryPath(entry, stagingDir)).toBeNull();
  });
});

describe('unpackRestore', () => {
  it('unpacks a known-good fixture into staging dir + integrity_check returns "ok"', async () => {
    // Build the source DB.
    const sourceDbPath = path.join(tmpDir, 'source.db');
    buildSqliteFixture(sourceDbPath);
    const dbBytes = (await import('node:fs')).readFileSync(sourceDbPath);

    const zipPath = path.join(tmpDir, 'good.zip');
    await buildFixtureZip({
      zipPath,
      entries: [
        { name: 'app.db', data: dbBytes },
        { name: 'media/patients/p1/proc1/screenshots/test.jpg', data: Buffer.from([0xff, 0xd8, 0xff]) },
        { name: 'reports/r1.pdf', data: Buffer.from('%PDF-1.4\n') },
      ],
    });

    const { unpackRestore } = await import('../../../src/main/backup/restore');
    const stagingDir = path.join(tmpDir, 'stage');
    const result = await unpackRestore({ zipPath, stagingDir });

    expect(result.fileCount).toBe(3);
    expect(existsSync(path.join(stagingDir, 'app.db'))).toBe(true);
    expect(existsSync(path.join(stagingDir, 'media/patients/p1/proc1/screenshots/test.jpg'))).toBe(true);
    expect(existsSync(path.join(stagingDir, 'reports/r1.pdf'))).toBe(true);

    const { integrityCheck } = await import('../../../src/main/backup/restore');
    expect(integrityCheck(stagingDir)).toBe('ok');
  });

  it('rejects a zip-slip entry before any file is written to disk', async () => {
    // Build a known-good source db so the rest of the zip is valid.
    const sourceDbPath = path.join(tmpDir, 'source.db');
    buildSqliteFixture(sourceDbPath);
    const dbBytes = (await import('node:fs')).readFileSync(sourceDbPath);

    // ponytail: build the zip with raw bytes — archiver's `sanitizePath`
    // strips `../` at write time, so the malicious entry would be silently
    // rewritten to a safe name before reaching yauzl. The raw builder
    // emits the malicious filename verbatim, so yauzl's own validateFileName
    // + our safeEntryPath defense have something to defend against.
    const zipPath = path.join(tmpDir, 'slip.zip');
    const zipBytes = buildRawZip([
      { name: 'app.db', data: dbBytes },
      { name: '../escape.txt', data: Buffer.from('PWNED') },
    ]);
    (await import('node:fs')).writeFileSync(zipPath, zipBytes);

    const { unpackRestore } = await import('../../../src/main/backup/restore');
    const stagingDir = path.join(tmpDir, 'stage');

    // ponytail: yauzl's validateFileName is the first line of defense; it
    // throws `invalid relative path: ../escape.txt` BEFORE any filesystem
    // write. Our safeEntryPath is the second line. Either defense firing
    // is the correct behavior — the file must NOT land on disk either way.
    await expect(unpackRestore({ zipPath, stagingDir })).rejects.toThrow(/relative path/);

    // Confirm NO escape.txt landed in tmpDir or anywhere outside stagingDir.
    expect(existsSync(path.join(tmpDir, 'escape.txt'))).toBe(false);
  });

  it('rejects an absolute-path entry before any file is written to disk', async () => {
    const sourceDbPath = path.join(tmpDir, 'source.db');
    buildSqliteFixture(sourceDbPath);
    const dbBytes = (await import('node:fs')).readFileSync(sourceDbPath);

    // ponytail: same raw-builder rationale as the zip-slip test above.
    const zipPath = path.join(tmpDir, 'abs.zip');
    const zipBytes = buildRawZip([
      { name: 'app.db', data: dbBytes },
      { name: '/etc/passwd', data: Buffer.from('PWNED') },
    ]);
    (await import('node:fs')).writeFileSync(zipPath, zipBytes);

    const { unpackRestore } = await import('../../../src/main/backup/restore');
    const stagingDir = path.join(tmpDir, 'stage');

    // yauzl's validateFileName throws `absolute path: /etc/passwd`.
    await expect(unpackRestore({ zipPath, stagingDir })).rejects.toThrow(/absolute path/);
  });
});

describe('integrityCheck', () => {
  it('returns "ok" for a known-good sqlite file', async () => {
    const dbPath = path.join(tmpDir, 'good.db');
    buildSqliteFixture(dbPath);
    // Stage the file under stagingDir/app.db.
    const stagingDir = path.join(tmpDir, 'stage');
    const fs = await import('node:fs');
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.copyFileSync(dbPath, path.join(stagingDir, 'app.db'));

    const { integrityCheck } = await import('../../../src/main/backup/restore');
    expect(integrityCheck(stagingDir)).toBe('ok');
  });

  it('returns a non-"ok" string for a corrupted sqlite file', async () => {
    const stagingDir = path.join(tmpDir, 'stage');
    const fs = await import('node:fs');
    fs.mkdirSync(stagingDir, { recursive: true });
    // Truncate a valid sqlite file to simulate corruption.
    const dbPath = path.join(tmpDir, 'good.db');
    buildSqliteFixture(dbPath);
    const goodBytes = fs.readFileSync(dbPath);
    const truncated = goodBytes.subarray(0, Math.floor(goodBytes.length / 2));
    fs.writeFileSync(path.join(stagingDir, 'app.db'), truncated);

    const { integrityCheck } = await import('../../../src/main/backup/restore');
    const result = integrityCheck(stagingDir);
    expect(result).not.toBe('ok');
    // ponytail: integrity_check on a truncated sqlite returns either an
    // error message or an array of issue descriptions — either way it's
    // a non-'ok' string, which is what the renderer cares about.
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns a descriptive string when app.db is missing', async () => {
    const stagingDir = path.join(tmpDir, 'empty-stage');
    const fs = await import('node:fs');
    fs.mkdirSync(stagingDir, { recursive: true });

    const { integrityCheck } = await import('../../../src/main/backup/restore');
    const result = integrityCheck(stagingDir);
    expect(typeof result).toBe('string');
    expect(result).toContain('not found');
  });
});

describe('previewRestore', () => {
  it('returns filename + totalSize + integrityCheck + procedureCount', async () => {
    const sourceDbPath = path.join(tmpDir, 'source.db');
    buildSqliteFixture(sourceDbPath);
    const dbBytes = (await import('node:fs')).readFileSync(sourceDbPath);

    const zipPath = path.join(tmpDir, 'preview.zip');
    await buildFixtureZip({
      zipPath,
      entries: [
        { name: 'app.db', data: dbBytes },
        { name: 'media/test.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) },
      ],
    });

    const { previewRestore } = await import('../../../src/main/backup/restore');
    const stagingDir = path.join(tmpDir, 'preview-stage');
    const result = await previewRestore({ zipPath, stagingDir });

    expect(result.filename).toBe('preview.zip');
    expect(result.totalSize).toBeGreaterThan(0);
    expect(result.dbIntegrityCheck).toBe('ok');
    expect(result.procedureCount).toBe(3); // 3 inserts in buildSqliteFixture
    expect(statSync(zipPath).size).toBeGreaterThan(0);
  });
});
