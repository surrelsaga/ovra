// Owner: Agent A (sensing). Hidden capture renderer: runs the SmartSpectra renderer SDK,
// reduces metrics to MetricsSnapshot (derived face values only, never landmarks) and sends them to main.
// Never writes or uploads frames.
import {
  ProcessingStatus,
  SmartSpectraSDK,
  breathingMetrics,
  cardioMetrics,
  faceMetrics
} from '@smartspectra/node-sdk/renderer'
import { decodeMetrics } from '@smartspectra/node-sdk/messages'
import type { CaptureStartRequest, MetricsSnapshot, ValidationEvent } from '@shared/types'
import { captureConfig as cfg } from './config'
import { mergeSnapshots, reduceMetrics, type FrameSize } from './reduce'
import { addPayload, emptyDiagnostics } from './diagnostics'
import { monitorConfig } from '@shared/monitor-config'
import { CAMERA_FALLBACK, openCamera } from '../shared/camera'

interface Active {
  sdk: SmartSpectraSDK
  /** Every stream we know of (ours or SDK-acquired); all tracks must end on stop. */
  streams: MediaStream[]
  cleanup: () => void
  flush: ReturnType<typeof setInterval>
  diag?: ReturnType<typeof setInterval>
  finishDiagnostics?: () => void
}

