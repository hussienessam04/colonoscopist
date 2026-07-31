---
name: electron-ffmpeg
description: |
  Capture and record video from any video input device in an Electron app using
  ffmpeg as a child process, with a getUserMedia-based live preview. Use this
  skill whenever the user needs to record video, capture from a USB capture
  card (EasyCap, Elgato, AVerMedia, generic webcam), pull a DirectShow stream
  on Windows, or pipe frames to disk. Triggers on phrases like "record video",
  "live preview", "easycap", "directshow", "dshow", "usb capture card",
  "endoscope capture", "ffmpeg recording", "save video file". Do NOT use this
  for video playback (use HTML5 `<video>`), video editing/transcoding of
  existing files (still ffmpeg but a different flow), or audio-only capture.
---

# Video Capture + Recording in Electron

## Inputs to collect

- Target OS — almost always Windows for USB capture cards; macOS/Linux have different enumerations
- Capture device class — analog EasyCap (SD, 720×480), digital HDMI/DVI capture card (HD, 1080p), or generic webcam
- Desired output — single mp4 per recording session, with deterministic start/stop
- Whether the user needs audio in the recording — most endoscopes don't have it; default off

If the user is recording from a medical scope or other analog source, the workflow is: EasyCap (or similar) → USB → Windows sees it as a generic webcam → both `getUserMedia` and ffmpeg can grab it. No vendor SDK needed for v1.

## Procedure

### 1. The two-path architecture (use this every time)

```
┌────────────────────────────────────────────────────────────────┐
│  Renderer (React)                                               │
│  ┌──────────────────────┐   ┌──────────────────────────────┐  │
│  │ <video> live preview │   │ Screenshot button            │  │
│  │ from getUserMedia    │   │ canvas.drawImage(videoEl)    │  │
│  └──────────────────────┘   └──────────────────────────────┘  │
└────────────┬──────────────────────────────┬────────────────────┘
             │ IPC                          │ IPC
             ▼                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Main process                                                   │
│  ┌────────────────────┐  ┌────────────────────────────────┐   │
│  │ listDevices()      │  │ startRecording(opts)            │   │
│  │ via enumerateDevs  │  │ spawn ffmpeg child process      │   │
│  │ (renderer also)    │  │ stream events back via IPC     │   │
│  └────────────────────┘  └────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                          ffmpeg-static binary
                          ffmpeg -f dshow -i video="<device>"
```

**Why two paths:** `getUserMedia` is built into Chromium and trivial for the live preview (one line in the renderer). But `MediaRecorder` (the recorder side of `getUserMedia`) gives you browser-dependent codec quality, frame drops on long recordings, and no control over bitrate. Spawning `ffmpeg` directly gives you medical-grade H.264 with predictable bitrate, framerate, and file size.

### 2. Install ffmpeg in the app

```bash
npm install ffmpeg-static @types/ffmpeg-static
```

```ts
// main/services/capture/ffmpeg-path.ts
import ffmpegStatic from 'ffmpeg-static'
import { app } from 'electron'

export function ffmpegPath(): string {
  // ffmpeg-static returns the path inside node_modules; in production it lives
  // inside ASAR and can't be executed directly, so electron-builder must
  // asarUnpack it (see electron-vite skill, section 6).
  if (!ffmpegStatic) throw new Error('ffmpeg-static not bundled')
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
}
```

Add to `package.json` `build.asarUnpack`:

```json
"asarUnpack": ["**/node_modules/ffmpeg-static/**"]
```

### 3. Enumerate video devices (main process)

