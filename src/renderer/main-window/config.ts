// Owner: Agent E. Tunable values and labels for the main window.
import type { Activity, ScoreSource, Song } from '@shared/types'

export const mainConfig = {
  lengthsMin: [45, 60, 120, 180],
  customMin: { min: 10, max: 480, default: 90 },
  checkinIntervals: [3, 5, 10] as const,
  nudgeIntervalsMin: [15, 20, 30, 45],
  /** Seconds of steady pulse calibration needs (state baselineMinPulseSec). */
  calibrationSec: 30,
  demoLengthMin: 20,
  activityLengthMin: {
    focus: 60,
    reading: 60,
    creative: 60,
    everyday: 45,
    unwind: 45
  } satisfies Record<Activity, number>,
  /** Songs below this confidence go under "Not sure yet". */
  unsureBelow: 0.5,
  framingPad: { min: 0, max: 0.6, step: 0.05 }
}

export const ACTIVITIES: { value: Activity; label: string; examples: string; hint: string }[] = [
  {
    value: 'focus',
    label: 'Focus',
    examples: 'Studying, work, coding, writing',
    hint: 'Steady, few lyrics'
  },
  {
    value: 'reading',
    label: 'Reading',
    examples: 'Articles, books, comics',
    hint: 'Soft, mostly without singing'
  },
  {
    value: 'creative',
    label: 'Creative',
    examples: 'Design, drawing, editing',
    hint: 'A little more upbeat'
  },
  {
    value: 'everyday',
    label: 'Everyday tasks',
    examples: 'Email, planning, shopping',
    hint: 'Upbeat, lyrics welcome'
  },
  {
    value: 'unwind',
    label: 'Unwind',
    examples: 'Browsing, social, chatting',
    hint: 'Upbeat and feel-good'
  }
]

export const ACTIVITY_LABEL = Object.fromEntries(
  ACTIVITIES.map((a) => [a.value, a.label])
) as Record<Activity, string>

/** "Why it's here" for each score source. */
export const SOURCE_LABEL: Record<ScoreSource, string> = {
  lastfm: 'Public song descriptions on Last.fm',
  llm: 'AI guess from title and descriptions',
  web: 'Web search',
  learned: 'Learned from your sessions',
  rules: 'Guessed from the playlist or starting settings'
}

export type SongTab = 'Calm' | 'Focus' | 'Boost' | 'Not sure yet'

export function effectiveEnergy(song: Song): number | null {
  if (!song.scores) return null
  return Math.min(5, Math.max(1, Math.round(song.scores.energy + (song.learned?.energyDelta ?? 0))))
}

/**
 * Which library tab a song shows under.
 * ponytail: display grouping only; the music selector decides what actually plays.
 */
export function songTab(song: Song): SongTab {
  const energy = effectiveEnergy(song)
  if (energy === null || !song.scores) return 'Not sure yet'
  const confidence = song.scores.confidence + (song.learned?.confidenceDelta ?? 0)
  if (confidence < mainConfig.unsureBelow) return 'Not sure yet'
  if (energy <= 2) return 'Calm'
  if (energy >= 4 || song.scores.mood === 'bright') return 'Boost'
  return 'Focus'
}

export function fmtMinutes(min: number): string {
  const m = Math.round(min)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function fmtDate(t: number): string {
  return new Date(t).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

export const musicUiConfig = { availabilityPollMs: 5000 } as const

export const SONG_TAB_LABEL: Record<SongTab, string> = {
  Calm: 'Calm',
  Focus: 'Steady',
  Boost: 'Pick me up',
  'Not sure yet': 'Not sure yet'
}

export const SONG_MOOD_LABEL: Record<import('@shared/types').SongMood, string> = {
  dark: 'Sad',
  neutral: 'Neutral',
  bright: 'Upbeat'
}

export const SINGING_LABEL: Record<import('@shared/types').Vocals, string> = {
  instrumental: 'No singing',
  light: 'Some singing',
  heavy: 'Lots of singing'
}
