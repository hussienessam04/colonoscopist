# Pitfalls Research

**Domain:** Electron desktop, USB DirectShow capture, long-form recording, offline license, clinical/medical-style workflow
**Researched:** 2026-07-31
**Confidence:** HIGH (pitfalls derived from well-known Electron + ffmpeg + Windows capture failure modes)

## Critical Pitfalls

### Pitfall 1: Lost frames / corrupt mp4 at end of long procedure

**What goes wrong:**
Procedure records for 60+ minutes; on `Stop`, the mp4 file cannot be played or is missing the last 5–30 seconds. Sometimes the entire file is unplayable.

**Why it happens:**
(1) `ffmpeg` was killed with SIGKILL during a keyframe interval, so the moov atom didn't finalize. (2) The filesystem flush wasn't fsync'd before close. (3) `+faststart` moves moov to front on close, but a crash before close leaves the file with only a header. (4) Buffered stderr from ffmpeg is lost on hard kill.

**How to avoid:**
- Use a SIGTERM-with-grace window: send `q\n` on stdin (so ffmpeg flushes), wait 5 seconds, escalate to SIGKILL only if exit hasn't fired.
- Run `fsync` on the file before close (Node `fs.fsync`).
- Always set `-movflags +faststart` so the moov atom is rewritten once at end.
- Consider segmenting: `-f segment -segment_time 300` writes 5-min chunks; a corrupted tail only loses the last chunk.
- After Stop, verify mp4 has a valid `moov` atom before declaring "record complete" (probe via ffprobe or simple size+duration sanity check).

**Warning signs:**
- "File exists, length 0" after a ffmpeg exit code != 0
- ffprobe reports "moov atom not found"
- mp4 plays but stops short of the displayed duration

**Phase to address:**
Phase 4 (Recording).

---

### Pitfall 2: Device-lost mid-recording (USB cable wiggled, EasyCap power glitch)

**What goes wrong:**
ffmpeg exits with a non-zero code mid-procedure. The app's UI says "Record" but the underlying encoder is dead. The doctor thinks they're recording; they are not. The next "Stop" leaves a 0-byte file and the report's video link is broken.

**Why it happens:**
DirectShow devices on Windows disconnect without notice. ffmpeg's recovery behavior varies by driver (EasyCap is notoriously flaky).

**How to avoid:**
- Watch the ffmpeg `stderr`; treat any 30-second silence (no frame counter, no encoded size growth) as a soft-loss signal.
- Emit a `recorder:warning` IPC event to the renderer; renderer surfaces a red banner over the preview.
- Persist a `.partial.mp4` + a sidecar JSON with last-known timestamp so the doctor can resume or accept the partial.
- Provide "Resume recording to the same procedure" as a v1.1 capability; for v1, just clearly mark the partial result.

**Warning signs:**
- `fs.stat` on the mp4 stops growing for >30s while status shows recording
- ffmpeg stderr contains "DeviceLost", "EOF on input", "I/O error"
- `webContents.send('recorder:error', ...)` fires

**Phase to address:**
Phase 4 (Recording), exercised in Phase 5 (Review).

---

### Pitfall 3: Device enumeration race / duplicate devices when preview and recorder open the same USB device

**What goes wrong:**
Preview (renderer via `getUserMedia`) and recorder (main via ffmpeg) both request the same DirectShow device. Windows allows two handles on many devices but not all. On EasyCap, the second open sometimes takes the device exclusively, blocking the first.

**Why it happens:**
DirectShow is exclusive-by-default on some drivers; renderer and main negotiate the mode independently.

**How to avoid:**
- Sequence: enumerate devices → user picks → open in main for ffmpeg FIRST → on success, then renderer opens via `getUserMedia`.
- If `getUserMedia` fails to open the same device, fall back to one-handle mode (record in main; live preview via a small MJPEG-from-ffmpeg stream piped to the renderer as a `<video>` source).

**Warning signs:**
- `getUserMedia` rejects with "Could not start video source"
- ffmpeg subprocess opens fine, but immediately a second ffmpeg (or `getUserMedia`) on the same name fails

**Phase to address:**
Phases 3 (Capture device enumeration + generic picker + live preview) and 4 (Recording).

