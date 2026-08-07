---
status: diagnosed
trigger: |
  Phase 5 UAT gap — Trim "Apply" toast after 30s recording + Stop:
  "Trim failed: ... ffmpeg trim failed (code=4294967283, signal=none):
   [in#0 @ 0000021c774dc480] Error opening input: Permission denied
   | Error opening input file C:\Users\Hussien. | Error opening input files: Permission denied"

  Path-shape fix (G-05-5) landed in plan 05-06 — ffmpeg now finds the file
  (existsSync passes), but cannot OPEN it. Error path is truncated at the
  space in "Hussien Essam".
created: 2026-08-07T00:00:00Z
updated: 2026-08-07T00:00:00Z
root_cause: |
  `src/main/recorder/trim.ts:137-140` sets `windowsVerbatimArguments: true` on the
  spawn. With that flag, Node.js passes the argv array as a single space-joined
  string with NO quoting/escaping. ffmpeg's option parser splits on whitespace,
  so the input path `C:\Users\Hussien Essam\AppData\Roaming\colonoscopist\data\media\patients\<id>\<id>\video.mp4`
  is truncated at the first space and arrives at ffmpeg as just
  `C:\Users\Hussien` (the user's HOME DIRECTORY, not a file). ffmpeg calls
  libavformat's file-open on a directory; Windows returns ERROR_ACCESS_DENIED
  (5), which libavutil surfaces as EACCES → "Permission denied".

  Smoking-gun reproduction (run from a Windows shell on this workstation):

    // helper.js writes:  process.stderr.write("CMDLINE:" + JSON.stringify(process.argv));
    spawnSync('node', ['<tmpdir>\\helper.js', 'C:\\Users\\Hussien Essam\\...\\file.mp4'])
      // child argv: ["...\\node.exe", "...\\helper.js", "C:\\Users\\Hussien Essam\\...\\file.mp4"]   ← full path
    spawnSync('node', ['<tmpdir>\\helper.js', 'C:\\Users\\Hussien Essam\\...\\file.mp4'],
              { windowsVerbatimArguments: true })
      // child argv: ["...\\node.exe", "...\\helper.js", "C:\\Users\\Hussien"]   ← TRUNCATED at first space
      // node then errors: Error: Cannot find module 'C:\Users\Hussien'

  Inconsistency with the other two ffmpeg spawns in the codebase:
    - src/main/recorder/recorder.ts:290-292  (recording) — no windowsVerbatimArguments
    - src/main/recorder/recorder.ts:1045-1047 (concat)  — no windowsVerbatimArguments
    - src/main/recorder/trim.ts:137-140     (trim)     — windowsVerbatimArguments: true  ← OUTLIER, BUG

  PITFALLS §10 cites `windowsVerbatimArguments: true` for DEVICE names
  (the `video="<name>"` form). ffmpeg-args.ts:51 wraps the device name
  in literal quotes, so the verbatim flag never affected the device-name
  arg. The flag's only impact is on the OUTPUT path arg (`-y <path>`)
  and INPUT path arg (`-i <path>`) — both of which are bare, unquoted
  strings that contain the userData path. ANY username containing a
  space (e.g. "Hussien Essam") reproduces this 100% of the time.

  Trim.ts's source comment (lines 1-9) claims the flag "mirrors
  Phase 4 concat.ts", but concat's actual spawn at recorder.ts:1045
  does NOT use the flag. Stale comment.

  Why the previous trim-source-missing bug (G-05-5) hid this:
  - The path-shape mismatch made existsSync fail BEFORE the spawn.
  - Fixing the path shape made existsSync pass, exposing the second
    (quoting) bug that was always present in trim.ts.

  Why ffmpeg says "Permission denied" and not "No such file":
  Windows' `CreateFileW` on a directory path with default flags returns
  ERROR_ACCESS_DENIED (5) — same code it would return for a file the
  caller can't read. libavutil maps this to EACCES, which ffmpeg's
  file.c demuxer renders as "Permission denied". The user's home
  directory `C:\Users\Hussien` IS accessible to the user (it's their
  own home folder), but opening it AS A FILE returns EACCES on
  Windows because the FILE_FLAG_BACKUP_SEMANTICS flag (needed to
  open a directory as a directory) was not set. This is a
  Windows-specific quirk; on POSIX the same call returns EISDIR.

  Why the recording still works:
  recorder.ts:290 spawns the recording ffmpeg WITHOUT
  `windowsVerbatimArguments: true`. Node's default Windows command-
  line construction properly quotes the output path with embedded
  spaces, so the recording writes the mp4 successfully even when
  the username contains a space. Only the trim subprocess hits
  the bug because only it has the flag set.

  Why the existing test suite doesn't catch this:
  - tests/main/recorder/trim.test.ts MOCKS `node:child_process.spawn`
    (line 33-36). The fake spawn returns a child that exits 0 on
    the next tick without ever invoking ffmpeg. The wrong spawn
    options are never exercised.
  - The unit test's tmp dir comes from `mkdtempSync(tmpdir(), ...)`
    (line 43). On a typical CI runner (`runner`, `Administrator`,
    `ci-user`) the path has no spaces. The user's own machine
    happens to be `Hussien Essam` — a space-containing username
    that the test never sees.
  - The integration smoke test (`tests/integration/trim-smoke.test.ts`)
    spawns ffmpeg DIRECTLY (not through applyTrim) with no
    `windowsVerbatimArguments: true`, so the bug is never
    reproduced even when RUN_SMOKE=1.
  - No test asserts that the spawn options include (or exclude)
    `windowsVerbatimArguments: true`. The contract is implicit.
---

## Symptoms

expected: ffmpeg opens the canonical mp4, runs `-c copy` with in/out
points, writes `<procedureId>-trimmed.mp4` sibling, `procedures.video_path`
updates, toast "Trim applied".
actual: Error toast
"Trim failed: Error invoking remote method 'procedures:trim': Error:
ffmpeg trim failed (code=4294967283, signal=none): [in#0 @ 0000021c774dc480]
Error opening input: Permission denied | Error opening input file
C:\Users\Hussien. | Error opening input files: Permission denied".

Note: error path ends at "C:\Users\Hussien." — TRUNCATED at the space
in the user's account folder. ffmpeg sees `C:\Users\Hussien` (a directory)
as the input path, Windows returns EACCES, ffmpeg reports "Permission
denied". The path-shape fix from G-05-5 made existsSync pass; this
second bug was hidden behind the first.

errors: ffmpeg exit code 4294967283 (= -13 signed). ffmpeg's [in#0]
context can't open the input. trim.ts:188-190 surfaces the last 3 lines
of ffmpeg's stderr in the toast.
reproduction: 100% on this user's machine where the Windows account
folder is `C:\Users\Hussien Essam\`. Record 30s without Pause/Resume →
Stop → Procedure Review → Trim → drag in-handle 5s, out-handle 25s →
Apply. Always fails. On a username without a space, never reproduces.
started: After G-05-5 path-shape fix landed in plan 05-06 (existed but
hidden before).

## Eliminated

- hypothesis: MediaServer's `createReadStream` for `/media/` HTTP serving
  holds an exclusive read handle; ffmpeg can't open the file.
  evidence: (1) MediaServer uses `fs.createReadStream` which on Node
    18+ opens with `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`
    by default — multiple readers are allowed on Windows. (2) The error
    message shows the path TRUNCATED at the space ("C:\Users\Hussien.")
    — if a file lock were the cause, ffmpeg would report the FULL path
    with a sharing-violation error. (3) The unit test mocks spawn and
    never uses the MediaServer, yet the test still passes — proving
    the MediaServer isn't in the failure path. (4) The user could
    reproduce by clicking Apply after the recording stops, by which
    time the renderer has already buffered/played the video; the
    pipe to the HTTP client may have already drained.
  timestamp: 2026-08-07T00:00:00Z

- hypothesis: Antivirus mid-scan locks the file when ffmpeg opens it.
  evidence: If AV were the cause, the error would show the FULL
    input path and report a sharing violation, not a path truncation
    at the space. The error path is "C:\Users\Hussien." (truncated) —
    AV doesn't truncate paths. The user also reports a clean
    environment with no known AV interference.
  timestamp: 2026-08-07T00:00:00Z

- hypothesis: MAX_PATH (260 char) limit on the userData path.
  evidence: userData is `C:\Users\Hussien Essam\AppData\Roaming\colonoscopist\`
    (~60 chars) + `data/media/patients/<patientId>/<procedureId>/video.mp4`
    (~60 chars) = ~120 chars total — well under 260. MAX_PATH errors
    also report "filename too long" not "Permission denied", and don't
    truncate the path mid-string.
  timestamp: 2026-08-07T00:00:00Z

- hypothesis: spawn() is splitting args into a shell string, breaking
  on the space in the username.
  evidence: spawn is called with an ARRAY of args (trim.ts:137), not
    a joined string. The default `shell: false` is in effect (not
    overridden). The `windowsVerbatimArguments: true` flag, NOT a
    missing shell, is what causes the truncation. The bug is in the
    flag's interaction with ffmpeg's option parser, not in spawn's
    argv-vs-string conversion.
  timestamp: 2026-08-07T00:00:00Z

- hypothesis: The path is correct but ffmpeg can't handle the encoding
  of the curly quotes in the device name (PITFALLS §10 surface).
  evidence: ffmpeg-args.ts:51 wraps the device name in literal
    `video="<name>"` quotes, and `canonicalizeName` (capture/canonicalize.ts:16-26)
    normalises unicode + strips zero-widths + collapses whitespace
    BEFORE the device name reaches the args builder. The trim
    subprocess doesn't even USE the device name — only the
    recording subprocess does. The trim args are pure
    `-ss/-i/-t/-c copy/-movflags/-y` — no `video=` arg at all.
  timestamp: 2026-08-07T00:00:00Z

## Evidence

- timestamp: 2026-08-07T00:00:00Z
  checked: src/main/recorder/trim.ts:135-140 (runFfmpegTrim spawn)
  found: |
    const child: ChildProcess = spawn(defaultFfmpegPath(), args as string[], {
      windowsVerbatimArguments: true,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
  implication: Only spawn call in the codebase with this flag set.
    Triggers the verbatim-passing behavior that truncates the input
    path at the first space.

- timestamp: 2026-08-07T00:00:00Z
  checked: src/main/recorder/recorder.ts:290-292 (recording spawn)
  found: |
    const child = this.deps.spawn(this.deps.ffmpegPath(), args2, {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
  implication: Recording subprocess does NOT use
    `windowsVerbatimArguments: true`. Node's default Windows command
    line construction properly quotes the output path with embedded
    spaces, so recording works on this user's machine (userData has
    a space, recording writes the mp4 successfully).

- timestamp: 2026-08-07T00:00:00Z
  checked: src/main/recorder/recorder.ts:1043-1047 (concat spawn)
  found: |
    const child = spawnConcat(this.deps.ffmpegPath(), args, {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
  implication: Concat subprocess (the one that produces the canonical
    mp4 from segments) also does NOT use the flag. Phase 5's trim is
    the OUTLIER.

- timestamp: 2026-08-07T00:00:00Z
  checked: src/main/recorder/trim.ts:1-9 (header comment)
  found: |
    "Mirrors Phase 4 concat.ts: pure argv via buildTrimArgs(), then a
    child spawn via defaultFfmpegPath() with windowsVerbatimArguments
    for the Windows path-quoting quirk (PITFALLS §10)."
  implication: Comment is STALE — it claims the flag mirrors concat.ts
    but concat.ts (recorder.ts:1045) does not set the flag. The
    comment also misreads PITFALLS §10: §10 recommends the flag for
    DEVICE NAMES (which are pre-quoted in ffmpeg-args.ts:51 as
    `video="<name>"`), not for arbitrary path args. The device name
    guidance is irrelevant for trim, which doesn't take a device
    name at all.

- timestamp: 2026-08-07T00:00:00Z
  checked: src/main/recorder/ffmpeg-args.ts:51, 60, 119, 123
  found: |
    Line 51 (recording): -i video=${deviceName}    ← device name wrapped in `video="..."`
    Line 60 (recording): -y ${outputPath}           ← output path BARE
    Line 119 (trim):     -i ${opts.inputPath}       ← input path BARE
    Line 123 (trim):     -y ${opts.outputPath}      ← output path BARE
  implication: The `video="..."` wrapping on the device name is what
    makes PITFALLS §10's verbatim-flag recommendation work for the
    recording subprocess. The path args (input/output) are bare strings
    and depend on Node's default Windows quoting — which the verbatim
    flag BYPASSES.

- timestamp: 2026-08-07T00:00:00Z
  checked: Real reproduction (spawn-cmdline-experiment.cjs in os.tmpdir())
  found: |
    With windowsVerbatimArguments: true on a path with a space
    ('C:\Users\Hussien Essam\...'), Node passes argv to CreateProcess
    as a single space-joined string with no quoting. The child process
    receives process.argv truncated at the first space. The same helper
    file with the same input arg receives the FULL path when the flag
    is NOT set. Reproduced 100% reliably on this Windows machine.
  implication: Direct empirical confirmation of the bug mechanism.
    `windowsVerbatimArguments: true` is the proximate cause; removing
    it from trim.ts:138 will fix the trim without affecting other
    code paths.

- timestamp: 2026-08-07T00:00:00Z
  checked: tests/main/recorder/trim.test.ts:33-36, 43
  found: |
    vi.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));
    ...
    tmpDir = mkdtempSync(path.join(tmpdir(), 'colonosco-trim-'));
  implication: The test mocks spawn entirely, so the wrong options
    are never exercised. The tmp dir is on the test runner's account
    (typically no spaces in the username), so even if a real spawn
    were used the bug would not reproduce on a CI runner. No assertion
    in the suite checks the spawn options at all.

- timestamp: 2026-08-07T00:00:00Z
  checked: tests/integration/trim-smoke.test.ts:85, 99, 111, 140
  found: All `spawnSync(ffmpegPath, ...)` calls use `{ stdio: [...] }`
    only — no `windowsVerbatimArguments: true`. The smoke test
    bypasses applyTrim entirely and constructs its own argv.
  implication: Even with RUN_SMOKE=1 on this user's machine, the
    smoke test would pass because it never exercises the buggy
    flag. The integration surface that hits the bug is applyTrim
    + Windows account-with-space.

## Resolution

root_cause: |
  `src/main/recorder/trim.ts:137-140` sets `windowsVerbatimArguments: true`
  on the trim spawn. With this flag, Node passes argv as a single
  space-joined string with NO quoting. ffmpeg's option parser splits
  on whitespace, so the userData path (which contains a space in any
  Windows account folder like "C:\Users\Hussien Essam\") is truncated
  at the first space. ffmpeg attempts to open the truncated path
  ("C:\Users\Hussien", a directory) as a file; Windows returns
  ERROR_ACCESS_DENIED; ffmpeg reports "Permission denied". The trim
  subprocess is the only spawn in the codebase with this flag set —
  the recording and concat spawns use Node's default Windows command-
  line construction which properly quotes paths with spaces.

fix: |
  Remove `windowsVerbatimArguments: true` from trim.ts:138 to match
  the recording spawn (recorder.ts:290) and the concat spawn
  (recorder.ts:1045). Both of those work correctly on the user's
  machine because they use Node's default Windows quoting.

  Also fix the stale header comment (trim.ts:1-9) to remove the
  claim that the flag "mirrors Phase 4 concat.ts" (it does not),
  and to clarify that PITFALLS §10's verbatim-flag guidance applies
  to the device-name form `video="<name>"` (used by the recording
  subprocess), not to the path args used by trim.

  Add a unit-test assertion in trim.test.ts that the spawn options
  do NOT include `windowsVerbatimArguments: true`, so any future
  regression of this flag is caught at CI time. The assertion should
  be made against a `vi.mocked(spawn)` call's third arg.

  Also extend the test to assert the spawn options include
  `shell: false` (default) and that the args array contains the
  full input path as a SINGLE element (not pre-quoted or escaped
  inside the string).
verification: |
  Not run (find_root_cause_only mode). After fix, expected:
  - trim spawn uses Node's default Windows quoting
  - ffmpeg receives the full input path: `C:\Users\Hussien Essam\AppData\Roaming\colonoscopist\data\media\patients\<id>\<id>\video.mp4`
  - ffmpeg's libavformat file-open succeeds
  - Exit code 0; trimmed sibling written; procedures.video_path
    updated; toast "Trim applied"
  - On a Windows account WITHOUT a space, behavior is unchanged
    (the bug never manifested there; no regression risk)
  - New trim.test.ts assertion (`expect(callArgs[2]).not.toHaveProperty('windowsVerbatimArguments', true)`)
    locks the fix
files_changed: []
