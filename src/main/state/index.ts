// Owner: Agent B (state engine). Baseline, smoothing, situation classifier, seated time, away detection.
// Everything here is in-memory only: the baseline and readings are never stored or sent anywhere.
import type {
  Baseline,
  Bus,
  CameraMode,
  FaceSnapshot,
  MetricsSnapshot,
  PrivacyService,
  SensingPhase,
  Situation,
  StateEngine,
  StateUpdate,
  Trend
} from '@shared/types'
import { ValidationCode } from '@shared/types'
import {
  buildBaseline,
  classify,
  evaluateWindow,
  hasFace,
  median,
  type WindowEval
} from './classifier'
import { resolveConfig } from './config'

export { buildBaseline, classify, evaluateWindow } from './classifier'

export interface StateDeps {
  bus: Bus
  privacy: PrivacyService
}

const MAX_HISTORY = 100

export function createStateEngine({ bus, privacy }: StateDeps): StateEngine {
  const cfg = (): ReturnType<typeof resolveConfig> =>
    resolveConfig(privacy.getSettings().thresholdOverrides)

  let mode: CameraMode = 'checkins'
  let baseline: Baseline | null = null
  let baselineFailure: string | null = null
  let calibrationPulseCount = 0
  let calibrationPulseSpanSec = 0
  let phase: Exclude<SensingPhase, 'idle'> | null = null
  let phaseStart = 0
  let buf: MetricsSnapshot[] = []
  let sawFace = false
  let validationCode: number = ValidationCode.ok
  let calibratedFace: Pick<FaceSnapshot, 'center' | 'size'> | undefined
  let wakeBuckets = new Set<number>()
  let history: WindowEval[] = []
  let situation: Situation | null = null
  let confidence = 0
  let trend: Trend = 'steady'
  let seatedSince: number | null = null
  /** Last face seen while the camera is on. Null = camera was off, so the gap doesn't count. */
  let lastFace: number | null = null
  let away = false
  let manualAway = false
  let paused = false
  let lastEval = 0
  let timer: ReturnType<typeof setInterval> | undefined

  const current = (): StateUpdate => {
    const now = Date.now()
    return {
      t: now,
      situation,
      confidence,
      seatedMinutes: seatedSince !== null && !away ? (now - seatedSince) / 60_000 : 0,
      away,
      trend
    }
  }
  const emit = (): void => bus.emit('state:updated', current())

  const stopTimer = (): void => {
    clearInterval(timer)
    timer = undefined
  }

  const reset = (): void => {
    stopTimer()
    baseline = null
    calibratedFace = undefined
    baselineFailure = null
    calibrationPulseCount = calibrationPulseSpanSec = 0
    phase = null
    buf = []
    history = []
    situation = null
    confidence = 0
    trend = 'steady'
    seatedSince = null
    lastFace = null
    validationCode = ValidationCode.ok
    wakeBuckets.clear()
    away = manualAway = paused = false
  }

  function evaluate(snaps: MetricsSnapshot[]): void {
    if (!baseline || snaps.length === 0) return
    const c = cfg()
    const ev = evaluateWindow(snaps, baseline, c)
    if (!ev) return
    history = [...history, ev].slice(-MAX_HISTORY)
    ;({ situation, confidence, trend } = classify(history, mode, situation, c))
  }

  function onFace(t: number): void {
    sawFace = true
    if (seatedSince === null || (lastFace !== null && t - lastFace > cfg().seatedGapSec * 1000)) {
      seatedSince = t
    }
    lastFace = t
  }

  // Continuous mode: away after N s without presence evidence, and a periodic update.
  function tick(): void {
    if (paused || phase !== 'continuous') return
    const now = Date.now()
    const c = cfg()
    if (!away && now - (lastFace ?? phaseStart) >= c.awayNoFaceSec * 1000) {
      away = true
      emit()
    }
    if (now - lastEval >= c.continuousUpdateSec * 1000) {
      lastEval = now
      buf = buf.filter((s) => s.t >= now - c.continuousWindowSec * 1000)
      evaluate(buf)
      emit()
    }
  }

  bus.on('session:started', (s) => {
    mode = s.config.cameraMode
  })

  bus.on('sdk:checkin-started', ({ phase: p }) => {
    phase = p
    phaseStart = lastEval = Date.now()
    buf = []
    sawFace = false
    validationCode = ValidationCode.ok
    wakeBuckets.clear()
    lastFace = null // the camera was off before this; that gap isn't a seated gap
    if (p === 'continuous') {
      stopTimer()
      timer = setInterval(tick, 1000)
    }
  })

  bus.on('sdk:validation', (v) => {
    if (!phase) return
    validationCode = v.code
    if (v.code === ValidationCode.noFaceFound || v.code === ValidationCode.multipleFaces)
      wakeBuckets.clear()
  })

  bus.on('sdk:metrics', (s) => {
    if (!phase || paused || validationCode === ValidationCode.noFaceFound) return
    const c = cfg()
    const pulse = !!s.pulse?.stable && Number.isFinite(s.pulse.value)
    const face =
      validationCode !== ValidationCode.multipleFaces &&
      hasFace({ t: s.t, face: s.face }, privacy.canUseFace(), c, calibratedFace)
    if (!pulse && !face) return
    onFace(s.t)
    buf.push(s)
    const bucket = Math.floor(s.t / 1000)
    wakeBuckets = new Set([...wakeBuckets].filter((b) => b > bucket - c.wakeWindowSec))
    if (face) wakeBuckets.add(bucket)
    // shortcut: a persistent false box at the calibrated seat can wake; revisit if live testing shows it.
    if (away && !manualAway && (pulse || wakeBuckets.size >= c.wakeFaceSec)) {
      away = false
      emit()
    }
  })

  bus.on('sdk:checkin-ended', ({ phase: p }) => {
    if (p !== phase) return
    phase = null
    const snaps = buf
    buf = []
    if (p === 'continuous') {
      stopTimer()
      return
    }
    if (p === 'calibration') {
      const c = cfg()
      const r = buildBaseline(snaps, c, Date.now())
      const pulses = snaps.filter((s) => s.pulse?.stable)
      calibrationPulseCount = pulses.length
      calibrationPulseSpanSec = pulses.length
        ? (pulses[pulses.length - 1].t - pulses[0].t) / 1000
        : 0
      baseline = 'baseline' in r ? r.baseline : null
      const faces = snaps.filter((s) => hasFace({ t: s.t, face: s.face }, privacy.canUseFace(), c))
      calibratedFace =
        baseline && faces.length
          ? {
              center: {
                x: median(faces.map((s) => s.face!.center!.x))!,
                y: median(faces.map((s) => s.face!.center!.y))!
              },
              size: median(faces.map((s) => s.face!.size!))!
            }
          : undefined
      baselineFailure = 'reason' in r ? r.reason : null
      bus.emit(
        'state:baseline-ready',
        'reason' in r ? { ok: false, reason: r.reason } : { ok: true }
      )
    }
    // A check-in with no face counts as a seated gap.
    if (!sawFace) seatedSince = null
    evaluate(snaps)
    emit()
  })

  bus.on('break:away', ({ manual }) => {
    if (!manual) return
    manualAway = away = true
    seatedSince = null
    emit()
  })

  bus.on('break:returned', () => {
    if (!manualAway) return
    manualAway = away = false
    emit()
  })

  bus.on('privacy:changed', () => {
    if (privacy.canUseFace()) return
    calibratedFace = undefined
    wakeBuckets.clear()
    if (baseline) delete baseline.blinkRate
    buf = buf.map((s) => {
      const vitals = { ...s }
      delete vitals.face
      return vitals
    })
    history = []
  })

  bus.on('privacy:camera-paused', () => {
    paused = true
    wakeBuckets.clear()
  })
  bus.on('privacy:camera-resumed', () => {
    paused = false
    lastFace = null
    phaseStart = Date.now()
  })

  return {
    reset,
    current,
    diagnostics: () => {
      const activePulses = buf.filter((s) => s.pulse?.stable)
      const pulses = phase === 'calibration' ? activePulses : null
      const c = cfg()
      return {
        pulseCount: pulses ? pulses.length : calibrationPulseCount,
        pulseSpanSec: pulses
          ? pulses.length
            ? (pulses[pulses.length - 1].t - pulses[0].t) / 1000
            : 0
          : calibrationPulseSpanSec,
        pulseNeeded: c.baselineMinPulseReadings,
        pulseSpanNeededSec: c.baselineMinPulseSpanSec,
        awayNoFaceSec: c.awayNoFaceSec,
        baseline: baseline !== null,
        baselineFailure,
        lastFace,
        phaseStart,
        phase: phase ?? 'idle',
        paused
      }
    },
    dispose: reset
  }
}
