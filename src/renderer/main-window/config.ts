// Owner: Agent E. Tunable values and labels for the main window.
import type { Activity, ScoreSource, Song } from '@shared/types'

export const mainConfig = {
  lengthsMin: [45, 60, 120, 180],
  customMin: { min: 10, max: 480, default: 90 },
  checkinIntervals: [3, 5, 10] as const,
  nudgeIntervalsMin: [15, 20, 30, 45],
  calibrationSec: 90,
  /** Songs below this confidence go under "Not sure yet". */
  unsureBelow: 0.5,
  framingPad: { min: 0, max: 0.6, step: 0.05 }
}

export const ACTIVITIES: { value: Activity; label: string; hint: string }[] = [
  { value: 'deep-work', label: 'Deep work', hint: 'Steady music, few interruptions' },
  { value: 'debugging', label: 'Debugging', hint: 'Steady music, calm when it gets tense' },
  { value: 'writing', label: 'Writing', hint: 'Steady, lighter on lyrics' },
  { value: 'admin', label: 'Admin', hint: 'A bit more lift' },
  { value: 'downtime', label: 'Downtime', hint: 'Anything bright, rarely switches' }
]

export const ACTIVITY_LABEL = Object.fromEntries(
  ACTIVITIES.map((a) => [a.value, a.label])
) as Record<Activity, string>

/** "Why it's here" for each score source. */
export const SOURCE_LABEL: Record<ScoreSource, string> = {
  lastfm: 'Public tags on Last.fm',
  llm: 'AI estimate from title and tags',
  web: 'Web search',
  learned: 'Learned from your sessions',
  rules: 'Matched from public tags'
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
