// Owner: Agent B. All state engine thresholds live here (starting values from PLAN.md §5).
// Every key can be overridden by AppSettings.thresholdOverrides (same name).
export const stateConfig = {
  // Baseline (calibration). Pulse is required, everything else optional.
  baselineMinPulseReadings: 5,
  baselineMinPulseSpanSec: 15,

  // One evaluation window (a check-in, or the sliding window in continuous mode).
  windowMinPulseReadings: 3,
  /** Ignore breathing for a window when talking shows in more than this fraction of face frames. */
  talkingIgnoreBreathingFrac: 0.1,
  /** Blink rate needs at least this much face time in the window. */
  blinkMinWindowSec: 20,
  /** "Most of the window" for expressions. */
  faceMajorityFrac: 0.5,

  // Situations, as fractions relative to baseline.
  focusedPulsePct: 0.08,
  focusedBreathingPct: 0.15,
  tensePulsePct: 0.1,
  tenseRmssdDropPct: 0.15,
  tenseBreathingPct: 0.2,
  tenseHoldCheckins: 2,
  tenseHoldMin: 3,
  crashingTenseMin: 10,
  crashingPulsePct: 0.2,
  lowPulsePct: -0.08,
  lowBreathingPct: -0.15,
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
