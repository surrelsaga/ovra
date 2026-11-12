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
import type { CaptureStartRequest, MetricsSnapshot } from '@shared/types'
import { captureConfig as cfg } from './config'
import { mergeSnapshots, reduceMetrics, type FrameSize } from './reduce'

interface Active {
  sdk: SmartSpectraSDK
  /** Every stream we know of (ours or SDK-acquired); all tracks must end on stop. */
  streams: MediaStream[]
  cleanup: () => void
  flush: ReturnType<typeof setInterval>
}

const ovra = window.ovra
let active: Active | null = null
let queue = Promise.resolve()

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function fileUrl(path: string): string {
  return 'file://' + encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

/**
 * Dev video source: hidden <video> → 1280×720 canvas (scaled down, black padding at the bottom
 * so the SDK's chest check passes) → captureStream. Frames stay in memory.
 */
async function fileStream(
  path: string,
  framingPad: number
): Promise<{ stream: MediaStream; cleanup: () => void }> {
  const video = document.createElement('video')
  video.muted = true
  video.loop = true
  video.playsInline = true
  video.src = fileUrl(path)
  await video.play()

  const canvas = document.createElement('canvas')
  canvas.width = cfg.width
  canvas.height = cfg.height
  const g = canvas.getContext('2d')
  if (!g) throw new Error('No 2D canvas context')
  const pad = Math.min(0.6, Math.max(0, framingPad))
  const h = Math.round(cfg.height * (1 - pad))
  const w = Math.round((video.videoWidth * h) / video.videoHeight)
  let running = true
  const draw = (): void => {
    if (!running) return
    g.fillStyle = '#000'
    g.fillRect(0, 0, cfg.width, cfg.height)
    g.drawImage(video, (cfg.width - w) / 2, 0, w, h)
    video.requestVideoFrameCallback(draw)
  }
  video.requestVideoFrameCallback(draw)

  return {
    stream: canvas.captureStream(cfg.fps),
    cleanup: () => {
      running = false
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }
}

async function waitIdle(sdk: SmartSpectraSDK): Promise<boolean> {
  const until = Date.now() + cfg.idleWaitMs
  while (sdk.processingStatus > ProcessingStatus.kIdle && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 50))
  }
  return sdk.processingStatus <= ProcessingStatus.kIdle
}

async function start(req: CaptureStartRequest): Promise<void> {
  await stop()
  ovra.send('capture:status', 'starting')

  const sdk = new SmartSpectraSDK({
    apiKey: req.apiKey,
    requestedMetrics: [...breathingMetrics, ...cardioMetrics, ...(req.face ? faceMetrics : [])],
    enableTelemetry: req.telemetry // SDK default is true: always pass it
  })
  let frame: FrameSize = { width: cfg.width, height: cfg.height }
  let pending: MetricsSnapshot | null = null
  let lastCode: number | null = null
  const a: Active = {
    sdk,
    streams: [],
    cleanup: () => {},
    flush: setInterval(() => {
      if (!pending) return
      ovra.send('capture:metrics', pending)
      pending = null
    }, 1000 / cfg.maxSendsPerSec)
  }
  active = a

  sdk.on('metrics', (buf) => {
    pending = mergeSnapshots(pending, reduceMetrics(decodeMetrics(buf), frame, Date.now()))
  })
  sdk.on('validationStatus', (code, _ts, hint) => {
    if (code === lastCode) return
    lastCode = code
    ovra.send('capture:validation', { t: Date.now(), code, hint })
  })
  sdk.on('error', (code, message, retryable) =>
    ovra.send('capture:error', { code, message, retryable })
  )
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
    }
    // Camera source: the SDK acquires the camera itself and reports it via 'streamAvailable'.
    await sdk.start()
    if (active === a) ovra.send('capture:status', 'running')
  } catch (err) {
    ovra.send('capture:error', { code: 'start-failed', message: errMsg(err), retryable: true })
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
  try {
    await a.sdk.stop()
  } catch (err) {
    ovra.send('capture:error', { code: 'stop-failed', message: errMsg(err), retryable: true })
  }
  const idle = await waitIdle(a.sdk)
  a.cleanup()
  for (const s of a.streams) for (const t of s.getTracks()) t.stop()
  const ended = a.streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended'))
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
