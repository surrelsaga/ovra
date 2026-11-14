// Dev simulator: a SensingService with the real one's observable contract (src/main/sdk/index.ts),
// fed by synthetic snapshots instead of the camera. Never touches the camera, the SDK or a capture window.
import type {
  Bus,
  CameraMode,
  MetricsSnapshot,
  PrivacyService,
  SensingPhase,
  SensingService,
  SimAction,
  SimScenario
} from '@shared/types'
import { simConfig as cfg, type SimTiming } from './config'

type ActivePhase = Exclude<SensingPhase, 'idle'>

export interface ActiveAction {
  kind: SimAction
  /** 0 → 1 over the action. */
  progress: number
}

/** One synthetic snapshot. `n` is the sample index (drives noise and blinks). */
export function synthSnapshot(
  scenario: SimScenario,
  n: number,
  t: number,
  action: ActiveAction | null = null
): MetricsSnapshot {
  if (scenario === 'away') return { t, face: { present: true } }
  const p = cfg.profiles[scenario]
  const b = cfg.baseline
  const a = cfg.actions
  const wobble = 1 + cfg.noise * Math.sin(n * 1.7 + Math.cos(n * 0.3))
  const reading = (v: number): MetricsSnapshot['pulse'] => ({
    value: v * wobble,
    confidence: 90,
    stable: true
  })
  const pulse = b.pulse * p.pulse
  const slows = action?.kind === 'breathing-slows' ? 1 - a.breathingDrop * action.progress : 1
  const rmssd = b.rmssd * p.rmssd * wobble
  const standing = action?.kind === 'stand-up'
  const roll =
    action?.kind === 'tilt-left' ? -a.tiltDeg : action?.kind === 'tilt-right' ? a.tiltDeg : 0
  return {
    t,
    pulse: reading(pulse),
    breathing: reading(b.breathing * p.breathing * slows),
    hrv: {
      rmssd,
      meanNn: 60_000 / pulse,
      sdnn: rmssd * 0.9,
      baevsky: b.baevsky / p.rmssd,
      confidence: 90,
      stable: true
    },
    face: {
      present: true,
      blinking: n % p.blinkEvery === 0,
      talking: false,
      expressions: p.expressions,
      headRollDeg: roll + 2 * Math.sin(n),
      center: { x: cfg.face.center.x, y: standing ? a.standCenterY : cfg.face.center.y },
      size: standing ? a.standSize : cfg.face.size
    }
  }
}

export interface SimulatedSensing extends SensingService {
  scenario(): SimScenario
  setScenario(scenario: SimScenario): void
  action(kind: SimAction): void
}

export function createSimulatedSensing(
  bus: Bus,
  privacy: PrivacyService,
  timing: () => SimTiming
): SimulatedSensing {
  let current: ActivePhase | null = null
  let mode: CameraMode | null = null
  let paused = false
  let scenario: SimScenario = 'calm'
  let act: { kind: SimAction; at: number } | null = null
  let n = 0
  let schedule: ReturnType<typeof setInterval> | undefined
  let sampler: ReturnType<typeof setInterval> | undefined
  let progressTimer: ReturnType<typeof setInterval> | undefined
  let phaseTimer: ReturnType<typeof setTimeout> | undefined

  const report = (err: unknown): void =>
    bus.emit('sdk:error', {
      code: 'sensing',
      message: err instanceof Error ? err.message : String(err),
      retryable: true
    })

  const activeAction = (now: number): ActiveAction | null => {
    if (!act) return null
    const progress = (now - act.at) / cfg.actions.durationMs
    if (progress >= 1) act = null
    return act && { kind: act.kind, progress }
  }

  const sample = (): void => {
    if (!current || !privacy.canUseCamera()) return
    const now = Date.now()
    // Calibration always sees calm values, whatever scenario is picked.
    const s = synthSnapshot(
      current === 'calibration' ? 'calm' : scenario,
      n++,
      now,
      activeAction(now)
    )
    if (!privacy.canUseFace()) delete s.face
    bus.emit('sdk:metrics', s)
  }

  /** Ends the active phase; ended is always emitted for a phase that started. */
  const end = (): void => {
    clearInterval(sampler)
    clearInterval(progressTimer)
    clearTimeout(phaseTimer)
    sampler = progressTimer = phaseTimer = undefined
    const phase = current
    if (!phase) return
    current = null
    bus.emit('sdk:checkin-ended', { phase })
  }

  async function run(phase: ActivePhase, durationMs?: number): Promise<void> {
    // A phase that can't run still reports ended, so callers waiting on it never hang.
    const skip = (): void => bus.emit('sdk:checkin-ended', { phase })
    try {
      privacy.assertCameraConsent()
    } catch (err) {
      skip()
      throw err
    }
    if (paused) return skip()
    end()
    current = phase
    bus.emit('sdk:checkin-started', { phase })
    sample()
    sampler = setInterval(sample, cfg.sampleMs)
    if (durationMs === undefined) return
    const startedAt = Date.now()
    const progress = (): void =>
      bus.emit('sdk:calibration-progress', {
        progress: Math.min(1, (Date.now() - startedAt) / durationMs),
        hint: null
      })
    if (phase === 'calibration') {
      progress()
      progressTimer = setInterval(progress, 1_000)
    }
    phaseTimer = setTimeout(() => {
      if (phase === 'calibration') progress()
      end()
      // A timed phase hands over to continuous, unless something already started a phase.
      if (mode === 'continuous' && !paused && !current) run('continuous').catch(report)
    }, durationMs)
  }

  const clearSchedule = (): void => {
    clearInterval(schedule)
    schedule = undefined
  }

  const service: SimulatedSensing = {
    startCalibration: () => run('calibration', timing().calibrationMs),
    // ponytail: synthetic data has no framing to check.
    skipFraming: () => {},

    startCheckins(intervalMin) {
      privacy.assertCameraConsent()
      clearSchedule()
      mode = 'checkins'
      if (current === 'continuous') end()
      schedule = setInterval(
        () => {
          if (!current && !paused) run('checkin', timing().checkinMs).catch(report)
        },
        timing().checkinIntervalMs ?? intervalMin * 60_000
      )
    },

    async startContinuous() {
      clearSchedule()
      mode = 'continuous'
      if (!current) await run('continuous')
    },

    startReturnCheck: () => run('return-check', timing().returnCheckMs),

    async stop() {
      clearSchedule()
      mode = null
      end()
    },

    async pause() {
      if (paused) return
      paused = true
      end()
      bus.emit('privacy:camera-paused', {})
    },

    async resume() {
      if (!paused) return
      end()
      paused = false
      bus.emit('privacy:camera-resumed', {})
      if (mode === 'continuous') await run('continuous')
    },

    phase: () => current ?? 'idle',
    scenario: () => scenario,
    setScenario(next) {
      scenario = next
    },
    action(kind) {
      act = { kind, at: Date.now() }
    }
  }

  bus.on('privacy:changed', () => {
    if (!privacy.canUseCamera()) void service.stop()
  })

  return service
}
