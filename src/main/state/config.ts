// Owner: Agent B. All state engine thresholds live here (starting values from PLAN.md §5).
// Every key can be overridden by AppSettings.thresholdOverrides (same name).
export const stateConfig = {
  // Baseline (calibration). Pulse is required, everything else optional.
  /** Distinct seconds with a steady pulse reading. Same bar in demo and real mode. */
  baselineMinPulseSec: 30,
  /** Breathing/HRV missing from calibration: filled in from this many seconds of steady values in focused windows. */
  baselineFillSec: 60,
  /** Refine pulse from calm windows for this long after the baseline is built, then freeze it. */
  baselineRefineMin: 10,

  // One evaluation window (a check-in, or the sliding window in continuous mode).
  /** Below this many seconds of steady pulse the window is "no read": holds pause. */
  windowMinPulseSec: 10,
  /** Forget tense/crashing/low after this span of trailing no-read windows, not time since the last read. */
  noReadForgetMin: 3,
  /** Good needs at least this many seconds of face frames with expressions; otherwise it's Focused. */
  goodMinFaceSec: 10,
  /** Ignore breathing for a window when talking shows in more than this fraction of face frames. */
  talkingIgnoreBreathingFrac: 0.1,
  /** Blink rate needs at least this much face time in the window. */
  blinkMinWindowSec: 20,
  /** "Most of the window" for expressions. */
  faceMajorityFrac: 0.5,

  // Situations, as fractions relative to baseline. Pulse decides; HRV backs up or vetoes;
  // breathing only adds confidence (docs/reliability.md §5.3).
  focusedPulsePct: 0.08,
  tensePulsePct: 0.15,
  /** A steady RMSSD drop permits the lower pulse bar. Breathing cannot lower it. */
  tenseBackedPulsePct: 0.1,
  /** Near misses pause a hold; they do not add qualifying time or check-ins. */
  streakBandPct: 0.03,
  /** Backer: RMSSD this far below baseline lowers the pulse bar and raises tense confidence. */
  tenseRmssdDropPct: 0.15,
  /** Veto: RMSSD this far above baseline (body says relaxed) blocks tense. */
  tenseRmssdVetoPct: 0.15,
  /** Backer (confidence only): breathing this far above baseline. Never decides, blocks or vetoes. */
  tenseBreathingPct: 0.15,
  tenseHoldCheckins: 2,
  tenseHoldMin: 3,
  crashingTenseMin: 10,
  crashingPulsePct: 0.2,
  lowPulsePct: -0.08,
  /** Blink rate this much above baseline counts as "well above" (face only, supports a softer pulse drop). */
  lowBlinkPct: 0.5,
  /** With high blink rate, pulse must still be at least this far below baseline. Face never triggers alone. */
  lowBlinkPulsePct: -0.04,
  lowHoldCheckins: 1,
  lowHoldMin: 2,

  // Confidence (0–1).
  confidenceFull: 0.9,
  confidencePulseOnly: 0.6,
  /** Multiplier when the latest window doesn't clearly match and the previous situation is kept. */
  confidenceUnclearFactor: 0.7,
  /** Pulse change between windows (fraction of baseline) that counts as rising / falling. */
  trendPulsePct: 0.03,

  // Seated time and away.
  seatedGapSec: 60,
  awayNoFaceSec: 20,
  presenceMinFaceSize: 0.12,
  presenceMaxFaceSize: 0.8,
  presenceMinCenter: 0.1,
  presenceMaxCenterShift: 0.25,
  presenceSizeRatio: 1.6,
  /**
   * Evidence without a face box (steady pulse, or a framing code other than 7) keeps you present
   * for at most this long after the last face box at your seat (face consent only). An empty chair
   * can still get fresh frames with codes and even a steady pulse; a seated face gives a box every
   * second with the shrunk frame. Code 7 (normal frame, chest not visible) never has a box, so it
   * isn't capped. Same in demo.
   */
  presenceNoShapeSec: 20,
  wakeFaceSec: 3,
  wakeWindowSec: 4,
  /** Why line: "Can't see you" shows after this long without presence evidence. */
  whyAwaySoonSec: 5,

  // Continuous mode.
  continuousUpdateSec: 30,
  continuousWindowSec: 60
}

export type StateConfig = typeof stateConfig

/** Defaults with any known, finite overrides applied. */
export function resolveConfig(overrides: Record<string, number> = {}): StateConfig {
  const cfg = { ...stateConfig }
  for (const key of Object.keys(cfg) as (keyof StateConfig)[]) {
    const v = overrides[key]
    if (typeof v === 'number' && Number.isFinite(v)) cfg[key] = v
  }
  return cfg
}
