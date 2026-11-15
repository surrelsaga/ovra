// Display only: keep the scenario identifiers and engine decisions unchanged.
import type {
  MusicTarget,
  CameraMode,
  OrbView,
  SimScenario,
  Situation,
  StateUpdate
} from '@shared/types'
import type { StateConfig } from '../state/config'

export const MOOD_LABEL: Record<Situation | 'away', string> = {
  focused: 'Steady',
  good: 'Good mood',
  tense: 'Stressed',
  crashing: 'Very stressed',
  low: 'Tired',
  away: 'Away'
}

export const SCENARIO_LABEL: Record<SimScenario, string> = {
  calm: MOOD_LABEL.focused,
  good: MOOD_LABEL.good,
  tense: MOOD_LABEL.tense,
  crashing: MOOD_LABEL.crashing,
  low: MOOD_LABEL.low,
  away: MOOD_LABEL.away
}

/** Use the engine's counted hold, so paused/no-read windows never advance an invented timer. */
export function countdown(
  state: StateUpdate | null,
  why: OrbView['why'],
  mode: CameraMode,
  cfg: StateConfig
): string | undefined {
  if (!why?.moving || why.progress === undefined || state?.away) return undefined
  if (why.text.includes('away in')) return why.text
  const target =
    state?.situation === 'tense' ? 'crashing' : why.text.includes('lower') ? 'low' : 'tense'
  if (mode === 'checkins') return `${MOOD_LABEL[target]} after qualifying check-ins · ${why.text}`
  const minutes =
    target === 'crashing'
      ? cfg.crashingTenseMin
      : target === 'low'
        ? cfg.lowHoldMin
        : cfg.tenseHoldMin
  const seconds = Math.max(0, Math.ceil((1 - why.progress) * minutes * 60))
  return `${MOOD_LABEL[target]} in ~${seconds} s`
}

export const MUSIC_LABEL: Record<MusicTarget, string> = {
  lift: 'Pick me up',
  'ease-down': 'Calm down',
  settle: 'Quiet',
  'let-it-ride': 'Keep it going',
  steady: 'Steady',
  'wind-down': 'Wind down'
}