```ts
// main/services/capture/enumerate.ts
import { spawn } from 'node:child_process'
import { ffmpegPath } from './ffmpeg-path'

export type VideoDevice = {
  name: string              // exact string to pass to ffmpeg
  alternativeName?: string  // human-friendly label
  type: 'dshow' | 'avfoundation' | 'v4l2'
}

export async function listVideoDevices(): Promise<VideoDevice[]> {
  if (process.platform !== 'win32') {
    throw new Error('Only Windows dshow enumeration implemented; add platform branches as needed')
  }
  // ffmpeg prints device list to stderr
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), [
      '-list_devices', 'true',
      '-f', 'dshow',
      '-i', 'dummy',
    ])
    let stderr = ''
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('close', () => {
      const devices: VideoDevice[] = []
      // Parse lines like:  "DirectShow video devices (some number)"
      // followed by:      "  "USB Video Device""
      const lines = stderr.split('\n')
      let inVideoSection = false
      for (const line of lines) {
        if (line.includes('DirectShow video devices')) {
          inVideoSection = true
          continue
        }
        if (line.includes('DirectShow audio devices')) {
          inVideoSection = false
          continue
        }
        if (inVideoSection) {
          const m = line.match(/^\s*"([^"]+)"\s*$/)
          if (m) devices.push({ name: m[1], type: 'dshow' })
        }
      }
      resolve(devices)
    })
    proc.on('error', reject)
  })
}
```

Cross-reference with `navigator.mediaDevices.enumerateDevices()` in the renderer for the user-facing picker (it shows the same devices, more user-friendly labels).

### 4. Start a recording (main process)

```ts
// main/services/capture/recorder.ts
import { spawn, ChildProcess } from 'node:child_process'
import { BrowserWindow } from 'electron'
import { ffmpegPath } from './ffmpeg-path'

export type RecordingOptions = {
  deviceName: string        // exact dshow device name
  outputPath: string        // absolute path to .mp4
  resolution?: string       // '720x480' | '1280x720' | '1920x1080'
  framerate?: number        // 25 | 30
  videoBitrate?: string     // '5M' | '10M'
  audioDeviceName?: string  // optional
}

export class Recorder {
  private proc: ChildProcess | null = null

  start(opts: RecordingOptions): void {
    if (this.proc) throw new Error('Already recording')

    const args: string[] = [
      '-f', 'dshow',
      '-rtbufsize', '100M',         // bigger buffer = fewer frame drops
      '-i', `video=${opts.deviceName}${opts.audioDeviceName ? `:audio=${opts.audioDeviceName}` : ''}`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',         // fast encode, fine for medical capture
      '-pix_fmt', 'yuv420p',         // compatibility with all players
      '-r', String(opts.framerate ?? 30),
      '-s', opts.resolution ?? '1280x720',
      '-b:v', opts.videoBitrate ?? '5M',
      '-movflags', '+faststart',     // mp4 can stream/play while being written
    ]
    if (opts.audioDeviceName) {
      args.push('-c:a', 'aac', '-b:a', '128k')
    }
    args.push('-y', opts.outputPath)   // -y = overwrite without asking

    this.proc = spawn(ffmpegPath(), args)

    // Pipe stderr for progress / errors
    this.proc.stderr?.on('data', (chunk) => {
      const text = chunk.toString()
      // Optionally parse for "frame= 1234 fps=30 ..." lines for progress UI
      this.emit('progress', text)
      // ffmpeg logs everything to stderr by default
    })

    this.proc.on('close', (code) => {
      this.proc = null
      this.emit('stopped', { code, outputPath: opts.outputPath })
    })

    this.proc.on('error', (err) => {
      this.proc = null
      this.emit('error', err)
    })
  }

  stop(): void {
    if (!this.proc) return
    // Send 'q' to ffmpeg to finalize the mp4 cleanly (no corrupted moov atom)
    this.proc.stdin?.write('q')
    // Fallback: hard kill after 5s if 'q' didn't take
    setTimeout(() => {
      if (this.proc) {
        this.proc.kill('SIGTERM')
        this.proc = null
      }
    }, 5000)
  }

  // Minimal event emitter
  private listeners: Record<string, Array<(arg: any) => void>> = {}
  on(event: string, cb: (arg: any) => void) {
    (this.listeners[event] ??= []).push(cb)
  }
  private emit(event: string, arg: any) {
    for (const cb of this.listeners[event] ?? []) cb(arg)
  }
}
```

