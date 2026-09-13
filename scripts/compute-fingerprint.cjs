#!/usr/bin/env node
// Quick task 260913-rp5 — compute this machine's fingerprint (so the
// vendor can sign a matching .lic file). Vendor-side counterpart to
// src/main/license/fingerprint.ts — same SHA-256 hash, same field
// order, so the values match byte-for-byte.
//
// Usage: node scripts/compute-fingerprint.cjs

const { networkInterfaces, cpus } = require('node:os');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

function readFirstMac() {
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.internal) continue;
      if (info.family !== 'IPv4') continue;
      if (info.mac && info.mac !== '00:00:00:00:00:00') return info.mac;
    }
  }
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.internal) continue;
      if (info.mac && info.mac !== '00:00:00:00:00:00') return info.mac;
    }
  }
  return '';
}

function readDiskSerialWmic(timeoutMs) {
  return new Promise((resolve) => {
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
      } catch {}
      resolve(null);
    }, timeoutMs);
    const out = [];
    child.stdout.on('data', (c) => out.push(c));
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
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        resolve(null);
        return;
      }
      const serial = lines.slice(1).find((l) => l.length > 0) ?? null;
      resolve(serial);
    });
  });
}

function readDiskSerialPowerShell(timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(
      'powershell',
      ['-NoProfile', '-Command', 'Get-CimInstance Win32_DiskDrive | Select-Object -ExpandProperty SerialNumber'],
      { shell: false, windowsVerbatimArguments: false, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      resolve(null);
    }, timeoutMs);
    const out = [];
    child.stdout.on('data', (c) => out.push(c));
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
      if (!text) return resolve(null);
      const first = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
      resolve(first ?? null);
    });
  });
}

(async () => {
  const cpuModel = cpus()[0]?.model ?? '';
  const mac = readFirstMac();
  const diskSerial = (await readDiskSerialWmic(5_000)) ?? (await readDiskSerialPowerShell(5_000)) ?? '';
  const fingerprint = createHash('sha256')
    .update(`${cpuModel}|${diskSerial}|${mac}`, 'utf8')
    .digest('hex');
  console.log(`cpuModel:    ${cpuModel}`);
  console.log(`diskSerial:  ${diskSerial || '(none — degraded fingerprint)'}`);
  console.log(`mac:         ${mac}`);
  console.log(`fingerprint: ${fingerprint}`);
})();
