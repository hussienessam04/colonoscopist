---
status: diagnosed
trigger: "Phase 5 UAT gap — Trim fails with 'Source video missing at data/media/patients/<id>/<id>/video.mp4' after a 30s recording + Stop"
created: 2026-08-07T00:00:00Z
updated: 2026-08-07T00:00:00Z
root_cause: |
  Path-shape mismatch between the recorder (Phase 4) and the trim resolver (Phase 5)
  on the `procedures.video_path` column.

  - Recorder (Phase 4, src/main/recorder/recorder.ts:1255-1258 + :248 + :893):
    `relativeVideoPath(patientId, procedureId)` returns the FULL userData-relative
    path `data/media/patients/<patientId>/<procedureId>/video.mp4`. The recorder
    stores THIS in `procedures.video_path` (on insert and on finalize).

  - Resolver (Phase 5, src/main/paths.ts:47-52 + src/main/recorder/trim.ts:75):
    `videoFilePath(patientId, procedureId, videoRel)` does
    `path.join(procedureMediaDir(patientId, procedureId), videoRel)` where
    `procedureMediaDir` is already `<userData>/data/media/patients/<patientId>/<procedureId>`.
    The resolver expects `videoRel` to be a FILENAME within that directory.

  Combining the two: `inputAbs` becomes
  `<userData>/data/media/patients/<patientId>/<procedureId>/data/media/patients/<patientId>/<procedureId>/video.mp4`
  — a doubled path that does not exist on disk. `existsSync` returns false → IPC_NOT_FOUND.

  The toast prints the RAW stored value `procedure.videoPath`
  (src/main/recorder/trim.ts:80), not the resolved `inputAbs`, which is why
  the user sees `data/media/patients/<id>/<id>/video.mp4` (single, no
  doubling) in the toast — that string is the stored column value, not the
  path that was actually stat'd.

  Why the existing test passes: tests/main/recorder/trim.test.ts:75 inserts
  the fixture row with `videoPath: 'video.mp4'` (just a filename) — the
  shape the resolver expects. The test fixture mp4 is written to
  `<tmpDir>/data/media/patients/<patientId>/<procedureId>/video.mp4`, which
  the resolver correctly finds. The test exercises the resolver's expected
  shape but the production recorder writes a DIFFERENT shape, so the test
  does not guard against this mismatch.

  Why the recording visually works: the MediaServer /media/ route
  (src/main/recorder/preview-server.ts:445-453) rebuilds paths from
  `<patientId>/<procedureId>/<file>` URL components — it never reads
  `procedures.video_path`, so the doubled-path bug is invisible to playback.
  Only code paths that resolve `video_path` through `videoFilePath` break —
  that's `trim.ts` (this symptom) and `proceduresRepo.restoreFromOriginal`
  (src/main/db/procedures-repo.ts:293, which would fail after a hypothetical
  successful trim because the row's `video_path_original` is the doubled
  path too).

  Triggering call: applyTrim → videoFilePath(patientId, procedureId,
  procedure.videoPath) → existsSync(inputAbs) → false → throw IPC_NOT_FOUND
  "Source video missing at <procedure.videoPath>".
---

## Symptoms

expected: ffmpeg subprocess runs against the canonical mp4 → produces
`<procedureId>-trimmed.mp4` → procedure row updates → toast "Trim applied"
→ `<video>` reloads to trimmed clip.
actual: Error toast
"Trim failed: Error invoking remote method 'procedures:trim': Error: Source
video missing at data/media/patients/88147c14-658c-440a-badf-e0707f52acb7/
116315a0-355f-4f7f-8c88-75ed80510524/video.mp4". No trimmed file written.
`procedures.video_path` unchanged.
errors: `IPC_NOT_FOUND: Source video missing at data/media/patients/<patientId>/<procedureId>/video.mp4`
reproduction: Record 30s without Pause/Resume → Stop → Procedure Review →
Trim → drag in-handle 5s, out-handle 25s → Apply. Always reproduces on
this path.
started: Phase 5 UAT (gap entry).

## Evidence

- timestamp: 2026-08-07T00:00:00Z
  checked: src/main/recorder/recorder.ts::relativeVideoPath (line 1255-1258)
  found: `return \`data/media/patients/${patientId}/${procedureId}/video.mp4\`;`
        — FULL userData-relative path, not just a filename.
  implication: Every recorder INSERT/UPDATE (lines 248, 353, 893, 1012, 1127)
        writes the FULL userData-relative path into `procedures.video_path`.

- timestamp: 2026-08-07T00:00:00Z
  checked: src/main/recorder/recorder.ts::start() line 248 and onExit() line 893
  found: `videoPath: this.outputRelPath` where `this.outputRelPath =
        relativeVideoPath(...)` = `data/media/patients/<id>/<id>/video.mp4`.
  implication: Production DB rows carry the FULL userData-relative path.

- timestamp: 2026-08-07T00:00:00Z
  checked: src/main/paths.ts::videoFilePath (line 47-52)
  found: `return path.join(procedureMediaDir(patientId, procedureId), videoRel);`
        where `procedureMediaDir` returns `<userData>/data/media/patients/<id>/<id>`
        (paths.ts:27-31, via `mediaDir()` + 'patients' + patientId + procedureId).
  implication: Resolver assumes `videoRel` is a FILENAME within the procedure
        directory. If the caller passes the FULL userData-relative path, the
        result is a doubled path that doesn't exist on disk.

