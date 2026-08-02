// renderer-main-capture-contract.test.ts — cross-process contract alignment.
//
// Per the plan: prefer static analysis (grep/AST) over runtime Electron —
// verifying shape compatibility via TS source inspection is enough for the
// BLOCKER 4 check. This file does NOT load the renderer; it inspects the TS
// source to assert:
//
//   1. Every method on `IpcContract.capture` is exposed by
//      src/preload/index.ts under the same name.
//   2. The `IpcContract.capture` payload shapes do NOT contain a `doctorId`
//      field (BLOCKER 4 — renderer cannot impersonate another doctor).
//   3. ProcedureRoom.tsx does NOT call setDefaultDevice or setPreset (D-01).
//   4. SettingsCapture.tsx is the ONLY renderer caller of setDefaultDevice.
//   5. useCaptureDeviceMap is the ONLY consumer of
//      navigator.mediaDevices.enumerateDevices and is used by both surfaces
//      (BLOCKER 1).
//   6. Phase 3 scope guards — no MediaRecorder, no capture:start/stop IPC
//      channels, no recording child-process handler, no mp4 output path.
//      (D-08, D-10, D-11; BLOCKER 1, 3, 4, 5; Q-A)

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const IPC_CONTRACT_SRC = read('src/shared/ipc-contract.ts');
const PRELOAD_SRC = read('src/preload/index.ts');
const PROCEDURE_ROOM_SRC = read('src/renderer/src/pages/ProcedureRoom.tsx');
const SETTINGS_CAPTURE_SRC = read('src/renderer/src/pages/SettingsCapture.tsx');
const PATIENTS_LIST_SRC = read('src/renderer/src/pages/PatientsList.tsx');
const USE_VIDEO_PREVIEW_SRC = read('src/renderer/src/hooks/useVideoPreview.ts');
const USE_CAPTURE_DEVICE_MAP_SRC = read('src/renderer/src/hooks/useCaptureDeviceMap.ts');
const CAPTURE_IPC_SRC = read('src/main/ipc/capture.ts');

function captureInterfaceBlock(src: string): string {
  // ponytail: pull the `capture: { … }` block out of IpcContract for shape inspection.
  const start = src.indexOf('capture: {');
  if (start < 0) throw new Error('capture: block missing from IpcContract');
  let depth = 0;
  let end = start;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return src.slice(start, end);
}

function captureMethodNames(contractBlock: string): string[] {
  return Array.from(contractBlock.matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*)\s*:/gm)).map((m) => m[1]!);
}

describe('IpcContract.capture shape matches preload bridge', () => {
  it('every method on IpcContract.capture is wired into window.api.capture', () => {
    const contractMethods = captureMethodNames(captureInterfaceBlock(IPC_CONTRACT_SRC));
    expect(contractMethods.length).toBeGreaterThan(0);
    // ponytail: simple substring check — we just need each name to appear
    // in the preload source. The preload's `capture:` block is small
    // enough to grep against the whole file without false positives.
    for (const name of contractMethods) {
      expect(PRELOAD_SRC).toContain(`${name}:`);
    }
  });

  it('every preload capture.* method calls ipcRenderer.invoke(IPC.CAPTURE_…)', () => {
    const contractMethods = captureMethodNames(captureInterfaceBlock(IPC_CONTRACT_SRC));
    expect(contractMethods.length).toBeGreaterThan(0);
    for (const name of contractMethods) {
      // Each preload entry of the form `name: …IPC.CAPTURE_X` must exist.
      const re = new RegExp(`${name}:[\\s\\S]{0,80}IPC\\.CAPTURE_`);
      expect(re.test(PRELOAD_SRC), `preload ${name} does not invoke IPC.CAPTURE_…`).toBe(true);
    }
  });
});

