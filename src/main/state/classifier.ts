// Pure state logic: baseline, window summaries, situation classifier. No bus, no timers.
import type {
  Baseline,
  CameraMode,
  Expression,
  MetricsSnapshot,
  Situation,
  Trend
} from '@shared/types'
import type { StateConfig } from './config'

export function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** A face (or vitals, which need a face) was seen in this snapshot. */
export function hasFace(s: MetricsSnapshot): boolean {
  if (s.face) return s.face.present
  return s.pulse !== undefined || s.breathing !== undefined || s.hrv !== undefined
}

const stablePulse = (snaps: MetricsSnapshot[]): MetricsSnapshot[] =>
  snaps.filter((s) => s.pulse?.stable)
const stableBreathing = (snaps: MetricsSnapshot[]): number[] =>
  snaps.flatMap((s) => (s.breathing?.stable ? [s.breathing.value] : []))
const stableHrv = (snaps: MetricsSnapshot[], k: 'rmssd' | 'baevsky'): number[] =>
  snaps.flatMap((s) => (s.hrv?.stable ? [s.hrv[k]] : []))

/** Blinks per minute from blinking on/off edges, or undefined without enough face time. */
export function blinkRate(snaps: MetricsSnapshot[], cfg: StateConfig): number | undefined {
  const faces = snaps.filter((s) => s.face?.present && s.face.blinking !== undefined)
  if (faces.length < 2) return undefined
  const spanMs = faces[faces.length - 1].t - faces[0].t
  if (spanMs < cfg.blinkMinWindowSec * 1000) return undefined
  let blinks = 0
  for (let i = 1; i < faces.length; i++)
    if (faces[i].face!.blinking && !faces[i - 1].face!.blinking) blinks++
  return blinks / (spanMs / 60_000)
}

export function buildBaseline(
  snaps: MetricsSnapshot[],
  cfg: StateConfig,
  now: number
): { baseline: Baseline } | { reason: string } {
  const pulse = stablePulse(snaps)
  const spanSec = pulse.length ? (pulse[pulse.length - 1].t - pulse[0].t) / 1000 : 0
  if (pulse.length < cfg.baselineMinPulseReadings || spanSec < cfg.baselineMinPulseSpanSec) {
    return {
      reason:
        `too few steady pulse readings: ${pulse.length} over ${Math.round(spanSec)} s ` +
        `(need ${cfg.baselineMinPulseReadings} over ${cfg.baselineMinPulseSpanSec} s)`
    }
  }
  return {
    baseline: {
      pulse: median(pulse.map((s) => s.pulse!.value))!,
      breathing: median(stableBreathing(snaps)),
      rmssd: median(stableHrv(snaps, 'rmssd')),
      baevsky: median(stableHrv(snaps, 'baevsky')),
      blinkRate: blinkRate(snaps, cfg),
      samples: pulse.length,
      builtAt: now
    }
  }
}

export type WindowSignal = 'tense' | 'low' | 'steady' | 'unclear'

/** One evaluated window. Relative values only; in-memory only. */
export interface WindowEval {
  start: number
  t: number
  signal: WindowSignal
  pulseDelta: number
  /** No breathing or RMSSD to back up the pulse. */
  pulseOnly: boolean
  happyMajority: boolean
  negativeMajority: boolean
}

const NEGATIVE: Expression[] = ['angry', 'sad', 'disgust']

function topExpression(scores: Partial<Record<Expression, number>>): Expression | undefined {
  let top: Expression | undefined
  for (const [k, v] of Object.entries(scores) as [Expression, number][]) {
    if (top === undefined || v > scores[top]!) top = k
  }
  return top
}

const rel = (v: number | undefined, base: number | undefined): number | undefined =>
  v === undefined || !base ? undefined : (v - base) / base

