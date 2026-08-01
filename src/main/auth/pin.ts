// PIN hashing via Node crypto.scrypt.
// Per D-02 + Fix 3 + PITFALLS §Security Mistakes.
// Stored format: scrypt$N$r$p$saltB64$hashB64

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { safeStorage } from 'electron';

const SCRYPT_N = 1 << 15; // 32768
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const KEY_LEN = 64;

function ensureEncryptionAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // Per Fix 3 — fail-closed. Never write plaintext.
    const err = new Error('safeStorage encryption unavailable on this workstation') as Error & { code: string };
    err.code = 'IPC_ENCRYPTION_UNAVAILABLE';
    throw err;
  }
}

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LEN,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      },
    );
  });
}

export async function hashPin(pin: string): Promise<string> {
  ensureEncryptionAvailable();
  const salt = randomBytes(16);
  const hash = await scryptAsync(pin, salt);
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  ensureEncryptionAvailable();
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  const candidate = await scryptAsync(pin, salt);
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}