---

### Pitfall 4: Native module ABI mismatch — app crashes on launch

**What goes wrong:**
`better-sqlite3` was built against Node 20 ABI; user installed a different Electron minor that uses Node 22 ABI. App launches, hits "cannot find module" or segfaults inside the native addon.

**Why it happens:**
Electron majors ship a Node ABI; native modules must be rebuilt against that ABI. `npm install` doesn't always trigger it.

**How to avoid:**
- Add a `postinstall` hook that runs `electron-rebuild` (or `@electron/rebuild`) — fail the install if rebuild fails.
- Pin Electron major in package.json with a comment noting the tested Node ABI.
- In `electron-builder.yml`, include the `nativeDependencies` rebuild step.
- On first launch, log the Node ABI version + the better-sqlite3 binding version to a startup log file; surface a banner if mismatched.

**Warning signs:**
- "Error: The module was compiled against a different Node.js version"
- App silently opens a window with a black screen and exits

**Phase to address:**
Phase 1 (Scaffold — native module setup).

---

### Pitfall 5: PIN brute-force — no rate limiting on the login screen

**What goes wrong:**
A clinician leaves the workstation; an unauthorized person tries PINs. Without throttling, a 4-digit PIN is brute-forced in <30 seconds.

**Why it happens:**
Default auth paths don't include rate limiting by default.

**How to avoid:**
- After 5 failed attempts, exponential backoff (1s, 2s, 4s, …).
- After 10 failed attempts, lock the account and require admin PIN reset (admin role only).
- Log every failed attempt in `audit_log` with `action = 'login_failed'`.
- Hash the PIN with scrypt (or argon2 if you accept the native module), salted.

**Warning signs:**
- Audit log shows >5 `login_failed` from same user within 10 min with no backoff visible
- Absence of failed-login logging at all

**Phase to address:**
Phase 1 or 2 (Auth — must be present from first login screen).

---

### Pitfall 6: License verification is a no-op (or trivially bypassed)

**What goes wrong:**
The "you must have a license" check is a boolean in a JSON file the user can edit. Within the first week of release, someone has cracked it by editing the file.

**Why it happens:**
The first iteration of a license check is rarely signed or verified against tampering.

**How to avoid:**
- Verify the `.lic` file with Ed25519 public key embedded in the binary. The license JSON is the *signature payload*, not the storage format.
- Store the license as a sidecar: `license.sig` (the signature) and `license.json` (the payload) — verifying code re-derives signature and compares.
- Failure must be logged locally — clinic owner (and you) see when a tampered file was attempted.
- Phase 8 includes a follow-up N-API addon for tamper-resistant verification; ship the JS path now with hard-coded checksums and `Object.freeze`'d verification code.

**Warning signs:**
- License lives in a single plaintext file with no signature
- The verification code path is reachable via debugger eval calls
- `settings` table can set `license_is_valid = true`

**Phase to address:**
Phase 8 (Licensing).

---

### Pitfall 7: RTL layout breaks in 2–3 specific shadcn components

**What goes wrong:**
Doctor selects Arabic; document direction is RTL; the `Slider`, `DropdownMenu`, `Dialog`, and a couple of calendar components render mirrored text or off-screen items.

**Why it happens:**
shadcn/Radix UI ships with default LTR assumptions; flipping the document direction is necessary but not sufficient.

**How to avoid:**
- Set `<html dir="rtl" lang="ar">` at boot when language is Arabic.
- Pass `dir` to Radix `Slider`, `DropdownMenu`, `Popover`, `Dialog` portals where applicable.
- For charts and timeline scrubbers, verify mirroring manually.
- Print a sample Arabic report PDF and visually inspect — RTL text in @react-pdf/renderer has its own gotchas (bidirectional script rendering).

**Warning signs:**
- Snapshot test: Arabic login page overflows the viewport on the right
- Scrubber arrow points left instead of right
- Dialog content clips because `right: 0` was used instead of `inset-inline-end: 0`

**Phase to address:**
Phase 7 (i18n — Arabic + RTL).

---

### Pitfall 8: PDF report RTL — numbers and Latin fragments are backwards