describe('BLOCKER 4 — payload shapes omit doctorId', () => {
  it('setPreset signature in IpcContract has no doctorId parameter or property', () => {
    const block = captureInterfaceBlock(IPC_CONTRACT_SRC);
    const match = block.match(/setPreset:\s*\(([^)]*)\)/);
    expect(match, 'setPreset signature missing').toBeTruthy();
    expect(match![1]).not.toMatch(/doctorId/);
  });

  it('setDefaultDevice signature in IpcContract has no doctorId parameter or property', () => {
    const block = captureInterfaceBlock(IPC_CONTRACT_SRC);
    const match = block.match(/setDefaultDevice:\s*\(([^)]*)\)/);
    expect(match, 'setDefaultDevice signature missing').toBeTruthy();
    expect(match![1]).not.toMatch(/doctorId/);
  });

  it('capturePresetInput zod schema definition does not include a doctorId field', () => {
    // ponytail: read the schema definition and assert the body string
    // between the opening and closing brace does not mention doctorId.
    const validators = read('src/shared/validators.ts');
    expect(validators).toMatch(/export const capturePresetInput\s*=/);
    // Slice from the schema to its closing `});` — same shape as the file.
    const idx = validators.indexOf('export const capturePresetInput');
    const tail = validators.slice(idx);
    // 400 chars is more than enough for a 3-field zod object literal.
    expect(tail.slice(0, 400)).not.toMatch(/doctorId/);
  });

  it('captureDeviceIdInput zod schema definition does not include a doctorId field', () => {
    const validators = read('src/shared/validators.ts');
    expect(validators).toMatch(/export const captureDeviceIdInput\s*=/);
    const idx = validators.indexOf('export const captureDeviceIdInput');
    const tail = validators.slice(idx);
    expect(tail.slice(0, 400)).not.toMatch(/doctorId/);
  });

  it('main capture IPC derives doctorId from requireSession(), not the payload', () => {
    // ponytail: assertion-by-grep is sufficient for a static-analysis
    // contract test. Both setPreset and setDefaultDevice must read the
    // doctorId via requireSession() AFTER zod-validating the payload.
    expect(CAPTURE_IPC_SRC).toMatch(/setPreset[\s\S]*?requireSession\(\)/);
    expect(CAPTURE_IPC_SRC).toMatch(/setDefaultDevice[\s\S]*?requireSession\(\)/);
    // The destructured payload for both handlers must NOT include `doctorId`.
    // Actual code: `const { deviceId, preset } = capturePresetInput.parse(input);`
    const setPresetDestructure = CAPTURE_IPC_SRC.match(/const\s*\{([^}]+)\}\s*=\s*capturePresetInput\.parse/);
    expect(setPresetDestructure, 'setPreset payload destructure missing').toBeTruthy();
    expect(setPresetDestructure![1]).not.toMatch(/doctorId/);
    const setDefaultDestructure = CAPTURE_IPC_SRC.match(/const\s*\{([^}]+)\}\s*=\s*captureDeviceIdInput\.parse/);
    expect(setDefaultDestructure, 'setDefaultDevice payload destructure missing').toBeTruthy();
    expect(setDefaultDestructure![1]).not.toMatch(/doctorId/);
  });
});

describe('D-01 — ProcedureRoom does NOT persist; SettingsCapture is the only caller of setDefaultDevice', () => {
  it('ProcedureRoom.tsx does NOT call window.api.capture.setDefaultDevice', () => {
    expect(PROCEDURE_ROOM_SRC).not.toMatch(/window\.api\.capture\.setDefaultDevice/);
    expect(PROCEDURE_ROOM_SRC).not.toMatch(/api\.capture\.setDefaultDevice/);
  });

  it('ProcedureRoom.tsx does NOT call window.api.capture.setPreset', () => {
    expect(PROCEDURE_ROOM_SRC).not.toMatch(/window\.api\.capture\.setPreset/);
    expect(PROCEDURE_ROOM_SRC).not.toMatch(/api\.capture\.setPreset/);
  });

  it('SettingsCapture.tsx is the only renderer caller of window.api.capture.setDefaultDevice (D-04, Q-C)', () => {
    expect(SETTINGS_CAPTURE_SRC).toMatch(/window\.api\.capture\.setDefaultDevice/);
    // No other renderer file calls setDefaultDevice.
    const rendererDir = path.join(ROOT, 'src/renderer/src');
    const files: string[] = [];
    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) files.push(p);
      }
    }
    walk(rendererDir);
    const callers = files.filter(
      (file) =>
        !file.endsWith(path.join('renderer', 'src', 'pages', 'SettingsCapture.tsx')) &&
        /window\.api\.capture\.setDefaultDevice/.test(fs.readFileSync(file, 'utf8')),
    );
    expect(callers, `unexpected callers: ${callers.join(', ')}`).toEqual([]);
  });
});

