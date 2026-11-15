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
  seconds,
  steadyPulseSec,
  type WindowEval
} from './classifier'
import { resolveConfig } from './config'
import { describeWindow, whyLine, type Why } from './why'

export { buildBaseline, classify, evaluateWindow } from './classifier'

/** Extras for the orb's why line and the dev monitor. In memory only. */
export interface StateExplain {
  why(): Why | undefined
  /** Coarse line for the latest window, numbered so the monitor logs each one once. */
  lastWindow(): { n: number; line: string } | null
}

export interface StateDeps {
  bus: Bus
  privacy: PrivacyService
}

const MAX_HISTORY = 100

export function createStateEngine({ bus, privacy }: StateDeps): StateEngine & StateExplain {
  const cfg = (): ReturnType<typeof resolveConfig> =>
    resolveConfig(privacy.getSettings().thresholdOverrides)

  let mode: CameraMode = 'checkins'
  let baseline: Baseline | null = null
  let refinementPulses: number[] = []
  let baselineFailure: string | null = null
  let calibrationPulseCount = 0
  let calibrationPulseSpanSec = 0
  /** After a failed calibration ("Start anyway"): steady-pulse snapshots until a baseline builds. */
  let pending: MetricsSnapshot[] = []
  /** Breathing/HRV missing from the baseline: steady values from focused windows, until baselineFillSec. */
  let fill: MetricsSnapshot[] = []
  let phase: Exclude<SensingPhase, 'idle'> | null = null
  let lastEnded: SensingPhase | null = null
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
  let lastFrame: number | null = null
  let away = false
  let manualAway = false
  let paused = false
  let lastEval = 0
  let windows = 0
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
    refinementPulses = []
    calibratedFace = undefined
    baselineFailure = null
    calibrationPulseCount = calibrationPulseSpanSec = 0
    pending = []
    fill = []
    phase = lastEnded = null
    buf = []
    history = []
    situation = null
    confidence = 0
    trend = 'steady'
    seatedSince = null
    lastFace = lastFrame = null
    validationCode = ValidationCode.ok
    wakeBuckets.clear()
    away = manualAway = paused = false
  }

  /** Rolling baseline (approach 4): only after a failed calibration, from in-session steady pulse. */
  function buildPending(c: ReturnType<typeof resolveConfig>): void {
    if (baseline || !baselineFailure) return
    const r = buildBaseline(pending, c, Date.now())
    if (!('baseline' in r)) return
    baseline = r.baseline
    baselineFailure = null
    pending = []
    bus.emit('state:baseline-ready', { ok: true })
  }

  /** Fill missing breathing/HRV from the first baselineFillSec of steady values in focused windows. */
  function fillIn(snaps: MetricsSnapshot[], c: ReturnType<typeof resolveConfig>): void {
    if (!baseline) return
    const b = baseline
    const after = fill[fill.length - 1]?.t ?? -Infinity // continuous windows overlap
    const wanted = (s: MetricsSnapshot): boolean =>
      (b.breathing === undefined && !!s.breathing?.stable) ||
      (b.rmssd === undefined && !!s.hrv?.stable)
    fill.push(...snaps.filter((s) => s.t > after && wanted(s)))
    const ready = (pick: (s: MetricsSnapshot) => boolean): MetricsSnapshot[] | null => {
      const xs = fill.filter(pick)
      return seconds(xs) >= c.baselineFillSec ? xs : null
    }
    if (b.breathing === undefined) {
      const xs = ready((s) => !!s.breathing?.stable)
      if (xs) b.breathing = median(xs.map((s) => s.breathing!.value))
    }
    if (b.rmssd === undefined) {
      const xs = ready((s) => !!s.hrv?.stable)
      if (xs) {
        b.rmssd = median(xs.map((s) => s.hrv!.rmssd))
        b.baevsky = median(xs.map((s) => s.hrv!.baevsky))
      }
    }
    if (b.breathing !== undefined && b.rmssd !== undefined) fill = []
  }

  function evaluate(snaps: MetricsSnapshot[]): void {
    const c = cfg()
    buildPending(c)
    if (!baseline) return
    const ev = evaluateWindow(snaps, baseline, c)
    history = [...history, ev].slice(-MAX_HISTORY)
    ;({ situation, confidence, trend } = classify(history, mode, situation, c))
    windows++
    if (Date.now() - baseline.builtAt >= c.baselineRefineMin * 60_000) {
      refinementPulses = []
    } else if (refinementPulses.length === 0) {
      // The first evaluation belongs to calibration (or Start anyway), so count it only once.
      refinementPulses = [baseline.pulse]
    } else if (ev.signal === 'steady' && !ev.nearTense && !ev.nearLow) {
      refinementPulses.push(median(snaps.flatMap((s) => (s.pulse?.stable ? [s.pulse.value] : [])))!)
      baseline.pulse = median(refinementPulses)!
    }
    if (
      ev.signal === 'steady' &&
      (baseline.breathing === undefined || baseline.rmssd === undefined)
    )
      fillIn(snaps, c)
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
    if (paused || (phase !== 'continuous' && (mode !== 'continuous' || phase !== 'return-check')))
      return
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
    const continuing =
      mode === 'continuous' &&
      (phase === 'continuous' || phase === 'return-check' || lastEnded === 'return-check') &&
      (p === 'continuous' || p === 'return-check')
    phase = p
    lastEnded = null
    phaseStart = lastEval = Date.now()
    buf = []
    sawFace = false
    if (!continuing) {
      validationCode = ValidationCode.ok
      wakeBuckets.clear()
      lastFace = lastFrame = null // camera-off time is not a seated gap
    }
    if (p === 'continuous' || (mode === 'continuous' && p === 'return-check')) {
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
    if (!phase || paused || !Number.isFinite(s.t) || (lastFrame !== null && s.t <= lastFrame))
      return
    lastFrame = s.t
    const code = s.validationCode ?? validationCode
    if (code === ValidationCode.noFaceFound) {
      wakeBuckets.clear()
      return
    }
    const c = cfg()
    const pulse = !!s.pulse?.stable && Number.isFinite(s.pulse.value)
    const face =
      code !== ValidationCode.multipleFaces &&
      hasFace(
        { t: s.t, face: s.face, validationCode: s.validationCode },
        privacy.canUseFace(),
        c,
        calibratedFace
      )
    if (!pulse && !face) return
    onFace(s.t)
    buf.push(s)
    if (pulse && !baseline && baselineFailure && phase !== 'calibration') pending.push(s)
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
    lastEnded = p
    phase = null
    const snaps = buf
    buf = []
    stopTimer()
    if (p === 'continuous') return
    if (p === 'calibration') {
      const c = cfg()
      const r = buildBaseline(snaps, c, Date.now())
      const pulses = snaps.filter((s) => s.pulse?.stable)
      calibrationPulseCount = steadyPulseSec(pulses)
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
    if (!away && !manualAway) return
    manualAway = away = false
    // An explicit return gets the same no-face grace period as a fresh stream.
    lastFace = Date.now()
    wakeBuckets.clear()
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
    lastFace = lastFrame = null
    phaseStart = Date.now()
  })

  return {
    reset,
    current,
    why() {
      if (paused || away) return undefined
      // "Start anyway": no baseline yet, music follows the activity default meanwhile.
      if (!baseline)
        return baselineFailure && phase !== 'calibration'
          ? { text: 'Getting to know you', moving: false }
          : undefined
      const c = cfg()
      if (phase === 'continuous') {
        const gapMs = Date.now() - (lastFace ?? phaseStart)
        if (gapMs >= c.whyAwaySoonSec * 1000)
          return {
            text: `Couldn't see you · away in ${Math.max(0, Math.ceil(c.awayNoFaceSec - gapMs / 1000))} s`,
            progress: Math.min(1, gapMs / (c.awayNoFaceSec * 1000)),
            moving: true
          }
      }
      return whyLine(history, situation, mode, c)
    },
    lastWindow() {
      const w = history[history.length - 1]
      if (!w) return null
      const why = whyLine(history, situation, mode, cfg())
      return {
        n: windows,
        line: `${describeWindow(w)} situation=${situation ?? '-'} why=${JSON.stringify(why?.text ?? '')}`
      }
    },
    diagnostics: () => {
      const activePulses = buf.filter((s) => s.pulse?.stable)
      const pulses = phase === 'calibration' ? activePulses : null
      const c = cfg()
      return {
        // Seconds of steady pulse; the span can't be shorter than the bar, so it shares it.
        pulseCount: pulses ? steadyPulseSec(pulses) : calibrationPulseCount,
        pulseSpanSec: pulses
          ? pulses.length
            ? (pulses[pulses.length - 1].t - pulses[0].t) / 1000
            : 0
          : calibrationPulseSpanSec,
        pulseNeeded: c.baselineMinPulseSec,
        pulseSpanNeededSec: c.baselineMinPulseSec,
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
