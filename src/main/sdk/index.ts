// Owner: Agent A (sensing). SmartSpectra setup, check-in scheduler, calibration, return check,
// dev video source. Capture runs in a hidden renderer (src/renderer/capture/).
import { app, BrowserWindow, session, type IpcMainEvent } from 'electron'
import { bindSmartSpectraIpc } from '@smartspectra/node-sdk/main'
import type {
  Bus,
  CameraMode,
  CaptureStartRequest,
  PrivacyService,
  SensingPhase,
  SensingService
} from '@shared/types'
import { onCapture, push } from '../ipc'
import { loadPage, preloadPath } from '../paths'
import { sensingConfig, type SensingConfig } from './config'
import { nativeWork } from './native-work'
import { createValidationSmoother } from './hint'

export interface SensingDeps {
  bus: Bus
  privacy: PrivacyService
  /** Returns the Presage key, or null if missing. Never log it. */
  getApiKey: () => string | null
  /** Overrides for tests and the dev harness. */
  config?: Partial<SensingConfig>
}

type ActivePhase = Exclude<SensingPhase, 'idle'>

/** Own session so the media permission handler can't leak to (or be replaced by) other windows. */
const PARTITION = 'ovra-capture'

export function createSensing(deps: SensingDeps): SensingService {
  const { bus, privacy } = deps
  const cfg = { ...sensingConfig, ...deps.config }
  const smoother = createValidationSmoother(cfg.hintPersistMs)

  let win: BrowserWindow | null = null
  let winReady: Promise<BrowserWindow> | null = null
  let current: ActivePhase | null = null
  let mode: CameraMode | null = null
  let paused = false
  /** Bumped by stop/pause so an in-flight start doesn't turn the camera back on. */
  let gen = 0
  let schedule: ReturnType<typeof setInterval> | null = null
  let phaseTimer: ReturnType<typeof setTimeout> | null = null
  let progressTimer: ReturnType<typeof setInterval> | null = null
  let stopping: Promise<void> | null = null
  let stopWaiter: ((stopped: boolean) => void) | null = null
  let listening = false
  let phaseDeadline: number | undefined
  let faceEnabled = privacy.canUseFace()

  const report = (err: unknown): void =>
    bus.emit('sdk:error', {
      code: 'sensing',
      message: err instanceof Error ? err.message : String(err),
      retryable: true
    })

  const fromCapture = (e: IpcMainEvent): boolean =>
    !!win && !win.isDestroyed() && e.sender === win.webContents

  const resolveStop = (stopped: boolean): void => {
    stopWaiter?.(stopped)
    stopWaiter = null
  }

  function flushValidation(): void {
    if (!current) return
    const ev = smoother.poll(Date.now())
    if (ev) bus.emit('sdk:validation', ev)
  }

  function listen(): void {
    if (listening) return
    listening = true
    onCapture('capture:metrics', (m, e) => {
      if (!fromCapture(e) || !current || !privacy.canUseCamera()) return
      if (privacy.canUseFace()) bus.emit('sdk:metrics', m)
      else {
        const vitals = { ...m }
        delete vitals.face
        bus.emit('sdk:metrics', vitals)
      }
    })
    onCapture('capture:validation', (v, e) => {
      if (!fromCapture(e) || !current) return
      smoother.push(v, Date.now())
      setTimeout(flushValidation, cfg.hintPersistMs)
    })
    onCapture('capture:error', (err, e) => {
      if (!fromCapture(e)) return
      bus.emit('sdk:error', err)
      if (!err.retryable || err.code === 'start-failed') stopCapture().catch(report)
    })
    onCapture('capture:status', (s, e) => {
      if (fromCapture(e) && (s === 'idle' || s === 'error')) resolveStop(s === 'idle')
    })
  }

  const devVideo = (): string | null =>
    app.isPackaged ? null : privacy.getSettings().devVideoSource

  function createWindow(): Promise<BrowserWindow> {
    const ses = session.fromPartition(PARTITION)
    const w = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      webPreferences: {
        preload: preloadPath('capture'),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
        session: ses,
        // ponytail: dev video source only. The dev page is served over http, which may not load
        // file:// media; never relaxed in packaged builds or with the real camera.
        webSecurity: !devVideo()
      }
    })
    // Camera (video only) for this window; deny every other permission.
    ses.setPermissionRequestHandler((wc, permission, cb, details) =>
      cb(
        permission === 'media' &&
          wc.id === w.webContents.id &&
          !('mediaTypes' in details && details.mediaTypes?.includes('audio'))
      )
    )
    ses.setPermissionCheckHandler(
      (wc, permission) => permission === 'media' && wc?.id === w.webContents.id
    )
    w.webContents.on('render-process-gone', (_e, d) => {
      bus.emit('sdk:error', {
        code: 'capture-gone',
        message: `Capture renderer exited (${d.reason})`,
        retryable: true
      })
      w.destroy()
    })
    w.on('closed', () => {
      if (win !== w) return
      win = null
      winReady = null
      resolveStop(true)
      if (current) stopCapture().catch(report)
    })
    win = w
    nativeWork.start()
    bindSmartSpectraIpc(w)
    listen()
    return loadPage(w, 'capture').then(
      () => w,
      (err) => {
        w.destroy()
        throw err
      }
    )
  }

  function ensureWindow(): Promise<BrowserWindow> {
    if (!winReady || !win || win.isDestroyed()) winReady = createWindow()
    return winReady
  }

  function clearPhaseTimers(): void {
    if (phaseTimer) clearTimeout(phaseTimer)
    if (progressTimer) clearInterval(progressTimer)
    phaseTimer = progressTimer = null
  }

  function clearSchedule(): void {
    if (schedule) clearInterval(schedule)
    schedule = null
  }

  /** Keep the camera indicator on until tracks have ended or the capture context is destroyed. */
  async function stopCapture(): Promise<void> {
    clearPhaseTimers()
    if (stopping) return stopping
    const phase = current
    if (!phase) return
    stopping = (async () => {
      const w = win
      if (w && !w.isDestroyed()) {
        let timeout: ReturnType<typeof setTimeout>
        const stopped = new Promise<boolean>((resolve) => {
          stopWaiter = resolve
          timeout = setTimeout(() => resolveStop(false), cfg.stopTimeoutMs)
        })
        try {
          push(w, 'push:capture-stop', {})
        } catch {
          resolveStop(false)
        }
        const confirmed = await stopped
        clearTimeout(timeout!)
        if (!confirmed && !w.isDestroyed()) {
          report(new Error('Capture did not confirm stopping; closing the capture window.'))
          // A missing/failed stop ack must close the capture context before hiding the camera ring.
          await new Promise<void>((resolve) => {
            w.once('closed', resolve)
            w.destroy()
          })
        }
      }
      current = null
      bus.emit('sdk:checkin-ended', { phase })
    })()
    try {
      await stopping
    } finally {
      stopping = null
    }
  }

  function emitProgress(startedAt: number, durationMs: number): void {
    const progress = Math.min(1, (Date.now() - startedAt) / durationMs)
    bus.emit('sdk:calibration-progress', { progress, hint: smoother.hint() })
  }

  async function endTimed(g: number): Promise<void> {
    await stopCapture()
    if (g === gen && mode === 'continuous' && !paused) await runCapture('continuous')
  }

  async function runCapture(phase: ActivePhase, durationMs?: number): Promise<void> {
    // A phase that can't run still reports ended, so callers waiting on it (session) never hang.
    const skip = (): void => bus.emit('sdk:checkin-ended', { phase })
    let started = false
    try {
      privacy.assertCameraConsent() // no camera code before consent
      if (paused) return skip()
      const apiKey = deps.getApiKey()
      if (!apiKey) {
        bus.emit('sdk:error', {
          code: 'no-api-key',
          message: 'The Presage API key is missing. Set PRESAGE_API_KEY in .env.',
          retryable: false
        })
        return skip()
      }
      const g = ++gen
      await stopCapture()
      if (g !== gen) return
      if (paused) return skip()
      const w = await ensureWindow()
      if (g !== gen) return
      if (paused) return skip()

      const settings = privacy.getSettings()
      const file = devVideo()
      const req: CaptureStartRequest = {
        phase,
        apiKey,
        source: file
          ? { kind: 'file', path: file, framingPad: settings.devFramingPad }
          : { kind: 'camera' },
        face: privacy.canUseFace(),
        telemetry: privacy.get().telemetry === true,
        durationMs
      }
      current = phase
      started = true
      smoother.reset()
      bus.emit('sdk:checkin-started', { phase })
      push(w, 'push:capture-start', req)

      if (durationMs === undefined) return
      const startedAt = Date.now()
      phaseDeadline = startedAt + durationMs
      phaseTimer = setTimeout(() => {
        if (phase === 'calibration') emitProgress(startedAt, durationMs)
        endTimed(g).catch(report)
      }, durationMs)
      if (phase === 'calibration') {
        emitProgress(startedAt, durationMs)
        progressTimer = setInterval(() => emitProgress(startedAt, durationMs), cfg.progressEveryMs)
      }
    } catch (err) {
      if (started) await stopCapture()
      else skip()
      throw err
    }
  }

  bus.on('privacy:changed', () => {
    const face = privacy.canUseFace()
    const changed = face !== faceEnabled
    faceEnabled = face
    if (!privacy.canUseCamera()) {
      void service.stop().catch(report)
      return
    }
    if (changed && current) {
      const duration =
        current === 'continuous'
          ? undefined
          : Math.max(0, (phaseDeadline ?? Date.now()) - Date.now())
      void runCapture(current, duration).catch(report)
    }
  })

  const service: SensingService = {
    startCalibration: () => runCapture('calibration', cfg.calibrationMs),

    startCheckins(intervalMin) {
      privacy.assertCameraConsent()
      clearSchedule()
      mode = 'checkins'
      if (current === 'continuous') stopCapture().catch(report)
      schedule = setInterval(
        () => {
          if (!current && !paused) runCapture('checkin', cfg.checkinMs).catch(report)
        },
        cfg.checkinIntervalMs ?? intervalMin * 60_000
      )
    },

    async startContinuous() {
      clearSchedule()
      mode = 'continuous'
      // A timed phase (calibration, check-in, return check) hands over to continuous when it ends.
      if (!current) await runCapture('continuous')
    },

    startReturnCheck: () => runCapture('return-check', cfg.returnCheckMs),

    async stop() {
      gen++
      clearSchedule()
      mode = null
      await stopCapture()
      // Forget the window first: close() is async and a new phase must not reuse it.
      const w = win
      win = null
      winReady = null
      if (w && !w.isDestroyed()) {
        await new Promise<void>((resolve) => {
          w.once('closed', resolve)
          w.destroy()
        })
      }
      await nativeWork.settle()
    },

    async pause() {
      if (paused) return
      paused = true
      gen++
      await stopCapture()
      bus.emit('privacy:camera-paused', {})
    },

    async resume() {
      if (!paused) return
      await stopCapture()
      paused = false
      bus.emit('privacy:camera-resumed', {})
      if (mode === 'continuous') await runCapture('continuous')
    },

    phase: () => current ?? 'idle'
  }
  return service
}
