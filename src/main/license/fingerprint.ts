// Phase 8 / Plan 01 — Machine fingerprint helper (LIC-02 + D-12).
//
// Per CONTEXT D-12: fingerprint = SHA-256(CPU.model + diskSerial + MAC).
//   - CPU: os.cpus()[0].model (Node stdlib).
//   - MAC: os.networkInterfaces() first non-internal IPv4 MAC.
//   - Disk serial: one-shot `wmic diskdrive get serialnumber` with a 5s
//     timeout; falls back to PowerShell `Get-CimInstance Win32_DiskDrive`
//     with another 5s timeout. On both timeouts: degraded fingerprint
//     (cpuModel + mac only) per RESEARCH Pitfall 5 — still unique enough
//     for a single workstation.
//
// Test seam: setting `(__fingerprint as any).__diskSerialForTest` short-
// circuits the spawn so tests don't shell out. The seam is consumed by
// `tests/main/license/fingerprint.test.ts`.

import { spawn } from 'node:child_process';
import { networkInterfaces, cpus } from 'node:os';
import { hashFingerprint } from './verify';

/**
 * Read the first non-internal IPv4 MAC from os.networkInterfaces(). On
 * Windows, every NIC has an entry; we skip loopback + virtual adapters
 * (Hyper-V / VirtualBox / Docker) so the result is stable across
 * reboots (per A3 in RESEARCH Assumptions Log).
 */
function readFirstMac(): string {
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] ?? []) {
      if (info.internal) continue;
      if (info.family !== 'IPv4') continue;
      if (info.mac && info.mac !== '00:00:00:00:00:00') {
        return info.mac;
      }
    }
  }
  // Fallback: any MAC (even IPv6-only) — better than an empty string.
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] ?? []) {
      if (info.internal) continue;
      if (info.mac && info.mac !== '00:00:00:00:00:00') {
        return info.mac;
      }
    }
  }
  return '';
}

/**
 * Read the disk serial number via `wmic diskdrive get serialnumber`.
 * Returns the trimmed string or null on timeout / error. The timeout
 * uses Promise.race so a hung wmic process doesn't lock the activation
 * modal forever (RESEARCH Pitfall 5).
 */
function readDiskSerialWmic(timeoutMs: number): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const child = spawn('wmic', ['diskdrive', 'get', 'serialnumber'], {
      shell: false,
      windowsVerbatimArguments: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // best-effort
      }
      resolve(null);
    }, timeoutMs);

    const out: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = Buffer.concat(out).toString('utf8');
      // wmic output: header line "SerialNumber" + one line per disk.
      // Last non-empty line is the boot disk's serial.
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        resolve(null);
        return;
      }
      // Skip the header row.
      const serials = lines.slice(1);
      const serial = serials.find((l) => l && l.length > 0) ?? null;
      resolve(serial);
    });
  });
}

/**
 * Read the disk serial number via PowerShell `Get-CimInstance Win32_DiskDrive`.
 * Used as a fallback when wmic times out or fails (RESEARCH Pitfall 5).
 */
function readDiskSerialPowerShell(timeoutMs: number): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const child = spawn(
      'powershell',
      ['-NoProfile', '-Command', 'Get-CimInstance Win32_DiskDrive | Select-Object -ExpandProperty SerialNumber'],
      {
        shell: false,
        windowsVerbatimArguments: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // best-effort
      }
      resolve(null);
    }, timeoutMs);

    const out: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = Buffer.concat(out).toString('utf8').trim();
      if (!text) {
        resolve(null);
        return;
      }
      const first = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
      resolve(first ?? null);
    });
  });
}

// Test seam: fingerprint.test.ts sets this string to bypass the spawn.
const fingerprintModule = {
  __diskSerialForTest: null as string | null,
};

/**
 * Compute the workstation's SHA-256 fingerprint per LIC-02 + D-12.
 *
 *   - cpuModel: os.cpus()[0].model
 *   - diskSerial: wmic (5s) → PowerShell (5s) → '' (degraded)
 *   - mac: first non-internal, non-virtual MAC from networkInterfaces()
 *
 * Returns a 64-char hex string. Two clinics with identical CPU/MAC vendor
 * still differ on disk serial (per ASVS V8 disambiguation).
 */
export async function computeMachineFingerprint(): Promise<string> {
  const cpuModel = cpus()[0]?.model ?? '';
  const mac = readFirstMac();

  // Test seam: skip the spawn when set.
  let diskSerial = '';
  if (fingerprintModule.__diskSerialForTest !== null) {
    diskSerial = fingerprintModule.__diskSerialForTest;
  } else {
    diskSerial =
      (await readDiskSerialWmic(5_000)) ??
      (await readDiskSerialPowerShell(5_000)) ??
      '';
  }

  return hashFingerprint({ cpuModel, diskSerial, mac });
}

/**
 * Type-only re-export for tests: setting `(__fingerprint as any).__diskSerialForTest`
 * is the canonical override seam.
 */
export const __fingerprint = fingerprintModule;