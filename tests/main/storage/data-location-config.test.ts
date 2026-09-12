// @vitest-environment node
// Quick task 20260912-shared-database-optional — coverage for the
// sync config read/write + the path-validity probe. The config is
// stored at `<userData>/data-location.json` and is the OFFICIAL
// source of truth for the toggle; tests mock `app.getPath` so the
// write target is the test's tmp dir, not the real Electron
// userData.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let userDataDir = '';

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => (key === 'userData' ? userDataDir : ''),
  },
}));

beforeEach(() => {
  userDataDir = mkdtempSync(path.join(tmpdir(), 'colonoscopist-data-loc-'));
});

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true });
  vi.resetModules();
});

describe('data-location-config', () => {
  it('returns defaults when no config file exists', async () => {
    vi.resetModules();
    const mod = await import('../../../src/main/storage/data-location-config');
    const cfg = mod.getDataLocationConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.sharedPath).toBe(null);
    expect(cfg.updatedAt).toBe(0);
  });

  it('persists a written config so the next read sees it', async () => {
    vi.resetModules();
    const mod = await import('../../../src/main/storage/data-location-config');
    mod.setDataLocationConfig({ enabled: true, sharedPath: '/tmp/shared' });
    vi.resetModules();
    const reloaded = await import('../../../src/main/storage/data-location-config');
    const cfg = reloaded.getDataLocationConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.sharedPath).toBe('/tmp/shared');
    expect(cfg.updatedAt).toBeGreaterThan(0);
  });

  it('falls back to defaults on a corrupted JSON file', async () => {
    writeFileSync(
      path.join(userDataDir, 'data-location.json'),
      '{ this is not valid json',
      'utf8',
    );
    vi.resetModules();
    const mod = await import('../../../src/main/storage/data-location-config');
    const cfg = mod.getDataLocationConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.sharedPath).toBe(null);
  });

  it('normalizes unexpected shapes (string where boolean expected)', async () => {
    writeFileSync(
      path.join(userDataDir, 'data-location.json'),
      JSON.stringify({ enabled: 'yes', sharedPath: 1234, updatedAt: 'now' }),
      'utf8',
    );
    vi.resetModules();
    const mod = await import('../../../src/main/storage/data-location-config');
    const cfg = mod.getDataLocationConfig();
    // 'yes' !== true → false; number !== string → null; string !== number → 0.
    expect(cfg.enabled).toBe(false);
    expect(cfg.sharedPath).toBe(null);
    expect(cfg.updatedAt).toBe(0);
  });

  it('validateSharedPath flags a missing folder', async () => {
    vi.resetModules();
    const mod = await import('../../../src/main/storage/data-location-config');
    const missing = path.join(userDataDir, 'does-not-exist');
    expect(mod.validateSharedPath(missing)).toEqual({
      ok: false,
      reason: 'missing',
    });
  });

  it('validateSharedPath accepts a writable directory', async () => {
    vi.resetModules();
    const mod = await import('../../../src/main/storage/data-location-config');
    const good = path.join(userDataDir, 'writable');
    mkdirSync(good, { recursive: true });
    expect(mod.validateSharedPath(good)).toEqual({ ok: true });
  });

  it('validateSharedPath rejects a file path', async () => {
    vi.resetModules();
    const mod = await import('../../../src/main/storage/data-location-config');
    const filePath = path.join(userDataDir, 'a-file.txt');
    writeFileSync(filePath, '', 'utf8');
    expect(mod.validateSharedPath(filePath)).toEqual({
      ok: false,
      reason: 'not-directory',
    });
  });
});