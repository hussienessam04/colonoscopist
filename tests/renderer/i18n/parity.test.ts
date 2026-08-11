// @vitest-environment node
// Phase 7 / Plan 07-04 — I18N-01 + D-24 parity check.
//
// Per D-24 verbatim: every English key in
// src/renderer/src/i18n/en/translation.json MUST have a matching key
// in src/renderer/src/i18n/ar/translation.json. The test walks the EN
// bundle (recursive dotted-path flattening) and asserts the same key
// exists in the AR bundle. Missing or empty AR values fail the build.
//
// This is the half-translated drift guard — without it, a new
// translation key added to en/translation.json but forgotten in
// ar/translation.json would ship a UI that falls back to EN for that
// key (silent bug, no TypeScript signal). The parity test is a hard
// CI gate so the bug class is impossible to land.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type JsonObject = { [key: string]: JsonValue };
type JsonValue = string | JsonObject | JsonValue[];

function flatten(obj: JsonObject, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix === '' ? k : `${prefix}.${k}`;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flatten(v as JsonObject, next));
    } else {
      keys.push(next);
    }
  }
  return keys;
}

function loadBundle(relPath: string): JsonObject {
  const abs = resolve(__dirname, '..', '..', '..', 'src', 'renderer', 'src', 'i18n', relPath);
  // ponytail: readFileSync + JSON.parse is the standard node idiom. No
  // FS mocking — the test resolves the path relative to this file so
  // it works in CI without extra config.
  const raw = readFileSync(abs, 'utf8');
  return JSON.parse(raw) as JsonObject;
}

describe('i18n parity check (D-24)', () => {
  const en = loadBundle('en/translation.json');
  const ar = loadBundle('ar/translation.json');

  const enKeys = flatten(en).sort();
  const arKeys = flatten(ar).sort();

  it('EN bundle has at least one key (sanity)', () => {
    expect(enKeys.length).toBeGreaterThan(0);
  });

  it('AR bundle has at least one key (sanity)', () => {
    expect(arKeys.length).toBeGreaterThan(0);
  });

  it('every EN key has a matching AR key', () => {
    const missing = enKeys.filter((k) => !arKeys.includes(k));
    // ponytail: the parity check is the ship-gate. Any missing key
    // is a regression — surface the full list in the failure message
    // so the engineer can fix every key in one edit.
    expect(missing, `Missing AR keys: ${missing.join(', ')}`).toEqual([]);
  });

  it('every AR key has a matching EN key (no orphaned AR keys)', () => {
    // ponytail: the reverse direction catches "added AR but forgot
    // EN" — symmetric with the forward check. Orphans are usually
    // typos but they break symmetry and indicate a stale key.
    const orphan = arKeys.filter((k) => !enKeys.includes(k));
    expect(orphan, `Orphaned AR keys (no EN counterpart): ${orphan.join(', ')}`).toEqual([]);
  });

  it('every AR leaf value is a non-empty string (no blanks)', () => {
    const blanks: string[] = [];
    const walk = (obj: JsonObject, prefix = ''): void => {
      for (const [k, v] of Object.entries(obj)) {
        const next = prefix === '' ? k : `${prefix}.${k}`;
        if (typeof v === 'string') {
          if (v.trim() === '') blanks.push(next);
        } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          walk(v as JsonObject, next);
        }
      }
    };
    walk(ar);
    expect(blanks, `Empty AR values: ${blanks.join(', ')}`).toEqual([]);
  });
});
