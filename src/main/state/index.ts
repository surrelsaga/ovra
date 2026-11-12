// Owner: Agent B (state engine). Baseline, smoothing, situation classifier, seated time, away detection.
// Everything here is in-memory only: the baseline and readings are never stored or sent anywhere.
import type {
  Baseline,
  Bus,
  CameraMode,
  MetricsSnapshot,
  PrivacyService,
  SensingPhase,
  Situation,
  StateEngine,
  StateUpdate,
  Trend
} from '@shared/types'
import { buildBaseline, classify, evaluateWindow, hasFace, type WindowEval } from './classifier'
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
  let phase: Exclude<SensingPhase, 'idle'> | null = null
  let phaseStart = 0
  let buf: MetricsSnapshot[] = []
  let sawFace = false
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
    phase = null
    buf = []
    history = []
    situation = null
    confidence = 0
    trend = 'steady'
    seatedSince = null
    lastFace = null
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

  // Continuous mode: away after N s with no face data, and a periodic update.
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
    lastFace = null // the camera was off before this; that gap isn't a seated gap
    if (p === 'continuous') {
      stopTimer()
      timer = setInterval(tick, 1000)
    }
  })

  bus.on('sdk:metrics', (s) => {
    if (!phase || !hasFace(s)) return
    onFace(s.t)
    buf.push(s)
    if (away && !manualAway) {
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
      baseline = 'baseline' in r ? r.baseline : null
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
  })
  bus.on('privacy:camera-resumed', () => {
    paused = false
    lastFace = null
    phaseStart = Date.now()
  })

  return { reset, current, dispose: reset }
}