const ovra = window.ovra
let active: Active | null = null
let queue = Promise.resolve()

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function fileUrl(path: string): string {
  return 'file://' + encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

/**
 * Draws a playing <video> into a 1280×720 canvas, scaled down with black padding at the bottom
 * so the SDK's chest check passes, and returns the canvas stream. Frames stay in memory.
 */
function paddedStream(
  video: HTMLVideoElement,
  pad: number
): { stream: MediaStream; cleanup: () => void } {
  const canvas = document.createElement('canvas')
  canvas.width = cfg.width
  canvas.height = cfg.height
  const g = canvas.getContext('2d')
  if (!g) throw new Error('No 2D canvas context')
  const p = Math.min(cfg.maxFramingPad, Math.max(0, pad))
  const h = Math.round(cfg.height * (1 - p))
  const w = Math.round((video.videoWidth * h) / video.videoHeight)
  // Fixed-rate frames (repeating the last decoded frame if decoding lags) keep the SDK's
  // frame-rate check happy when the machine is busy.
  const stream = canvas.captureStream(0)
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
  const timer = setInterval(() => {
    g.fillStyle = '#000'
    g.fillRect(0, 0, cfg.width, cfg.height)
    g.drawImage(video, (cfg.width - w) / 2, 0, w, h)
    track.requestFrame()
  }, 1000 / cfg.fps)
  return {
    stream,
    cleanup: () => {
      clearInterval(timer)
      video.pause()
      video.srcObject = null
      video.removeAttribute('src')
      video.load()
    }
  }
}

async function playingVideo(setup: (v: HTMLVideoElement) => void): Promise<HTMLVideoElement> {
  const video = document.createElement('video')
  video.muted = true
  video.loop = true
  video.playsInline = true
  setup(video)
  await video.play()
  return video
}

/** Dev video source: a test-media file through the padded canvas. */
async function fileStream(
  path: string,
  framingPad: number
): Promise<{ stream: MediaStream; cleanup: () => void }> {
  return paddedStream(await playingVideo((v) => (v.src = fileUrl(path))), framingPad)
}

/**
 * Padded live camera (reliability §5.6): same canvas as the dev source. The raw camera stream is
 * returned too so stop() ends its tracks.
 */
async function paddedCamera(
  scale: number,
  cameraId: string
): Promise<{ streams: MediaStream[]; stream: MediaStream; cleanup: () => void }> {
  const cam = await captureCamera(cameraId)
  try {
    const p = paddedStream(await playingVideo((v) => (v.srcObject = cam)), 1 - scale)
    return { ...p, streams: [cam, p.stream] }
  } catch (err) {
    for (const t of cam.getTracks()) t.stop()
    throw err
  }
}

const captureCamera = (cameraId: string): Promise<MediaStream> =>
  openCamera(
    cameraId,
    () =>
      ovra.send('capture:error', {
        code: 'camera-fallback',
        message: CAMERA_FALLBACK,
        retryable: true
      }),
    {
      width: { ideal: cfg.width },
      height: { ideal: cfg.height },
      frameRate: { ideal: cfg.fps },
      facingMode: 'user'
    }
  )

const busy = (sdk: SmartSpectraSDK): boolean =>
  [ProcessingStatus.kStarting, ProcessingStatus.kRunning, ProcessingStatus.kStopping].some(
    (st) => st === sdk.processingStatus
  )

/** True once the SDK is no longer processing (idle, or halted by a terminal error). */
async function waitStopped(sdk: SmartSpectraSDK): Promise<boolean> {
  const until = Date.now() + cfg.idleWaitMs
  while (busy(sdk) && Date.now() < until) await new Promise((r) => setTimeout(r, cfg.idlePollMs))
  return !busy(sdk)
}

async function start(req: CaptureStartRequest): Promise<void> {
  if (active) await stop()
  ovra.send('capture:status', 'starting')

  const sdk = new SmartSpectraSDK({
    apiKey: req.apiKey,
    requestedMetrics: [...breathingMetrics, ...cardioMetrics, ...(req.face ? faceMetrics : [])],
    enableTelemetry: req.telemetry // SDK default is true: always pass it
  })
  let frame: FrameSize = { width: cfg.width, height: cfg.height }
  let pending: MetricsSnapshot | null = null
  let diagnostics = req.diagnostics ? emptyDiagnostics(req.phase) : null
  let currentValidation: ValidationEvent | null = null
  let lastCode: number | null = null
  const padded = req.source.kind === 'camera' && cfg.liveScale < 1
  const a: Active = {
    sdk,
    streams: [],
    cleanup: () => {},
    flush: setInterval(() => {
      if (!pending) return
      ovra.send('capture:metrics', pending)
      if (diagnostics) diagnostics.snapshots++
      pending = null
    }, 1000 / cfg.maxSendsPerSec)
  }
  const reportDiagnostics = (): void => {
    if (!diagnostics) return
    diagnostics.t = Date.now()
    diagnostics.processing =
      Object.entries(ProcessingStatus).find(
        ([name, value]) => name.startsWith('k') && value === sdk.processingStatus
      )?.[0] ?? String(sdk.processingStatus)
    diagnostics.validation = currentValidation
    ovra.send('capture:diag', diagnostics)
    diagnostics = emptyDiagnostics(req.phase)
  }
  if (diagnostics) {
    a.diag = setInterval(reportDiagnostics, monitorConfig.updateMs)
    a.finishDiagnostics = reportDiagnostics
  }
  active = a

  sdk.on('metrics', (buf, timestampUs) => {
    const raw = decodeMetrics(buf)
    // SDK frame timestamps are epoch microseconds; receipt time would hide a frozen stream.
    const snapshot = reduceMetrics(raw, frame, timestampUs / 1000)
    if (lastCode !== null) snapshot.validationCode = lastCode
    // ponytail: the chest isn't really in a padded frame, so its breathing isn't trusted.
    if (padded) delete snapshot.breathing
    if (diagnostics) addPayload(diagnostics, raw, snapshot)
    pending = mergeSnapshots(pending, snapshot)
  })
  sdk.on('validationStatus', (code, _ts, hint) => {
    if (diagnostics) {
      diagnostics.validationCodes[code] = (diagnostics.validationCodes[code] ?? 0) + 1
      currentValidation = { t: Date.now(), code, hint }
    }
    if (code === lastCode) return
    lastCode = code
    ovra.send('capture:validation', { t: Date.now(), code, hint })
  })
  // Main decides what a terminal error means (restart or give up), so capture never stops itself.
  sdk.on('error', (code, message, retryable) => {
    ovra.send('capture:error', { code, message, retryable })
  })
  // The SDK can sit in kError without a terminal 'error' event (live run, decision 48).
  sdk.on('processingStatus', (status) => {
    if (status === ProcessingStatus.kError && active === a)
      ovra.send('capture:error', {
        code: 'sdk-status',
        message: 'SDK processing status is kError',
        retryable: false
      })
  })
  sdk.on('streamAvailable', (stream) => {
    a.streams.push(stream)
    const s = stream.getVideoTracks()[0]?.getSettings()
    if (s?.width && s.height) frame = { width: s.width, height: s.height }
  })

  try {
    if (req.source.kind === 'file') {
      const f = await fileStream(req.source.path, req.source.framingPad)
      a.streams.push(f.stream)
      a.cleanup = f.cleanup
      sdk.useMediaStream(f.stream)
    } else if (padded) {
      const c = await paddedCamera(cfg.liveScale, req.source.cameraId ?? '')
      a.streams.push(...c.streams)
      a.cleanup = c.cleanup
      sdk.useMediaStream(c.stream)
    } else {
      const stream = await captureCamera(req.source.cameraId ?? '')
      a.streams.push(stream)
      sdk.useMediaStream(stream)
    }
    await sdk.start()
    if (active === a) ovra.send('capture:status', 'running')
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code
    ovra.send('capture:error', {
      code: 'start-failed',
      message: typeof code === 'number' ? `${errMsg(err)} (SDK code ${code})` : errMsg(err),
      retryable: true
    })
    await stop()
  }
}

/** Stops everything and confirms: all tracks ended and the SDK idle. Always answers with a status. */
async function stop(): Promise<void> {
  const a = active
  active = null
  if (!a) {
    ovra.send('capture:status', 'idle')
    return
  }
  ovra.send('capture:status', 'stopping')
  clearInterval(a.flush)
  clearInterval(a.diag)
  try {
    await a.sdk.stop()
  } catch (err) {
    ovra.send('capture:error', { code: 'stop-failed', message: errMsg(err), retryable: true })
  }
  const idle = await waitStopped(a.sdk)
  a.cleanup()
  for (const s of a.streams) for (const t of s.getTracks()) t.stop()
  const ended = a.streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended'))
  a.finishDiagnostics?.()
  a.sdk.destroy()
  if (ended && idle) {
    ovra.send('capture:status', 'idle')
  } else {
    ovra.send('capture:error', {
      code: 'stop-incomplete',
      message: `Capture did not fully stop (tracks ended: ${ended}, SDK idle: ${idle})`,
      retryable: true
    })
    ovra.send('capture:status', 'error')
  }
}

// Serialise start/stop so a quick stop → start never overlaps two SDK instances.
const enqueue = (fn: () => Promise<void>): void => {
  queue = queue
    .then(fn)
    .catch((err) =>
      ovra.send('capture:error', { code: 'capture', message: errMsg(err), retryable: true })
    )
}
ovra.on('push:capture-start', (req) => enqueue(() => start(req)))
ovra.on('push:capture-stop', () => enqueue(stop))
