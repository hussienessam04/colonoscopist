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
const SETTINGS_HUB_SRC = read('src/renderer/src/pages/SettingsHub.tsx');
const SETTINGS_USERS_SRC = read('src/renderer/src/pages/SettingsUsers.tsx');
const SETTINGS_SIDEBAR_SRC = read('src/renderer/src/components/SettingsSidebar.tsx');
const PATIENTS_LIST_SRC = read('src/renderer/src/pages/PatientsList.tsx');
const PATIENT_ROW_SRC = read('src/renderer/src/components/PatientRow.tsx');
const APP_SRC = read('src/renderer/src/App.tsx');
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

describe('Plan 03-04 — Patient List is the entry point for Settings → Capture (G-03-1 / G-03-2) — superseded by 03-05 hub', () => {
  // ponytail: Plan 03-05 (G-03-3) replaced the PatientsList DropdownMenu
  // with a single Button that opens the SettingsHub page. The Capture and
  // Users destinations are now navigated to from SettingsHub's sidebar
  // (asserted in the 03-05 block below), so the prior 03-04 positive
  // assertions (`navigate({ name: 'settings-capture' })` and
  // `'settings-users'` literal in PatientsList) are no longer the right
  // contract. We keep the describe block as a marker; the new contract
  // lives in the 03-05 block.
  it('PatientsList.tsx no longer navigates directly to settings-capture or settings-users (the hub is the new entry)', () => {
    expect(PATIENTS_LIST_SRC).not.toMatch(/navigate\(\s*\{\s*name:\s*['"]settings-capture['"]\s*\}/);
    expect(PATIENTS_LIST_SRC).not.toMatch(/navigate\(\s*\{\s*name:\s*['"]settings-users['"]\s*\}/);
  });
});

describe('Plan 03-05 — Settings hub page (G-03-3)', () => {
  it('PatientsList header Settings affordance navigates to settings-hub (not a transient menu)', () => {
    // ponytail: the new entry surface is a single Button that lands on the
    // SettingsHub page. The literal `navigate({ name: 'settings-hub' })`
    // is the new entry; the absence of a DropdownMenu wrapper is asserted
    // by checking PatientsList no longer imports or instantiates one.
    expect(PATIENTS_LIST_SRC).toMatch(/navigate\(\s*\{\s*name:\s*['"]settings-hub['"]\s*\}/);
    // No transient menu wrapper for the Settings affordance.
    expect(PATIENTS_LIST_SRC).not.toMatch(/DropdownMenuTrigger/);
    expect(PATIENTS_LIST_SRC).not.toMatch(/DropdownMenuContent/);
  });

  it('SettingsSidebar (the shared sidebar) contains a navigation call to settings-users (admin-gated)', () => {
    // Per Plan 03-06 (G-03-6): the Users sidebar entry moved out of
    // SettingsHub and into the shared SettingsSidebar component, so the
    // literal `navigate({ name: 'settings-users' })` now lives there.
    // SettingsHub just mounts the sidebar with no activeTab.
    expect(SETTINGS_SIDEBAR_SRC).toMatch(/navigate\(\s*\{\s*name:\s*['"]settings-users['"]\s*\}/);
  });

  it('SettingsSidebar (the shared sidebar) contains a navigation call to settings-capture (every doctor)', () => {
    // Per Plan 03-06 (G-03-6): the Capture sidebar entry also moved into
    // the shared SettingsSidebar component so every Settings page (Hub,
    // Capture, Users) inherits the same navigation surface.
    expect(SETTINGS_SIDEBAR_SRC).toMatch(/navigate\(\s*\{\s*name:\s*['"]settings-capture['"]\s*\}/);
  });

  it('SettingsSidebar imports useSession and gates Users on isFirstAdmin', () => {
    // T-3-16 — admin gate binds the Users button to currentUser.isFirstAdmin.
    // Per Plan 03-06 the gate moved with the Users button into the
    // shared SettingsSidebar component, so the literal lives there.
    expect(SETTINGS_SIDEBAR_SRC).toMatch(/useSession/);
    expect(SETTINGS_SIDEBAR_SRC).toMatch(/isFirstAdmin/);
  });

  it('App.tsx renders the settings-hub case', () => {
    // The router shell must dispatch the new route to <SettingsHub />.
    expect(APP_SRC).toMatch(/case\s+['"]settings-hub['"]/);
    expect(APP_SRC).toMatch(/SettingsHub/);
  });
});

describe('Plan 03-05 — PatientRow Open Procedure Room entry (G-03-4)', () => {
  it('PatientRow.tsx navigates to procedure-room with the patientId for non-deleted patients', () => {
    // ponytail: the typed literal `navigate({ name: 'procedure-room', patientId: ... })`
    // is the single source of truth for the new row action. T-3-18.
    expect(PATIENT_ROW_SRC).toMatch(
      /navigate\(\s*\{\s*name:\s*['"]procedure-room['"]\s*,\s*patientId\s*:\s*patient\.id\s*\}\s*\)/,
    );
  });

  it('App.tsx no longer renders the Phase 1 patient-detail placeholder case (T-3-19)', () => {
    // The placeholder case was a Phase 1 stub ("Patient detail (Phase 4) — id: ...").
    // Removing it closes the dead UI surface; the route variant stays in
    // the Route union for backward-compat with persisted deep-links.
    expect(APP_SRC).not.toMatch(/case\s+['"]patient-detail['"]/);
    expect(APP_SRC).not.toMatch(/Patient detail \(Phase 4\)/);
  });
});

describe('G-03-5 — useVideoPreview guards malformed custom preset', () => {
  // ponytail: defensive guard for corrupt custom presets returned from
  // presetRepo. The TS contract says `resolution: string` for `{ preset:
  // 'custom' }` but a corrupt JSON row can carry `""` or `undefined`. The
  // hook must return `{ framerate }` instead of throwing on the `.split`
  // call. The static-analysis contract pins the guard by reading the
  // source between `preset.resolution` and `.split(/[x×]/)` and asserting
  // that a `?.trim()` guard + a falsy short-circuit return are present.
  it('useVideoPreview.ts defensive guard wraps the .split(/[x×]/) call', () => {
    expect(
      /preset\.resolution[\s\S]{0,80}\?\.trim\([\s\S]{0,200}return\s*\{\s*framerate\s*:\s*preset\.framerate\s*\}/.test(
        USE_VIDEO_PREVIEW_SRC,
      ),
      'useVideoPreview.ts presetHints() must guard empty/missing custom resolution before .split',
    ).toBe(true);
  });

  it('useVideoPreview.ts still parses resolution with the .split(/[x×]/) literal (no regression)', () => {
    // ponytail: the literal `/\[[x×]\]/` character class must remain in
    // the source after the defensive guard is added — split on the literal
    // 'x' OR the multiplication sign '×'. Use a plain string contains
    // check rather than a regex literal so the multiplication sign is not
    // lost in regex-string round-tripping by the test renderer.
    expect(USE_VIDEO_PREVIEW_SRC).toContain('.split(/[x×]/)');
  });
});

describe('G-03-6 — SettingsSidebar is mounted on every Settings page', () => {
  // ponytail: the shared SettingsSidebar component is the ONLY sidebar on
  // all three Settings pages. The static-analysis contract pins (a) the
  // exported function, (b) the data-active attribute that drives the
  // active-tab highlight, and (c) the per-page import + render site so a
  // future refactor cannot silently drop the sidebar from any of the
  // three pages.
  it('SettingsSidebar exports the SettingsSidebar function', () => {
    expect(SETTINGS_SIDEBAR_SRC.length).toBeGreaterThan(0);
    expect(SETTINGS_SIDEBAR_SRC).toMatch(/export\s+function\s+SettingsSidebar/);
  });

  it('SettingsSidebar carries the data-active attribute contract', () => {
    // The data-active attribute is how the active-tab highlight is
    // asserted in tests AND how any future CSS hook can target the
    // active row. The literal must appear on both buttons.
    expect(SETTINGS_SIDEBAR_SRC).toContain('data-active');
  });

  it('SettingsHub imports and renders <SettingsSidebar />', () => {
    expect(SETTINGS_HUB_SRC).toMatch(/import\s+\{[^}]*SettingsSidebar[^}]*\}\s+from\s+['"]@\/components\/SettingsSidebar['"]/);
    expect(SETTINGS_HUB_SRC).toMatch(/<SettingsSidebar\b/);
  });

  it('SettingsCapture imports and renders <SettingsSidebar activeTab="capture" />', () => {
    expect(SETTINGS_CAPTURE_SRC).toMatch(
      /import\s+\{[^}]*SettingsSidebar[^}]*\}\s+from\s+['"]@\/components\/SettingsSidebar['"]/,
    );
    expect(SETTINGS_CAPTURE_SRC).toMatch(/<SettingsSidebar[^>]*activeTab\s*=\s*['"]capture['"]/);
  });

  it('SettingsUsers imports and renders <SettingsSidebar activeTab="users" />', () => {
    expect(SETTINGS_USERS_SRC).toMatch(
      /import\s+\{[^}]*SettingsSidebar[^}]*\}\s+from\s+['"]@\/components\/SettingsSidebar['"]/,
    );
    expect(SETTINGS_USERS_SRC).toMatch(/<SettingsSidebar[^>]*activeTab\s*=\s*['"]users['"]/);
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