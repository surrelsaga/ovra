// Owner: Agent B. All state engine thresholds live here (starting values from PLAN.md §5).
export const stateConfig = {
  focusedPulsePct: 0.08,
  focusedBreathingPct: 0.15,
  tensePulsePct: 0.1,
  tenseRmssdDropPct: 0.15,
  tenseBreathingPct: 0.2,
  crashingTenseMin: 10,
  crashingPulsePct: 0.2,
  lowPulsePct: -0.08,
  lowBreathingPct: -0.15,
  seatedGapSec: 60,
  awayNoFaceSec: 20
} as const