/** Summarise one window of snapshots against the baseline. Null without enough stable pulse. */
export function evaluateWindow(
  snaps: MetricsSnapshot[],
  baseline: Baseline,
  cfg: StateConfig
): WindowEval | null {
  const pulse = stablePulse(snaps)
  if (pulse.length < cfg.windowMinPulseReadings) return null
  const pd = rel(median(pulse.map((s) => s.pulse!.value)), baseline.pulse)!

  const faces = snaps.filter((s) => s.face?.present)
  const talking = faces.filter((s) => s.face!.talking).length
  const talkingTooMuch = faces.length > 0 && talking / faces.length > cfg.talkingIgnoreBreathingFrac
  const bd = talkingTooMuch ? undefined : rel(median(stableBreathing(snaps)), baseline.breathing)
  const rd = rel(median(stableHrv(snaps, 'rmssd')), baseline.rmssd)
  const blinkD = rel(blinkRate(snaps, cfg), baseline.blinkRate)

  const tops = faces.flatMap((s) => {
    const top = s.face!.expressions && topExpression(s.face!.expressions)
    return top ? [top] : []
  })
  const frac = (pred: (e: Expression) => boolean): number =>
    tops.length ? tops.filter(pred).length / tops.length : 0

  // Vitals lead. Each rule uses the secondary signals that are present; pulse alone otherwise.
  const tenseBackers = [
    rd === undefined ? undefined : rd <= -cfg.tenseRmssdDropPct,
    bd === undefined ? undefined : bd >= cfg.tenseBreathingPct
  ].filter((x) => x !== undefined)
  const tense = pd >= cfg.tensePulsePct && (tenseBackers.length === 0 || tenseBackers.some(Boolean))
  const low =
    (pd <= cfg.lowPulsePct && (bd === undefined || bd <= cfg.lowBreathingPct)) ||
    // Face only supports: a high blink rate lowers the pulse bar, it never replaces it.
    (blinkD !== undefined && blinkD >= cfg.lowBlinkPct && pd <= cfg.lowBlinkPulsePct)
  const steady =
    Math.abs(pd) <= cfg.focusedPulsePct &&
    (bd === undefined || Math.abs(bd) <= cfg.focusedBreathingPct)

  return {
    start: snaps[0].t,
    t: snaps[snaps.length - 1].t,
    signal: tense ? 'tense' : low ? 'low' : steady ? 'steady' : 'unclear',
    pulseDelta: pd,
    pulseOnly: bd === undefined && rd === undefined,
    happyMajority: frac((e) => e === 'happy') > cfg.faceMajorityFrac,
    negativeMajority: frac((e) => NEGATIVE.includes(e)) > cfg.faceMajorityFrac
  }
}

export interface Classification {
  situation: Situation | null
  confidence: number
  trend: Trend
}

/** Trailing run of windows with this signal: how many, and since when. */
function streak(history: WindowEval[], signal: WindowSignal): { count: number; since: number } {
  let i = history.length
  while (i > 0 && history[i - 1].signal === signal) i--
  return { count: history.length - i, since: history[i]?.start ?? 0 }
}

function held(
  history: WindowEval[],
  signal: WindowSignal,
  mode: CameraMode,
  checkins: number,
  minutes: number
): boolean {
  const s = streak(history, signal)
  if (s.count === 0) return false
  if (mode === 'checkins') return s.count >= checkins
  return history[history.length - 1].t - s.since >= minutes * 60_000
}

/**
 * Situation from the window history (oldest first). Pure, so it's what the tests drive.
 * A situation other than focused/good must be held over several windows; a single odd window
 * keeps the previous situation at lower confidence.
 */
export function classify(
  history: WindowEval[],
  mode: CameraMode,
  previous: Situation | null,
  cfg: StateConfig
): Classification {
  const last = history[history.length - 1]
  if (!last) return { situation: previous, confidence: 0, trend: 'steady' }

  const prev = history[history.length - 2]
  const step = prev ? last.pulseDelta - prev.pulseDelta : 0
  const trend: Trend =
    step >= cfg.trendPulsePct ? 'rising' : step <= -cfg.trendPulsePct ? 'falling' : 'steady'
  const confidence = last.pulseOnly ? cfg.confidencePulseOnly : cfg.confidenceFull

  let situation: Situation | null = null
  if (held(history, 'tense', mode, cfg.tenseHoldCheckins, cfg.tenseHoldMin)) {
    const tenseMin = (last.t - streak(history, 'tense').since) / 60_000
    const crashing =
      tenseMin >= cfg.crashingTenseMin ||
      (last.pulseDelta >= cfg.crashingPulsePct && last.negativeMajority)
    situation = crashing ? 'crashing' : 'tense'
  } else if (held(history, 'low', mode, cfg.lowHoldCheckins, cfg.lowHoldMin)) {
    situation = 'low'
  } else if (last.signal === 'steady') {
    situation = last.happyMajority ? 'good' : 'focused'
  }

  if (situation) return { situation, confidence, trend }
  return {
    situation: previous ?? 'focused',
    confidence: confidence * cfg.confidenceUnclearFactor,
    trend
  }
}
