// Pure state logic: baseline, window summaries, situation classifier. No bus, no timers.
import type {
  Baseline,
  CameraMode,
  Expression,
  FaceSnapshot,
  MetricsSnapshot,
  Situation,
  Trend
} from '@shared/types'
import { ValidationCode } from '@shared/types'
import { stateConfig, type StateConfig } from './config'

export function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Raw face-specific validation, pulse or plausible landmarks; bare face objects prove nothing. */
export function hasFace(
  s: MetricsSnapshot,
  faceEnabled: boolean,
  cfg: StateConfig = stateConfig,
  calibrated?: Pick<FaceSnapshot, 'center' | 'size'>
): boolean {
  if (s.validationCode === ValidationCode.noFaceFound) return false
  if (s.pulse?.stable && Number.isFinite(s.pulse.value)) return true
  if (s.validationCode === ValidationCode.multipleFaces) return false
  if (
    s.validationCode !== undefined &&
    [
      ValidationCode.ok,
      ValidationCode.faceNotCentered,
      ValidationCode.faceSizeOutOfRange,
      ValidationCode.chestNotVisible,
      ValidationCode.excessiveMotion,
      ValidationCode.faceTooClose,
      ValidationCode.faceTooFar,
      ValidationCode.faceTooHigh,
      ValidationCode.faceTooLow,
      ValidationCode.faceNotForward
    ].some((code) => code === s.validationCode)
  )
    return true
  const f = s.face
  if (!faceEnabled || !f?.present || !f.center || f.size === undefined) return false
  const { x, y } = f.center
  if (
    ![x, y, f.size].every(Number.isFinite) ||
    f.size < cfg.presenceMinFaceSize ||
    f.size > cfg.presenceMaxFaceSize ||
    x < cfg.presenceMinCenter ||
    x > 1 - cfg.presenceMinCenter ||
    y < cfg.presenceMinCenter ||
    y > 1 - cfg.presenceMinCenter
  )
    return false
  return (
    !calibrated?.center ||
    calibrated.size === undefined ||
    (Math.abs(x - calibrated.center.x) <= cfg.presenceMaxCenterShift &&
      Math.abs(y - calibrated.center.y) <= cfg.presenceMaxCenterShift &&
      f.size >= calibrated.size / cfg.presenceSizeRatio &&
      f.size <= calibrated.size * cfg.presenceSizeRatio)
  )
}

const stablePulse = (snaps: MetricsSnapshot[]): MetricsSnapshot[] =>
  snaps.filter((s) => s.pulse?.stable)
/** Distinct seconds that have at least one reading. The SDK sends ~4 a second, so counts lie; seconds don't. */
export const seconds = (snaps: MetricsSnapshot[]): number =>
  new Set(snaps.map((s) => Math.floor(s.t / 1000))).size
/** Distinct seconds with a steady pulse reading. */
export const steadyPulseSec = (snaps: MetricsSnapshot[]): number => seconds(stablePulse(snaps))
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
  const sec = seconds(pulse)
  if (sec < cfg.baselineMinPulseSec)
    return { reason: `I only got ${sec} of ${cfg.baselineMinPulseSec} s of steady pulse.` }
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

/** 'noread': under windowMinPulseSec of steady pulse. Pauses holds like a near miss, keeps the situation. */
export type WindowSignal = 'tense' | 'low' | 'steady' | 'unclear' | 'noread'