- timestamp: 2026-08-07T00:00:00Z
  checked: src/main/recorder/trim.ts:75-83
  found: `inputAbs = videoFilePath(patientId, procedureId, procedure.videoPath)`;
        existsSync fails; toast at line 80 prints `procedure.videoPath` (the
        raw stored value), NOT `inputAbs`.
  implication: User sees the stored value (single path) in the toast, but
        the actual stat was against the doubled path. Matches the UAT toast
        exactly.

- timestamp: 2026-08-07T00:00:00Z
  checked: tests/main/recorder/trim.test.ts::bootstrap (line 56-102)
  found: bootstrap inserts with `videoPath: 'video.mp4'` (just filename, line 75);
        test fixture mp4 written to `<tmpDir>/data/media/patients/<patientId>/<procedureId>/video.mp4`
        (line 90-100); resolver `path.join(.../patients/<patientId>/<procedureId>, 'video.mp4')`
        correctly finds the fixture.
  implication: Test exercises the resolver's EXPECTED shape (just filename)
        but production writes the FULL userData-relative shape. The test
        does not catch the production-vs-test contract drift on the
        `video_path` column.

- timestamp: 2026-08-07T00:00:00Z
  checked: src/main/recorder/preview-server.ts::onHttpRequest (line 444-453)
  found: `path.join(userDataRoot, 'data', 'media', 'patients', patientId,
        procedureId, file)` — MediaServer rebuilds paths from URL components,
        never reads `procedures.video_path`.
  implication: Playback works because MediaServer is independent of the
        stored column. Only paths that pass through `videoFilePath` (trim
        IPC, restore IPC) fail.

- timestamp: 2026-08-07T00:00:00Z
  checked: src/main/db/procedures-repo.ts::restoreFromOriginal (line 283-305)
  found: Same `videoFilePath(row.patient_id, id, row.video_path_original)` call
        would fail after a hypothetical successful trim because
        `video_path_original` is populated with the stored (doubled-shape)
        value too.
  implication: Restore IPC is the second latent failure point of the same
        root cause — it would only manifest after a trim succeeds, which it
        never does because trim is the broken entry point.

## Eliminated

- hypothesis: Recorder failed to write the canonical mp4 (segment file
  left on disk; rename/concat never ran).
  evidence: Recorder writes `<mediaDir>/video-seg0.mp4` (recorder.ts:236)
        and renames it to `<mediaDir>/video.mp4` on never-paused stop
        (recorder.ts:967-980). The user confirmed they recorded 30s without
        Pause/Resume, so `closedSegments.length === 0` and the rename path
        runs. The canonical mp4 IS on disk at the correct absolute path;
        the bug is that the DB stores a DIFFERENT (full-relative) path that
        the resolver then re-prefixes.
  timestamp: 2026-08-07T00:00:00Z

- hypothesis: Recorder finalized as 'partial' (Windows fsync EPERM, per
  Phase 4's fix entry), leaving the row at the segment path instead of
  video.mp4.
  evidence: Phase 4 fix (`phase-4-fsync-windows-eperm.md`) differentiates
        ENOENT (partial) from EPERM (warned). The user's repro shows the
        Procedure Review screen, not the partial-finalize screen — so the
        recording completed normally and the row is at status='completed'.
        Even if status were 'partial', `applyTrim` line 61-68 throws
        IPC_VALIDATION ("Cannot trim a partial recording") with a
        different message; the UAT toast is IPC_NOT_FOUND.
  timestamp: 2026-08-07T00:00:00Z

- hypothesis: `applyTrim` resolves `procedure.videoPath` against `cwd`
  instead of `app.getPath('userData')`.
  evidence: `videoFilePath` (paths.ts:47-52) uses
        `procedureMediaDir(...)` which uses `app.getPath('userData')`
        (paths.ts:9-12, 18-22). No `cwd` involvement. The bug is that the
        stored value is being prefixed TWICE by the userData root — once by
        `procedureMediaDir` and once again because the stored value
        already starts with `data/media/patients/...`.
  timestamp: 2026-08-07T00:00:00Z

## Resolution

root_cause: |
  Path-shape contract drift between Phase 4 recorder (which stores the
  FULL userData-relative path `data/media/patients/<patientId>/<procedureId>/video.mp4`
  in `procedures.video_path`) and Phase 5 trim resolver
  (which expects the resolver `videoFilePath(patientId, procedureId, videoRel)`
  to receive just a FILENAME within the procedure directory, per
  paths.ts:47-52 and the trim.test.ts:75 fixture). The result is a
  doubled absolute path under userData, fails `existsSync`, and the
  IPC throws IPC_NOT_FOUND before ffmpeg is ever spawned.

fix: |
  Pick one shape and apply it everywhere. Two clean options:
  (a) Make the resolver strip a leading `data/media/patients/...` prefix
      before joining (defensive against either shape), OR
  (b) Change the recorder to store JUST the filename
      (`video.mp4` / `video-<id>-trimmed.mp4`), update
      `relativeVideoPath` to return `video.mp4`, and tighten the test
      fixture (already at the right shape). Update any other reader
      (orphans.ts, trim.ts return value, restoreFromOriginal) accordingly
      so the column shape stays consistent across the recorder's
      INSERTs/UPDATEs.
  Either way: extend the trim test's bootstrap to also exercise the
  full-relative path so the contract drift is guarded by CI.
verification: |
  Not run (find_root_cause_only mode). After fix, expected:
  - bootstrap inserts with the recorder's actual shape; trim succeeds
  - existsSync passes; ffmpeg subprocess spawns; -trimmed sibling written;
    `procedures.video_path` updates to the trimmed sibling; restore
    round-trips cleanly
files_changed: []