Why each flag matters:
- `-rtbufsize 100M` — capture buffer; small buffers drop frames on long recordings
- `-preset veryfast` — fast encoding speed; quality is fine for medical
- `-pix_fmt yuv420p` — works in every player and browser preview
- `-movflags +faststart` — mp4 metadata at the start, can be played while still being written
- stdin `q` — clean stop, finalized file. `kill -9` produces a corrupted mp4 that VLC might not play.

### 5. IPC wiring (the contract)

In `shared/ipc-contract.ts`:

```ts
export const IPC = {
  CAPTURE_LIST_DEVICES: 'capture:list-devices',
  CAPTURE_START: 'capture:start',
  CAPTURE_STOP: 'capture:stop',
  CAPTURE_STATUS: 'capture:status',
} as const

export type CaptureStatus = {
  isRecording: boolean
  startedAt?: number
  outputPath?: string
  errorMessage?: string
}
```

In `main/ipc/capture.ts`, register handlers and forward recorder events to the renderer:

```ts
import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-contract'
import { listVideoDevices } from '../services/capture/enumerate'
import { Recorder } from '../services/capture/recorder'

const recorder = new Recorder()

export function registerCaptureIpc() {
  ipcMain.handle(IPC.CAPTURE_LIST_DEVICES, () => listVideoDevices())

  ipcMain.handle(IPC.CAPTURE_START, async (_e, opts) => {
    recorder.start(opts)
    return { startedAt: Date.now(), outputPath: opts.outputPath }
  })

  ipcMain.handle(IPC.CAPTURE_STOP, () => recorder.stop())

  // Forward recorder events to all windows
  recorder.on('stopped', (info) => {
    BrowserWindow.getAllWindows().forEach((w) =>
      w.webContents.send('capture:stopped', info)
    )
  })
  recorder.on('error', (err) => {
    BrowserWindow.getAllWindows().forEach((w) =>
      w.webContents.send('capture:error', { message: err.message })
    )
  })
}
```

In `preload/index.ts`, expose:

```ts
capture: {
  listDevices: () => ipcRenderer.invoke(IPC.CAPTURE_LIST_DEVICES),
  start: (opts) => ipcRenderer.invoke(IPC.CAPTURE_START, opts),
  stop: () => ipcRenderer.invoke(IPC.CAPTURE_STOP),
  onStopped: (cb) => {
    const listener = (_e, info) => cb(info)
    ipcRenderer.on('capture:stopped', listener)
    return () => ipcRenderer.removeListener('capture:stopped', listener)
  },
  onError: (cb) => {
    const listener = (_e, info) => cb(info)
    ipcRenderer.on('capture:error', listener)
    return () => ipcRenderer.removeListener('capture:error', listener)
  },
}
```

### 6. Live preview in the renderer (getUserMedia)

```tsx
// src/renderer/hooks/useVideoPreview.ts
import { useEffect, useRef, useState } from 'react'

export function useVideoPreview(deviceId: string | null) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!deviceId || !videoRef.current) return
    let stream: MediaStream | null = null
    let cancelled = false

    navigator.mediaDevices
      .getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return }
        stream = s
        if (videoRef.current) {
          videoRef.current.srcObject = s
          videoRef.current.play()
        }
      })
      .catch((e) => setError(e.message))

    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [deviceId])

  return { videoRef, error }
}
```

Use it in the Procedure Room screen:

```tsx
const { videoRef, error } = useVideoPreview(selectedDeviceId)
return (
  <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain" />
)
```

### 7. Screenshot from the live preview

```tsx
async function captureScreenshot(videoEl: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = videoEl.videoWidth
  canvas.height = videoEl.videoHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      blob ? resolve(blob) : reject(new Error('toBlob returned null'))
    }, 'image/jpeg', 0.95)
  })
}
```