/** One evaluated window. Relative values only; in-memory only. */
export interface WindowEval {
  start: number
  t: number
  signal: WindowSignal
  pulseDelta: number
  /** HRV (or, for tense, faster breathing) backs the pulse call: full confidence. */
  backed: boolean
  nearTense?: boolean
  nearLow?: boolean
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

/** Summarise one window of snapshots against the baseline. No read without enough steady pulse. */
export function evaluateWindow(
  snaps: MetricsSnapshot[],
  baseline: Baseline,
  cfg: StateConfig,
  now = Date.now()
): WindowEval {
  const start = snaps[0]?.t ?? now
  const t = snaps[snaps.length - 1]?.t ?? now
  const pulse = stablePulse(snaps)
  if (seconds(pulse) < cfg.windowMinPulseSec)
    return {
      start,
      t,
      signal: 'noread',
      pulseDelta: 0,
      backed: false,
      happyMajority: false,
      negativeMajority: false
    }
  const pd = rel(median(pulse.map((s) => s.pulse!.value)), baseline.pulse)!

  const faces = snaps.filter((s) => s.face?.present)
  const talking = faces.filter((s) => s.face!.talking).length
  const talkingTooMuch = faces.length > 0 && talking / faces.length > cfg.talkingIgnoreBreathingFrac
  const bd = talkingTooMuch ? undefined : rel(median(stableBreathing(snaps)), baseline.breathing)
  const rd = rel(median(stableHrv(snaps, 'rmssd')), baseline.rmssd)
  const blinkD = rel(blinkRate(snaps, cfg), baseline.blinkRate)

  const withExpr = faces.filter((s) => s.face!.expressions && topExpression(s.face!.expressions))
  const tops = withExpr.map((s) => topExpression(s.face!.expressions!)!)
  const frac = (pred: (e: Expression) => boolean): number =>
    tops.length ? tops.filter(pred).length / tops.length : 0

  // Pulse decides. HRV backs up or vetoes tense; breathing can only back it up (confidence).
  const vetoed = rd !== undefined && rd >= cfg.tenseRmssdVetoPct
  const tense = pd >= cfg.tensePulsePct && !vetoed
  // Face only supports: a high blink rate lowers the pulse bar, it never replaces it.
  const blinky = blinkD !== undefined && blinkD >= cfg.lowBlinkPct
  const low = pd <= cfg.lowPulsePct || (blinky && pd <= cfg.lowBlinkPulsePct)
  const steady = Math.abs(pd) <= cfg.focusedPulsePct
  const signal: WindowSignal = tense ? 'tense' : low ? 'low' : steady ? 'steady' : 'unclear'

  return {
    start,
    t,
    signal,
    pulseDelta: pd,
    nearTense: pd >= cfg.tensePulsePct - cfg.streakBandPct && !vetoed,
    nearLow:
      pd <= cfg.lowPulsePct + cfg.streakBandPct ||
      (blinky && pd <= cfg.lowBlinkPulsePct + cfg.streakBandPct),
    // ponytail: outside tense, HRV being there at all counts as backing; refine if it misleads.
    backed:
      signal === 'tense'
        ? (rd !== undefined && rd <= -cfg.tenseRmssdDropPct) ||
          (bd !== undefined && bd >= cfg.tenseBreathingPct)
        : rd !== undefined,
    happyMajority:
      seconds(withExpr) >= cfg.goodMinFaceSec && frac((e) => e === 'happy') > cfg.faceMajorityFrac,
    negativeMajority: frac((e) => NEGATIVE.includes(e)) > cfg.faceMajorityFrac
  }
}

export interface Classification {
  situation: Situation | null
  confidence: number
  trend: Trend
}

/** Trailing qualifying windows; borderline and no-read windows preserve but do not advance the hold. */
export function streak(
  history: WindowEval[],
  signal: 'tense' | 'low'
): { count: number; duration: number } {
  let count = 0
  let duration = 0
  for (let i = 0; i < history.length; i++) {
    const w = history[i]
    if (w.signal === signal) {
      duration += count ? w.t - history[i - 1].t : w.t - w.start
      count++
    } else if (
      w.signal !== 'noread' &&
      !(
        (w.signal === 'unclear' || w.signal === 'steady') &&
        (signal === 'tense' ? w.nearTense : w.nearLow)
      )
    ) {
      count = duration = 0
    }
  }
  return { count, duration }
}

function held(
  history: WindowEval[],
  signal: 'tense' | 'low',
  mode: CameraMode,
  checkins: number,
  minutes: number
): boolean {
  const s = streak(history, signal)
  if (s.count === 0) return false
  return mode === 'checkins' ? s.count >= checkins : s.duration >= minutes * 60_000
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
  // No-read windows pause holds (see streak) and are invisible here, so the situation stays.
  const reads = history.filter((w) => w.signal !== 'noread')
  const last = reads[reads.length - 1]
  if (!last) return { situation: previous, confidence: 0, trend: 'steady' }

  const prev = reads[reads.length - 2]
  const step = prev ? last.pulseDelta - prev.pulseDelta : 0
  const trend: Trend =
    step >= cfg.trendPulsePct ? 'rising' : step <= -cfg.trendPulsePct ? 'falling' : 'steady'
  const confidence = last.backed ? cfg.confidenceFull : cfg.confidencePulseOnly

  let situation: Situation | null = null
  if (held(history, 'tense', mode, cfg.tenseHoldCheckins, cfg.tenseHoldMin)) {
    const tenseMin = streak(history, 'tense').duration / 60_000
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
