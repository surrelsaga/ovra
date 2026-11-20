// Owner: Agent A (sensing). SmartSpectra setup, check-in scheduler, calibration, return check,
// dev video source. Capture runs in a hidden renderer (src/renderer/capture/).
import { existsSync } from 'node:fs'
import { app, BrowserWindow, session, type IpcMainEvent } from 'electron'
import { bindSmartSpectraIpc } from '@smartspectra/node-sdk/main'
import type {
  Bus,
  CaptureDiagnostics,
  CaptureStatus,
  CameraMode,
  MetricsSnapshot,
  CaptureStartRequest,
  PrivacyService,
  SdkError,
  SensingPhase,
  SensingService
} from '@shared/types'
import { ValidationCode } from '@shared/types'
import { buildBaseline, hasFace, steadyPulseSec } from '../state/classifier'
import { resolveConfig } from '../state/config'
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
  // Fills the caller's object and keeps reading it, so demo mode can change timings in place.
  const cfg: SensingConfig = Object.assign(deps.config ?? {}, { ...sensingConfig, ...deps.config })
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
  /** Calibration cap: its timeout callback, and the time left while paused for an SDK restart. */
  let capFire: (() => void) | null = null
  let capLeftMs: number | null = null
  let validationCode: number | null = null
  let noFaceFound = false
  /**
   * Framing check, then the calibration clock: okSince = when the smoothed code turned OK, clockAt =
   * when the clock started (OK held framingHoldMs, or Skip). Only steady pulse after clockAt counts.
   */
  let calibration: {
    hasFrames: boolean
    okSince: number | null
    clockAt: number | null
    pulses: MetricsSnapshot[]
  } | null = null
  let cameraFallbackShown = false
  let cameraId = privacy.getSettings().cameraId
  let faceEnabled = privacy.canUseFace()
  let telemetryEnabled = privacy.get().telemetry
  /** The session's camera mode: a continuous session keeps the calibration stream running. */
  let sessionMode: CameraMode | null = null
  /** The running stream's start request, reused to restart it after an SDK crash. */
  let lastReq: CaptureStartRequest | null = null
  let captureStatus: CaptureStatus = 'idle'
  /**
   * SDK crash recovery (decision 48). down: waiting out the backoff, or a restart was sent and
   * hasn't reported running yet. upSince: last time the stream reported running.
   */
  let down: 'waiting' | 'starting' | null = null
  let attempts = 0
  let upSince: number | null = null
  let networkTrouble = false
  let restartTimer: ReturnType<typeof setTimeout> | null = null

  const report = (err: unknown): void =>
    bus.emit('sdk:error', {
      code: 'sensing',
      message: err instanceof Error ? err.message : String(err),
      retryable: true
    })

  const looksNetwork = (err: SdkError): boolean =>
    (typeof err.code === 'number' && cfg.networkErrorCodes.includes(err.code)) ||
    cfg.networkErrorPattern.test(err.message)

  function clearRecovery(): void {
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = null
    down = null
  }

  /** Fresh phase: a full set of restarts and no memory of earlier trouble. */
  function resetRecovery(): void {
    clearRecovery()
    attempts = 0
    upSince = null
    networkTrouble = false
  }

  /**
   * The SDK is dead (terminal error, kError status, or frames refused). Restart the same stream
   * after a short backoff without ending the logical phase; give up when the attempts run out.
   */
  function sdkDied(err: SdkError): void {
    if (!current || down === 'waiting' || stopping) return
    if (upSince !== null && Date.now() - upSince >= cfg.restartHealthyMs) {
      attempts = 0
      networkTrouble = false
    }
    upSince = null
    networkTrouble ||= looksNetwork(err)
    const message = networkTrouble ? cfg.networkMessage : cfg.lostMessage
    if (attempts >= cfg.restartBackoffMs.length) {
      clearRecovery()
      if (!app.isPackaged) console.warn(`[sensing] SDK restarts used up; giving up: ${message}`)
      bus.emit('sdk:error', { code: 'sdk-lost', message, retryable: false })
      stopCapture().catch(report)
      return
    }
    const wait = cfg.restartBackoffMs[attempts++]
    if (!app.isPackaged)
      console.warn(
        `[sensing] SDK down; restart ${attempts}/${cfg.restartBackoffMs.length} in ${wait} ms`
      )
    if (!down) {
      pauseCap()
      bus.emit('sdk:reconnecting', { active: true, message })
    }
    down = 'waiting'
    const g = gen
    restartTimer = setTimeout(() => {
      restartTimer = null
      if (g !== gen || !current || !lastReq || !win || win.isDestroyed()) return
      down = 'starting'
      // The capture renderer stops the dead SDK instance before starting a fresh one.
      lastReq = { ...lastReq, phase: current }
      push(win, 'push:capture-start', lastReq)
    }, wait)
  }

  const fromCapture = (e: IpcMainEvent): boolean =>
    !!win && !win.isDestroyed() && e.sender === win.webContents

  const resolveStop = (stopped: boolean): void => {
    stopWaiter?.(stopped)
    stopWaiter = null
  }

  function flushValidation(): void {
    if (!current) return
    const ev = smoother.poll(Date.now())
    if (ev) {
      noFaceFound = ev.code === ValidationCode.noFaceFound
      if (calibration) calibration.okSince = ev.code === ValidationCode.ok ? Date.now() : null
      bus.emit('sdk:validation', ev)
    }
  }

  function listen(): void {
    if (listening) return
    listening = true
    onCapture('capture:metrics', (m, e) => {
      if (!fromCapture(e) || !current || !privacy.canUseCamera()) return
      if (calibration) calibration.hasFrames = true
      const face = privacy.canUseFace()
      if (!face) {
        m = { ...m }
        delete m.face
      }
      const code = m.validationCode ?? validationCode
      if (code !== null) m = { ...m, validationCode: code }
      // Raw no-face overrides presence immediately; only the displayed hint is debounced.
      if (code === ValidationCode.noFaceFound)
        m = face
          ? { t: m.t, validationCode: code, face: { present: false } }
          : { t: m.t, validationCode: code }
      else if (code === ValidationCode.multipleFaces && m.face)
        m = { ...m, face: { present: false } }
      if (calibration && !noFaceFound && hasFace(m, face) && m.pulse?.stable) {
        // A steady pulse only comes with code 0, so it also proves framing if no OK code arrived.
        if (calibration.clockAt === null) calibration.okSince ??= Date.now()
        else calibration.pulses.push({ t: m.t, pulse: m.pulse })
      }
      bus.emit('sdk:metrics', m)
    })
    onCapture('capture:diag', (diag: CaptureDiagnostics, e) => {
      if (
        !app.isPackaged &&
        process.env.OVRA_MONITOR === '1' &&
        fromCapture(e) &&
        // A logical phase (return check, calibration handed over) keeps the stream's phase label.
        current !== null &&
        diag.phase === lastReq?.phase &&
        privacy.canUseCamera()
      )
        bus.emit('monitor:diag', { ...diag, phase: current! })
    })
    onCapture('capture:validation', (v, e) => {
      if (!fromCapture(e) || !current) return
      // Validation arrives per frame even when framing prevents any metrics.
      if (calibration) calibration.hasFrames = true
      validationCode = v.code
      smoother.push(v, Date.now())
      setTimeout(flushValidation, cfg.hintPersistMs)
    })
    onCapture('capture:error', (raw, e) => {
      if (!fromCapture(e)) return
      if (raw.code === 'camera-fallback') {
        if (!current || !privacy.canUseCamera()) return
        if (!cameraFallbackShown) {
          cameraFallbackShown = true
          bus.emit('orb:bubble', { text: raw.message })
        }
        return
      }
      // SDK messages are untrusted text: never let a key through to logs.
      const key = deps.getApiKey()
      const err = key ? { ...raw, message: raw.message.split(key).join('[key]') } : raw
      if (!app.isPackaged)
        console.warn(
          `[sensing] SDK error code=${err.code} retryable=${err.retryable} message=${JSON.stringify(err.message)}`
        )
      const dead =
        !err.retryable ||
        err.code === 'start-failed' ||
        // While restarting, any SDK error (e.g. its startup watchdog) means this attempt failed.
        (down === 'starting' && typeof err.code === 'number')
      // Ovra retries the SDK itself, so only giving up ('sdk-lost') is non-retryable on the bus.
      bus.emit('sdk:error', { ...err, retryable: true })
      if (dead) sdkDied(err)
    })
    onCapture('capture:status', (s, e) => {
      if (!fromCapture(e)) return
      captureStatus = s
      bus.emit('monitor:capture-status', { status: s })
      if (s === 'idle' || s === 'error') resolveStop(s === 'idle')
      if (s !== 'running' || !current) return
      upSince = Date.now()
      if (down !== 'starting') return
      down = null
      resumeCap()
      bus.emit('sdk:reconnecting', { active: false })
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
          privacy.canUseCamera() &&
          wc.id === w.webContents.id &&
          !('mediaTypes' in details && details.mediaTypes?.includes('audio'))
      )
    )
    ses.setPermissionCheckHandler(
      (wc, permission) =>
        permission === 'media' && privacy.canUseCamera() && wc?.id === w.webContents.id
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
    bindSmartSpectraIpc(w, {
      logger: (level, msg) => {
        const line = `[smartspectra/main] ${msg}`
        if (level === 'error') console.error(line)
        else if (level === 'warn') console.warn(line)
        else console.log(line)
        // A dead pipeline refuses every frame; only the SDK's own log says so.
        if (win === w && captureStatus === 'running' && cfg.deadPipelinePattern.test(msg))
          sdkDied({ code: 'frames-refused', message: msg, retryable: false })
      }
    })
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
    capFire = null
    capLeftMs = null
  }

  /** An outage doesn't eat calibration time: stop the cap while the SDK restarts. */
  function pauseCap(): void {
    if (current !== 'calibration' || !phaseTimer || phaseDeadline === undefined) return
    clearTimeout(phaseTimer)
    phaseTimer = null
    capLeftMs = Math.max(0, phaseDeadline - Date.now())
  }

  function resumeCap(): void {
    if (capLeftMs === null || !capFire || current !== 'calibration') return
    phaseDeadline = Date.now() + capLeftMs
    phaseTimer = setTimeout(capFire, capLeftMs)
    capLeftMs = null
  }

  function clearSchedule(): void {
    if (schedule) clearInterval(schedule)
    schedule = null
  }

  /** Keep the camera indicator on until tracks have ended or the capture context is destroyed. */
  async function stopCapture(): Promise<void> {
    clearPhaseTimers()
    clearRecovery()
    calibration = null
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

  const stateCfg = (): ReturnType<typeof resolveConfig> =>
    resolveConfig(privacy.getSettings().thresholdOverrides)

  /** Starts the clock once OK has held, then reports seconds of steady pulse toward the bar. */
  function emitProgress(): void {
    const c = calibration
    if (!c) return
    if (
      c.clockAt === null &&
      !down &&
      c.okSince !== null &&
      Date.now() - c.okSince >= cfg.framingHoldMs
    )
      c.clockAt = Date.now()
    const progress =
      c.clockAt === null
        ? 0
        : Math.min(1, steadyPulseSec(c.pulses) / stateCfg().baselineMinPulseSec)
    bus.emit('sdk:calibration-progress', {
      progress,
      hint: down ? cfg.reconnectingText : smoother.hint(),
      framing: c.clockAt === null,
      starting: !down && (captureStatus !== 'running' || !c.hasFrames)
    })
  }

  /**
   * Continuous session: calibration ends as a logical phase on the running stream (no stop/start),
   * so the SDK's 12/30/60 s warm-ups carry into continuous mode, like the return check.
   */
  function handOver(g: number): void {
    if (g !== gen || current !== 'calibration') return
    clearPhaseTimers()
    calibration = null
    current = 'continuous'
    // The state builds the baseline here; on success the session's startContinuous() is a no-op.
    bus.emit('sdk:checkin-ended', { phase: 'calibration' })
    if (g === gen && current === 'continuous')
      bus.emit('sdk:checkin-started', { phase: 'continuous' })
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
      if (file && !existsSync(file))
        console.warn(
          `[sensing] dev video source "${file}" doesn't exist, so the camera can't start. ` +
            'Clear devVideoSource in Settings or settings.json.'
        )
      const req: CaptureStartRequest = {
        phase,
        apiKey,
        source: file
          ? { kind: 'file', path: file, framingPad: settings.devFramingPad }
          : { kind: 'camera', cameraId: settings.cameraId },
        face: privacy.canUseFace(),
        telemetry: privacy.get().telemetry === true,
        diagnostics: !app.isPackaged && process.env.OVRA_MONITOR === '1',
        durationMs: phase === 'calibration' ? (durationMs ?? cfg.calibrationMaxMs) : durationMs
      }
      current = phase
      started = true
      lastReq = req
      resetRecovery()
      smoother.reset()
      validationCode = null
      noFaceFound = false
      calibration =
        phase === 'calibration'
          ? { hasFrames: false, okSince: null, clockAt: null, pulses: [] }
          : null
      captureStatus = 'starting'
      bus.emit('sdk:checkin-started', { phase })
      push(w, 'push:capture-start', req)

      if (req.durationMs === undefined) return
      phaseDeadline = Date.now() + req.durationMs
      const fire = (): void => {
        if (phase === 'calibration') emitProgress()
        endTimed(g).catch(report)
      }
      phaseTimer = setTimeout(fire, req.durationMs)
      if (phase === 'calibration') capFire = fire
      if (phase === 'calibration') {
        emitProgress()
        progressTimer = setInterval(() => {
          emitProgress()
          if (calibration?.clockAt == null) return
          // Reuse the state's bar so insufficient readings get until the hard cap.
          if (!('baseline' in buildBaseline(calibration.pulses, stateCfg(), Date.now()))) return
          if (sessionMode === 'continuous' && !paused && !down) handOver(g)
          else endTimed(g).catch(report)
        }, cfg.progressEveryMs)
      }
    } catch (err) {
      if (started) await stopCapture()
      else skip()
      throw err
    }
  }

  bus.on('session:started', (s) => {
    sessionMode = s.config.cameraMode
  })
  bus.on('session:ended', () => {
    sessionMode = null
  })
  // The state can still disagree with our bar after a hand-over: don't keep the camera on for a
  // failed calibration (the session waits on Try again or Start anyway).
  bus.on('state:baseline-ready', ({ ok }) => {
    if (!ok && current === 'continuous' && mode !== 'continuous') stopCapture().catch(report)
  })

  bus.on('settings:changed', (settings) => {
    if (settings.cameraId === cameraId) return
    cameraId = settings.cameraId
    cameraFallbackShown = false
    if (
      !current ||
      !lastReq ||
      lastReq.source.kind !== 'camera' ||
      !win ||
      stopping ||
      paused ||
      !privacy.canUseCamera()
    )
      return
    // Restart the physical stream without ending calibration or a return check.
    resetRecovery()
    pauseCap()
    down = 'starting'
    smoother.reset()
    validationCode = null
    noFaceFound = false
    if (calibration) {
      calibration = { hasFrames: false, okSince: null, clockAt: null, pulses: [] }
      bus.emit('sdk:checkin-started', { phase: current })
    }
    bus.emit('sdk:reconnecting', { active: true })
    lastReq = { ...lastReq, phase: current, source: { kind: 'camera', cameraId } }
    push(win, 'push:capture-start', lastReq)
  })

  bus.on('privacy:changed', () => {
    const face = privacy.canUseFace()
    const telemetry = privacy.get().telemetry
    const changed = face !== faceEnabled || telemetry !== telemetryEnabled
    faceEnabled = face
    telemetryEnabled = telemetry
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
    startCalibration: () => runCapture('calibration'),

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

    async startReturnCheck() {
      if (mode === 'continuous' && current === 'return-check') return
      if (mode !== 'continuous' || current !== 'continuous')
        return runCapture('return-check', cfg.returnCheckMs)
      // A return is a new evaluation window, not a new SDK stream (warm-ups must survive).
      clearPhaseTimers()
      current = 'return-check'
      bus.emit('sdk:checkin-started', { phase: 'return-check' })
      phaseDeadline = Date.now() + cfg.returnCheckMs
      phaseTimer = setTimeout(() => {
        current = 'continuous'
        bus.emit('sdk:checkin-ended', { phase: 'return-check' })
        bus.emit('sdk:checkin-started', { phase: 'continuous' })
      }, cfg.returnCheckMs)
    },

    skipFraming() {
      if (calibration?.clockAt !== null) return
      calibration.clockAt = Date.now()
      emitProgress()
    },

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
