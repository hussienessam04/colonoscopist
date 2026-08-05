// Device-lost detection + partial-mp4 helpers (per D-03 + PITFALLS §2 + RESEARCH §3).
//
// The regex matches the six substrings ffmpeg emits when a USB capture card
// disconnects mid-recording. We test every stderr chunk against this regex;
// on a match while state === 'recording' the supervisor transitions to the
// device-lost branch (rename to .partial.mp4 + sidecar JSON + audit + 'lost'
// status emit).
//
// ponytail: case-insensitive flag covers BOTH the EasyCap's `I/O error` and
// the HDMI capture card's `DeviceLost` plus the defensive ones from
// RESEARCH §3 (`Immediate exit requested`, `av_interleaved_write_frame`).

export const DEVICE_LOST_RE = /(I\/O error|device disconnected|DeviceLost|EOF on input|Immediate exit requested|av_interleaved_write_frame)/i;

// ponytail: defensive cap so the banner copy never claims "recording preserved
// up to 7 hours" on a runaway file. 30 minutes is comfortably above the
// expected pathology-window without advertising unrealistic coverage.
export const MAX_LAST_KNOWN_MS = 30 * 60 * 1000;

export type WritePartialJsonInput = {
  procedureId: string;
  lastKnownTimestampMs: number;
  deviceLostAt: number;
  deviceName: string;
};

// Convert bitrate string (e.g. '4M', '10M', '500K', '1500') to bps.
// Default suffix is '' (no multiplier) — `'1500'` => 1500 bps.
function parseBitrate(bitrate: string): number {
  const match = bitrate.match(/^(\d+)([KM]?)$/i);
  if (!match) {
    throw new Error(`Invalid bitrate string: ${bitrate}`);
  }
  const value = parseInt(match[1]!, 10);
  const suffix = match[2]!.toUpperCase();
  if (suffix === 'M') return value * 1_000_000;
  if (suffix === 'K') return value * 1_000;
  return value;
}

// ponytail: pure helper — no I/O. Convert the segment file's byte size to
// milliseconds via the per-preset bitrate. Cap at MAX_LAST_KNOWN_MS.
export function parseLastKnownTimestampMs(statSizeBytes: number, bitrate: string): number {
  if (statSizeBytes <= 0) {
    throw new Error('empty statSizeBytes');
  }
  if (!bitrate || bitrate.length === 0) {
    throw new Error('empty bitrate');
  }
  const bps = parseBitrate(bitrate);
  if (bps <= 0) {
    throw new Error('empty bitrate');
  }
  const ms = (8 * 1000 * statSizeBytes) / bps;
  return Math.min(ms, MAX_LAST_KNOWN_MS);
}

// ponytail: JSON sidecar writer. Pretty-printed for human debugging. Throws on
// empty procedureId (defensive — never empty in practice, but the supervisor
// could pass through a torn down state and we want a clean error, not a
// silently malformed JSON file). Uses procFs so tests can spy without
// touching real disk.
export function writePartialJson(
  partialJsonPath: string,
  payload: WritePartialJsonInput,
  deps: { procFs: { writeFileSync: (p: string, c: string) => void } },
): void {
  if (!payload.procedureId || payload.procedureId.length === 0) {
    throw new Error('empty procedureId');
  }
  deps.procFs.writeFileSync(partialJsonPath, JSON.stringify(payload, null, 2));
}

export type RewritePartialResult = {
  partialPath: string;
  partialJsonPath: string;
};

export type RewritePartialDeps = {
  procFs: {
    renameSync: (a: string, b: string) => void;
    existsSync: (p: string) => boolean;
    writeFileSync: (p: string, c: string) => void;
  };
};

// ponytail: rename the just-closed segment file to .partial.mp4 and write the
// sidecar JSON next to it. The .partial suffix is the canonical Phase 4 +
// Phase 5 + Phase 7 contract — do not change the suffix scheme without
// updating all three phases.
export function rewritePartial(
  segmentAbsPath: string,
  partialBasename: string,
  payload: WritePartialJsonInput,
  deps: RewritePartialDeps,
): RewritePartialResult {
  if (!deps.procFs.existsSync(segmentAbsPath)) {
    throw new Error(`EmptyPartialFile: source not found at ${segmentAbsPath}`);
  }
  const partialPath = `${segmentAbsPath}.partial.mp4`;
  const partialJsonPath = `${segmentAbsPath}.partial.mp4.json`;
  void partialBasename; // basename is the caller's contract; we compute from segment path
  deps.procFs.renameSync(segmentAbsPath, partialPath);
  writePartialJson(partialJsonPath, payload, deps);
  return { partialPath, partialJsonPath };
}