Then send the blob to main for persistence (or save it via main with a `saveScreenshot({ procedureId, blob })` IPC call).

### 8. Device-lost handling

Devices can disappear mid-procedure (USB unplug, driver crash). Detect and recover:

```ts
// In main, watch for recorder errors with specific ffmpeg signatures
recorder.on('error', (err) => {
  if (/I\/O error|device disconnected/i.test(err.message)) {
    // Force-stop the recording so we can save what was captured
    recorder.stop()
    // Notify the renderer with a clear "device lost, saving partial file" event
  }
})
```

In the renderer, on `capture:error` with a device-lost message, show a clear non-blocking banner: "Capture device disconnected — recording saved up to this point."

### 9. Quality presets (for the Settings UI)

```ts
export const QUALITY_PRESETS = {
  sd_analog: {
    label: 'SD analog (EasyCap)',
    resolution: '720x480',
    framerate: 30,
    videoBitrate: '4M',
  },
  hd_digital: {
    label: 'HD digital (HDMI/DVI)',
    resolution: '1920x1080',
    framerate: 30,
    videoBitrate: '10M',
  },
  custom: { /* user fills all values */ },
} as const
```

## Output contract

A working capture flow that produces:

- A live preview in the renderer from the selected device
- A recorded `.mp4` file at a known path per session, properly finalized (playable in any player)
- A `Record` button in the UI that calls `window.api.capture.start(...)` and a `Stop` button that calls `window.api.capture.stop()`
- Screenshots saved as JPEG/PNG tied to the current procedure
- Graceful handling when the device is unplugged mid-recording (file saved up to last frame, clear UI message)

## Failure handling

- **"Cannot find ffmpeg" at runtime** → `asarUnpack` doesn't cover `ffmpeg-static`; update `package.json` `build.asarUnpack` and rebuild
- **Recording works but file is corrupted at the end** → you used `proc.kill('SIGKILL')` instead of stdin `q` + SIGTERM fallback; switch to the `stop()` pattern in section 4
- **Video plays locally but won't open in QuickTime / browser** → missing `-pix_fmt yuv420p`; add it
- **Frame drops after a few minutes** → `-rtbufsize` too small; bump to 100M
- **"Could not find device" from ffmpeg but device shows in Device Manager** → the device name in ffmpeg must match exactly including spaces; re-enumerate and use the name as-is, do not trim
- **Two EasyCapped devices, app picks the wrong one** → user must select device in the UI; the dropdown is populated from `listVideoDevices()`, do not auto-pick
- **Device works for preview but recording fails** → preview uses `getUserMedia` (MediaFoundation) and recording uses `ffmpeg dshow` (DirectShow); they have different device lists on some hardware. Always enumerate via ffmpeg for the recording path, not via `enumerateDevices()` alone

## Examples

**Input**: "Record a colonoscopy procedure to disk, with the user able to take screenshots during recording."

**Output**: This entire skill. The procedure recording screen wires `useVideoPreview` to a `<video>`, a Record button calls `window.api.capture.start({ deviceName, outputPath, ...preset })`, a Screenshot button calls `captureScreenshot()` and sends the blob to main, and a Stop button calls `window.api.capture.stop()`.

**Input**: "ffmpeg is not bundled in the production app."

**Output**: Add `**/node_modules/ffmpeg-static/**` to `package.json` `build.asarUnpack`, then in main process use `ffmpegStatic.replace('app.asar', 'app.asar.unpacked')` when getting the path. Verify by checking that the file exists at the replaced path after `npm run package`.

**Input**: "The mp4 file is corrupted when I stop recording with `kill()`."

**Output**: Replace `proc.kill('SIGKILL')` with the `stop()` pattern: write `'q'` to stdin, wait 2s for graceful shutdown, then SIGTERM as fallback. Do not SIGKILL — that leaves the mp4's moov atom at the end of the file and most players reject it.