describe('Plan 03-04 — Patient List is the entry point for Settings → Capture (G-03-1 / G-03-2)', () => {
  it('PatientsList.tsx navigates to settings-capture so every doctor can reach the device picker', () => {
    // ponytail: a static-analysis contract — PatientsList must call
    // `navigate({ name: 'settings-capture' })` somewhere so the existing
    // SettingsCapture page is reachable from the Patient List header.
    // Single or double quotes both count; the literal is the only thing
    // that matters.
    expect(PATIENTS_LIST_SRC).toMatch(/navigate\(\s*\{\s*name:\s*['"]settings-capture['"]\s*\}/);
  });

  it('PatientsList.tsx still routes to settings-users for the admin settings path', () => {
    // ponytail: the fix must not drop admin access to Settings → Users.
    // Accepts either `navigate({ name: 'settings-users' })` or a direct
    // `setRoute({ name: 'settings-users' })` call — both keep the
    // destination alive in the source.
    expect(PATIENTS_LIST_SRC).toMatch(/['"]settings-users['"]/);
  });
});

describe('BLOCKER 1 — useCaptureDeviceMap is the single mediaDevices.enumerateDevices consumer', () => {
  it('useCaptureDeviceMap is the ONLY consumer of navigator.mediaDevices.enumerateDevices', () => {
    const rendererDir = path.join(ROOT, 'src/renderer/src');
    const files: string[] = [];
    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) files.push(p);
      }
    }
    walk(rendererDir);
    const consumers = files.filter((file) =>
      fs.readFileSync(file, 'utf8').includes('enumerateDevices'),
    );
    expect(consumers).toContain(path.join(rendererDir, 'hooks', 'useCaptureDeviceMap.ts'));
    expect(consumers.length).toBe(1);
  });

  it('useCaptureDeviceMap is consumed in BOTH ProcedureRoom and SettingsCapture', () => {
    expect(PROCEDURE_ROOM_SRC).toMatch(/useCaptureDeviceMap/);
    expect(SETTINGS_CAPTURE_SRC).toMatch(/useCaptureDeviceMap/);
  });

  it('useVideoPreview is the ONLY consumer of navigator.mediaDevices.getUserMedia', () => {
    const rendererDir = path.join(ROOT, 'src/renderer/src');
    const files: string[] = [];
    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) files.push(p);
      }
    }
    walk(rendererDir);
    const consumers = files.filter((file) =>
      fs.readFileSync(file, 'utf8').includes('getUserMedia'),
    );
    expect(consumers).toContain(path.join(rendererDir, 'hooks', 'useVideoPreview.ts'));
    expect(consumers.length).toBe(1);
  });
});

describe('Phase 3 scope guards — no recording primitives leak in', () => {
  // D-08, D-10, D-11; BLOCKER 1, 3, 4, 5; Q-A.
  const phase3SrcFiles: string[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (
        entry.isFile() &&
        /\.(tsx?|jsx?)$/.test(entry.name) &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.test.tsx')
      ) {
        phase3SrcFiles.push(p);
      }
    }
  }
  walk(path.join(ROOT, 'src'));

  // Scope-guard tokens — none of these may appear in Phase 3 source.
  const forbidden = [
    { token: 'MediaRecorder', why: 'D-08 — recording is Phase 4' },
    { token: "'capture:start'", why: 'D-10 — recording IPC is Phase 4' },
    { token: "'capture:stop'", why: 'D-10 — recording IPC is Phase 4' },
    { token: "'capture:record'", why: 'D-10 — recording IPC is Phase 4' },
    { token: 'capture:start', why: 'D-10 — recording IPC is Phase 4' },
    { token: 'capture:stop', why: 'D-10 — recording IPC is Phase 4' },
  ];

  for (const { token, why } of forbidden) {
    it(`Phase 3 source does NOT contain "${token}" (${why})`, () => {
      for (const file of phase3SrcFiles) {
        const src = fs.readFileSync(file, 'utf8');
        expect(src, `${path.relative(ROOT, file)} contains forbidden token "${token}"`).not.toContain(token);
      }
    });
  }

  it('Phase 3 source contains no .mp4 output paths (recording is Phase 4)', () => {
    for (const file of phase3SrcFiles) {
      const src = fs.readFileSync(file, 'utf8');
      // Match strings like '.mp4' or '.mp4"' or `'.mp4'` (the recording output extension).
      expect(src, `${path.relative(ROOT, file)} references .mp4 output path`).not.toMatch(/['"`]\.mp4['"`]/);
    }
  });

  it('Phase 3 source contains no ffmpeg recording args (`-i video=`, `libx264`, `-crf`)', () => {
    for (const file of phase3SrcFiles) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src, `${path.relative(ROOT, file)} leaks a recording argument`).not.toMatch(/libx264/);
      expect(src, `${path.relative(ROOT, file)} leaks a recording argument`).not.toMatch(/-crf\s+\d+/);
    }
  });

  it('main capture IPC does not spawn a recording child process (`-i video=`)', () => {
    // ponytail: the ONLY ffmpeg spawn in Phase 3 is the enumeration call
    // (`-list_devices true -f dshow -i dummy`). A `-i video=` argument
    // would be a Phase 4 recording invocation.
    expect(CAPTURE_IPC_SRC).not.toMatch(/-i\s+video=/);
  });
});