**What goes wrong:**
`@react-pdf/renderer` renders the report text with bidi handling, but a doctor's signature image gets placed in the wrong corner, and "MRN: 12345" flips to "MRN: 54321" inside Arabic paragraphs.

**Why it happens:**
`@react-pdf/renderer` bidi support is real but partial; numbers inside Arabic paragraphs need explicit `<Text>` isolation, and Latin fragments need `<Text style={{ direction: 'ltr' }}>`.

**How to avoid:**
- For every mixed-direction paragraph, wrap Latin/numeric tokens explicitly.
- Render signature/logo placement with directional CSS, not absolute `left`/`right`.
- Generate a sample AR report in CI smoke test; diff against a checked-in PDF reference (or just visually inspect once, freeze the styling).

**Warning signs:**
- "MRN" appears reversed in Arabic reports
- Logo is in the wrong corner

**Phase to address:**
Phase 6 (Reports) and Phase 7 (i18n Arabic RTL).

---

### Pitfall 9: Backup zip captures a partially-written SQLite DB

**What goes wrong:**
Doctor runs backup during a procedure; the zip contains a 200 MB `app.db` file, but the WAL files (`app.db-wal`, `app.db-shm`) are captured separately, and the db file in the zip is half-written. Restoring yields a corrupted DB.

**Why it happens:**
SQLite is a multi-file database; the WAL/SHM files are required for the main DB to be consistent at any moment. Capturing files individually is racy.

**How to avoid:**
- Use SQLite's built-in backup API (`db.backup()` in better-sqlite3) to a single file or in-memory copy, THEN zip.
- OR: `PRAGMA wal_checkpoint(TRUNCATE)` first, then check that `app.db-wal` is empty / removed before zipping.
- Document in the backup UI: "Close any open procedure before backing up."

**Warning signs:**
- Restored DB fails `PRAGMA integrity_check`
- Restored DB opens but reports are missing their last procedure

**Phase to address:**
Phase 1 or 2 (Database) — and again in Phase 7 / later when backup ships.

---

### Pitfall 10: USB path quoting on Windows ffmpeg

**What goes wrong:**
ffmpeg `-f dshow -i video="USB Video Device"` works once, then fails next run because the device name now contains an en-dash, a curly apostrophe, or a trailing space — `child_process.spawn` passes it without escaping, ffmpeg misinterprets it as multiple arguments.

**Why it happens:**
Windows device names are free-form unicode strings; spawn-without-shell doesn't escape spaces or unicode.

