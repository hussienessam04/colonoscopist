import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';

const FAKE_USER_DATA = 'C:\\fake\\userData';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => (name === 'userData' ? FAKE_USER_DATA : '')),
  },
}));

import { dataDir } from '../../src/main/paths';

describe('dataDir (SET-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns <userData>/data', () => {
    const result = dataDir();
    expect(result).toBe(path.join(FAKE_USER_DATA, 'data'));
  });

  it('invokes app.getPath with "userData"', async () => {
    const { app } = await import('electron');
    dataDir();
    expect(app.getPath).toHaveBeenCalledWith('userData');
  });
});
