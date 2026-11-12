// Owner: Agent E. Tunable numbers and default wording for the windows module.
import type { Situation, TargetWord } from '@shared/types'

export const windowsConfig = {
  main: { width: 1100, height: 720, minWidth: 900, minHeight: 600 },
  /** Orb window holds the orb (112 px + glow), bubble, now-playing chip and hover controls. */
  orb: { width: 300, height: 330, margin: 24 },
  moveCard: { width: 360, height: 480, gap: 8 },
  /** Background colour for windows before the renderer paints (matches --bg). */
  background: '#0b0c0f',
  /** Breathe along: one full breath (in + out), 6 breaths per minute. */
  breathPeriodMs: 10_000,
  /** How often the breath value is pushed to the orb. */
  breathTickMs: 100,
  bubbleTtlMs: 7_000,
  /** Wait this long after the last drag before saving the orb position. */
  orbSaveDelayMs: 400,
  videoExtensions: ['.mp4', '.mov', '.webm', '.m4v']
} as const

/** Wellness wording only. Shown when the situation changes. */
export const situationLines: Record<Situation, string> = {
  focused: 'Nice and steady.',
  tense: 'You seem a bit tense.',
  crashing: 'Rough stretch? Let’s slow things down.',
  low: 'Energy dipping a little.',
  good: 'You seem in a good mood.'
}

/** Shown when the music target changes. */
export const targetLines: Record<TargetWord, string> = {
  Calm: 'Easing into calmer songs.',
  Focus: 'Keeping the music steady.',
  Boost: 'Picking something brighter.'
}