**How to avoid:**
- Use `child_process.spawn(command, args, { windowsVerbatimArguments: true, shell: false })` with `args` as an array (Node's spawn quoting for Windows).
- Pre-normalize device names by trimming + NFC-unicode-normalizing on enumeration; re-display normalized form in the UI.
- Always pass `-i video="<exact-name>"` with the quoted form; verify the exact form matches what `dshow` enumerates by testing round-trip on each device picked.

**Warning signs:**
- ffmpeg exits immediately with "Option video= (null) not found" or no input specified
- Same code works on bench devices, fails at first customer site

**Phase to address:**
Phases 3 and 4 (Device enumeration + recording).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Storing license state in the `settings` table | One place, easy to read | License becomes editable through the same UI; verification is now trusted by an editable source | Never — keep license verification independent |
| Skipping `wal_checkpoint(TRUNCATE)` after finalize | Slightly faster writes | WAL files grow until disk fills | Only if you have a regular VACUUM job |
| Using `MediaRecorder` for short previews | No child process | Phantom mp4 bug list at hour 2 | Only for in-app clip demos, NEVER for v1 procedure recording |
| One `app.db` file with no backup discipline | Simple | Single disk-fault = data loss | Never — must ship backup/restore from day 1 |
| Embedding signature image as Base64 in DB | No file pointer to lose | DB bloats; backup zip balloons | Acceptable for small logos (<100 KB) but NOT for screenshots |
| Mixing Arabic and English in the same JSON bundle | One file | Translators can't find a key by section; RTL pairing is fragile | Never — split by language |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Electron `safeStorage` on Linux/macOS | (Not relevant for v1 — Windows-only) | n/a — Windows uses DPAPI, opaque to us |
| `ffmpeg-static` | Forgetting to grant execute permission on macOS/Linux | (Windows-only for v1; future-proof: chmod on Posix in a postinstall) |
| `better-sqlite3` Electron rebuild | `npm install` then forgetting `electron-rebuild` | `postinstall` script + README note + startup log of ABI version |
| `getUserMedia` in Electron | Forgetting `app.commandLine.appendSwitch('disable-features', '…')` for permissions | Set `BrowserWindow` permissions in the constructor: `permissions: ['media']` |
| `app.getPath('userData')` after rename | Cached from a previous install | Always call fresh; if migrating, check old vs new and copy |
| Windows DPI scaling | Preview <video> renders fuzzy because renderer is per-monitor DPI unaware | Set `webPreferences.zoomFactor` or use a high-DPI media constraint on getUserMedia |
| DirectShow device with crossbar | Some EasyCap devices expose multiple pins; defaults are wrong for the doctor's cable | Don't expose pin selection in v1; ship a "if picture looks wrong, click here to run the vendor setup" documentation link |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| fsync-per-frame for screenshots | Slow screenshot button | fsync at end of procedure only; rely on the filesystem | Never breaks for the use case; skip per-frame fsync |
| Reading the entire patient list into the renderer for each screen | Laggy lists after a few thousand patients | Paginate at the renderer; query LIMIT/OFFSET in main | >5k patients |
| Re-decoding mp4 thumbnails on every review | Slow review tab open | Cache thumbnails on first decode; persist as JPEG sidecars | >1 GB mp4 in review |
| Every audit_log insert wrapped in a transaction | Slow app | Append single statements outside explicit transactions; transactions only for multi-row writes | Never breaks for the use case |
| Per-page React re-render on every status update | UI lag in Procedure Room | Zustand selectors with shallow equality | When status update rate exceeds 10 Hz |
| Synchronous SQLite reads from the main process blocking the UI | App "stops responding" splash when doctor opens a list with thousands of procedures | `PRAGMA journal_mode = WAL` + paginated queries | >50k procedures on a single workstation |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `nodeIntegration: true` "because it's easier" | Renderer RCE on any XSS — game over for a clinical tool | Ship with `contextIsolation: true, nodeIntegration: false, sandbox: true` from day 1 |
| Storing PIN hash in plaintext | Full account takeover if `app.db` leaks | scrypt with per-user salt; never log or display the hash |
| Storing patient notes in plaintext | Patient notes are sensitive; on-disk leak = data breach | Acceptable risk for v1 if `app.db` is under `userData` with OS permissions; encryption-at-rest is a v2 hardening |
| Hardcoding the Ed25519 private key in the repo | Anyone can sign a license | The signing key lives ONLY in the vendor's offline CLI; the repo gets the verify-only public key |
| Disabling `webSecurity: false` to "fix" a renderer issue | Opens the door to all CORS bypasses | Never; if a CDN asset is needed, bundle it locally |
| Allowing the renderer to read arbitrary files via a "file picker" IPC | Path traversal | The IPC reads only from `path.join(app.getPath('userData'), 'data', …)`; no arbitrary paths |
| Logging sensitive content to a file | Patient names appear in logs | Audit log metadata is structured (entity_type, entity_id) and never contains field values; add to v2 hardening |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Tiny Record button lost among other controls | Doctor fumbles during procedure | Hero-sized red Record button, no clutter, top of screen |
| Modal dialogs during a procedure | Interrupts the case; modal can't be dismissed with one quick click | In-procedure flows use inline status banners, never blocking modals |
| Locked-out account with no clear path back | Doctor can't work, must call support | Admin role can PIN-reset; first-time setup wizard prevents the scenario |
| Backup that doesn't surface "where's my zip" | Doctor thinks backup didn't work | After zip completes, modal offers "Open folder" with the file selected |
| Login screen in Arabic but menu in English | Half-translated experience | Per-language completeness check before tagging a phase as done |
| Procedure Room on a 1080p screen at 100% zoom looks crowded | Doctor squints | "Clinical / compact" density toggle (v1.1); for v1, design at 1366×768 minimum |
| Review timeline thumbnails don't load in order | Confusing review | Always render in `created_at` order; never trust UI-side shuffle |

## "Looks Done But Isn't" Checklist

- [ ] **Recording:** Recording appears to save a file, but the file is empty because ffmpeg was killed before moov atom finalized — verify by playing the mp4 in any player.
- [ ] **Screenshots:** Screenshots appear in the timeline, but the file on disk is empty / 0 bytes — verify by opening the screenshot.
- [ ] **PDF report:** Report renders for English but is mangled for Arabic — verify by generating and reading an AR report end-to-end.
- [ ] **Search:** Search by MRN returns nothing because the index was only created for `name` — verify by searching on MRN explicitly.
- [ ] **License:** License says "activated" but every restart flips to trial — verify the verify path is called at startup, not just on `Settings → License` click.
- [ ] **Audit:** Audit log shows every login but not every patient-view — verify by opening a patient and confirming the corresponding `audit_log` row exists.
- [ ] **Backup:** Backup zip exists and is non-trivial size, but restored DB is broken — verify by restoring to a clean folder and running `PRAGMA integrity_check`.
- [ ] **Restore:** Restore overwrites the live `data/` without warning — verify confirmation modal.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Lost frames / corrupt mp4 | LOW (patient accepts a partial if we tell them) | Doctor deletes tail; if moov missing, runs `ffmpeg -i partial.mp4 -c copy recovered.mp4` to rebuild container |
| Device lost mid-recording | LOW | Renderer surfaces the partial; doctor can re-record or accept |
| Native module ABI mismatch | LOW | `npx electron-rebuild` from app directory, restart |
| License tamper attempt | MEDIUM | Show clear "license invalid, contact vendor" UI; clinic emails the machine-id screenshot; vendor regenerates `.lic` |
| Backup with half-written DB | LOW | Doctor's last backup (before the broken one) is the fallback; document hourly backup cadence |
| RTL rendering bug | LOW | Document the workaround; ship fix in next minor |
| USB device name quoting bug | LOW | Add to a manual diagnosis script in the app; requires a one-line normalization per device |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Lost frames / corrupt mp4 (Pitfall 1) | Phase 4 (Recording) | Stop after 60s of recording, open the mp4, confirm duration matches and plays cleanly |
| Device-lost mid-recording (Pitfall 2) | Phase 4 (Recording) | Simulate disconnect (unplug EasyCap mid-record) and verify the warning + partial file |
| Device enumeration / preview race (Pitfall 3) | Phases 3 + 4 (Capture + Recording) | Pick the same device for both, verify both paths open |
| Native module ABI mismatch (Pitfall 4) | Phase 1 (Scaffold) | Add `postinstall` rebuild + first-launch ABI logging |
| PIN brute-force (Pitfall 5) | Phase 1 or 2 (Auth) | 5 failed PIN attempts trigger increasing delay |
| License trivially bypassed (Pitfall 6) | Phase 8 (Licensing) | Edit the license JSON, app refuses to start; signed payload only |
| RTL layout breaks (Pitfall 7) | Phase 7 (i18n Arabic + RTL) | Run a smoke test on every shadcn component in RTL mode |
| PDF report RTL (Pitfall 8) | Phases 6 + 7 (Reports + i18n) | Generate sample AR PDF, verify MRN ordering, logo corner, signature position |
| Backup captures partial DB (Pitfall 9) | Phase 1 or 2 (DB) + Phase 7 (Backup/Restore) | Restore a backup taken mid-procedure, run integrity_check |
| USB path quoting on Windows ffmpeg (Pitfall 10) | Phases 3 + 4 (Device enumeration + Recording) | Round-trip a name with a curly quote; ffmpeg accepts it |

## Sources

- ffmpeg DirectShow input + segment options + `-movflags +faststart`
- Electron security guidance (contextIsolation, sandbox, nodeIntegration)
- @react-pdf/renderer bidi handling notes
- Radix UI + shadcn RTL behavior (community-documented)
- SQLite WAL + backup mode docs
- Common better-sqlite3 + Electron ABI rebuild failure modes
- User brief — locked-in security baseline + offline license + RTL + Windows capture

---
*Pitfalls research for: Colonoscopist (Electron desktop, offline, GCC clinics)*
*Researched: 2026-07-31*
