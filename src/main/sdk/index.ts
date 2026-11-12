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
  const stopWaiters: (() => void)[] = []
  let listening = false

  const report = (err: unknown): void =>
    bus.emit('sdk:error', {
      code: 'sensing',
      message: err instanceof Error ? err.message : String(err),
      retryable: true
    })

  const fromCapture = (e: IpcMainEvent): boolean =>
    !!win && !win.isDestroyed() && e.sender === win.webContents

  const resolveStop = (): void => {
    for (const r of stopWaiters.splice(0)) r()
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
      if (fromCapture(e) && current) bus.emit('sdk:metrics', m)
    })
    onCapture('capture:validation', (v, e) => {
      if (!fromCapture(e) || !current) return
      smoother.push(v, Date.now())
      setTimeout(flushValidation, cfg.hintPersistMs)
    })
    onCapture('capture:error', (err, e) => {
      if (fromCapture(e)) bus.emit('sdk:error', err)
    })
    onCapture('capture:status', (s, e) => {
      if (fromCapture(e) && (s === 'idle' || s === 'error')) resolveStop()
    })
  }

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
        session: ses
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
    w.webContents.on('render-process-gone', (_e, d) =>
      bus.emit('sdk:error', {
        code: 'capture-gone',
        message: `Capture renderer exited (${d.reason})`,
        retryable: true
      })
    )
    w.on('closed', () => {
      if (win === w) {
        win = null
        winReady = null
      }
      resolveStop()
    })
    win = w
    bindSmartSpectraIpc(w)
    listen()
    return loadPage(w, 'capture').then(() => w)
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

  /** Stops capture and waits until the renderer confirms the stream is stopped (or times out). */
  async function stopCapture(): Promise<void> {
    clearPhaseTimers()
    const phase = current
    if (!phase) return
    current = null
    if (win && !win.isDestroyed()) {
      const stopped = new Promise<void>((r) => {
        stopWaiters.push(r)
        setTimeout(r, cfg.stopTimeoutMs)
      })
      push(win, 'push:capture-stop', {})
      await stopped
    }
    bus.emit('sdk:checkin-ended', { phase })
  }

  function emitProgress(startedAt: number, durationMs: number): void {
    const progress = Math.min(1, (Date.now() - startedAt) / durationMs)
    bus.emit('sdk:calibration-progress', { progress, hint: smoother.hint() })
  }

  async function endTimed(): Promise<void> {
    await stopCapture()
    if (mode === 'continuous' && !paused) await runCapture('continuous')
  }

  async function runCapture(phase: ActivePhase, durationMs?: number): Promise<void> {
    privacy.assertCameraConsent() // no camera code before consent
    if (paused) return
    const apiKey = deps.getApiKey()
    if (!apiKey) {
      bus.emit('sdk:error', {
        code: 'no-api-key',
        message: 'The Presage API key is missing. Set PRESAGE_API_KEY in .env.',
        retryable: false
      })
      return
    }
    const g = ++gen
    await stopCapture()
    const w = await ensureWindow()
    if (g !== gen || paused) return

    const settings = privacy.getSettings()
    const file = app.isPackaged ? null : settings.devVideoSource
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
    smoother.reset()
    bus.emit('sdk:checkin-started', { phase })
    push(w, 'push:capture-start', req)

    if (durationMs === undefined) return
    const startedAt = Date.now()
    phaseTimer = setTimeout(() => {
      if (phase === 'calibration') emitProgress(startedAt, durationMs)
      endTimed().catch(report)
    }, durationMs)
    if (phase === 'calibration') {
      emitProgress(startedAt, durationMs)
      progressTimer = setInterval(() => emitProgress(startedAt, durationMs), cfg.progressEveryMs)
    }
  }

  return {
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
      paused = false
      await stopCapture()
      win?.close()
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
      paused = false
      bus.emit('privacy:camera-resumed', {})
      if (mode === 'continuous') await runCapture('continuous')
    },

    phase: () => current ?? 'idle'
  }
}
