// Owner: Agent E. Tunable numbers and default wording for the windows module.
import type { Situation, TargetWord } from '@shared/types'

export const windowsConfig = {
  main: { width: 1100, height: 1000, minWidth: 900, minHeight: 600 },
  /** Orb window holds the pixel moon (88 px disk, 128 px with ring), bubble, now-playing chip and the hover bar under them. */
  orb: { width: 220, height: 342, margin: 24 },
  moveCard: { width: 360, height: 480, gap: 8 },
  /** Background colour for windows before the renderer paints (matches --bg). */
  background: '#0b0c0f',
  /** Breathe along: one full breath (in + out), 6 breaths per minute. */
  breathPeriodMs: 10_000,
  /** How often the breath value is pushed to the orb. */
  breathTickMs: 100,
  bubbleTtlMs: 7_000,
  framing: {
    codes: [7, 12, 13, 14, 15, 16, 17] as readonly number[],
    persistMs: 2 * 60_000,
    cooldownMs: 15 * 60_000,
    pollMs: 1_000,
    bubbleTtlMs: 15_000
  },
  /** Bubbles starting with this are demo hints: they wait for the bubble to be free. */
  demoHintPrefix: 'Demo:',
  /** How often the why line is refreshed (the away countdown moves every second). */
  whyTickMs: 1_000,
  cameraTeachLimit: 3,
  /** Wait this long after the last drag before saving the orb position. */
  orbSaveDelayMs: 400,
  videoExtensions: ['.mp4', '.mov', '.webm', '.m4v']
} as const

export function mainWindowSize(workArea: { width: number; height: number }): {
  width: number
  height: number
  minWidth: number
  minHeight: number
} {
  return {
    width: Math.min(windowsConfig.main.width, workArea.width),
    height: Math.min(windowsConfig.main.height, workArea.height),
    minWidth: Math.min(windowsConfig.main.minWidth, workArea.width),
    minHeight: Math.min(windowsConfig.main.minHeight, workArea.height)
  }
}

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
