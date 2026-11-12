// Owner: Agent C (music). Situation → music target, and which song fits a target. See PLAN.md §6.
import type { Activity, MusicTarget, Situation, Song, SongMood, Vocals } from '@shared/types'
import { ACTIVITY_DEFAULT_TARGET, musicConfig } from '../config'

const cfg = musicConfig

export function baseTarget(situation: Situation | null, activity: Activity): MusicTarget {
  switch (situation) {
    case 'crashing':
      return 'settle'
    case 'tense':
      return 'ease-down'
    case 'low':
      return 'lift'
    case 'good':
      return 'let-it-ride'
    default:
      return ACTIVITY_DEFAULT_TARGET[activity]
  }
}

/** Wind-down takes over in the last minutes, except when settling is needed. */
export function desiredTarget(i: {
  situation: Situation | null
  activity: Activity
  remainingSec?: number
}): MusicTarget {
  const t = baseTarget(i.situation, i.activity)
  if (
    t !== 'settle' &&
    i.remainingSec !== undefined &&
    i.remainingSec <= cfg.switching.windDownSec
  ) {
    return 'wind-down'
  }
  return t
}

/** Wellness wording only. */
export const TARGET_REASON: Record<MusicTarget, string> = {
  settle: 'Things feel intense right now. Switching to calm songs.',
  'ease-down': 'You seem a bit tense. Easing into calmer songs.',
  steady: 'Keeping the music steady while you focus.',
  lift: 'Energy seems low. Bringing in some brighter songs.',
  'let-it-ride': 'You seem in a good mood. Letting the music ride.',
  'wind-down': 'The session is almost done. Winding the music down.'
}

export interface Effective {
  energy: number
  mood: SongMood
  vocals: Vocals
  confidence: number
}

/** Base scores plus learned adjustments, clamped. Null if not scored yet. */
export function effective(song: Song): Effective | null {
  const s = song.scores
  if (!s) return null
  const l = song.learned
  return {
    energy: Math.min(5, Math.max(1, s.energy + (l?.energyDelta ?? 0))),
    mood: s.mood,
    vocals: s.vocals,
    confidence: Math.min(1, Math.max(0, s.confidence + (l?.confidenceDelta ?? 0)))
  }
}

export function isUnsure(song: Song): boolean {
  const e = effective(song)
  return !e || e.confidence < cfg.songs.unsureBelow
}

/** Energy Steady aims for: what has worked (steady votes), else the default. */
export function steadyEnergy(songs: Song[]): number {
  const worked = songs.filter((s) => (s.learned?.steadyVotes ?? 0) > 0).map(effective)
  const e = worked.filter((x): x is Effective => !!x).map((x) => x.energy)
  return e.length ? e.reduce((a, b) => a + b, 0) / e.length : cfg.songs.steadyDefaultEnergy
}

export interface PickContext {
  now: number
  rng: () => number
  currentId?: string
  /** Effective energy of the song playing now, if known. */
  currentEnergy?: number
  steadyEnergy?: number
}

/** Does a scored song fit the target? Unsure songs are handled by pickSong. */
export function fits(song: Song, target: MusicTarget, ctx: PickContext): boolean {
  const e = effective(song)
  if (!e) return false
  const stepDown =
    ctx.currentEnergy !== undefined
      ? Math.max(1, Math.round(ctx.currentEnergy) - 1)
      : cfg.songs.easeDownDefaultMax
  switch (target) {
    case 'settle':
      return e.energy <= 2 && e.mood !== 'dark'
    case 'ease-down':
      return e.energy <= stepDown && e.mood !== 'dark'
    case 'wind-down':
      return e.energy <= stepDown
    case 'steady':
      return (
        (song.learned?.steadyVotes ?? 0) > 0 ||
        Math.abs(e.energy - (ctx.steadyEnergy ?? cfg.songs.steadyDefaultEnergy)) <=
          cfg.songs.steadyEnergyRange
      )
    case 'lift':
      return e.energy >= 3 && e.energy <= 4 && e.mood === 'bright'
    case 'let-it-ride':
      return e.mood === 'bright'
  }
}

const votes = (s: Song, target: MusicTarget): number =>
  target === 'steady' || target === 'let-it-ride'
    ? (s.learned?.steadyVotes ?? 0)
    : target === 'lift'
      ? 0
      : (s.learned?.settleVotes ?? 0)

/**
 * Picks the next song for a target, or null (then a playlist plays instead).
 * Unsure songs never go to Settle/Ease down; about 1 in 5 picks in Steady/Let it ride may be one.
 */
export function pickSong(songs: Song[], target: MusicTarget, ctx: PickContext): Song | null {
  const fresh = songs.filter(
    (s) =>
      s.id !== ctx.currentId &&
      !(s.lastPlayedAt !== undefined && ctx.now - s.lastPlayedAt < cfg.switching.recentMs)
  )
  const allowUnsure = target === 'steady' || target === 'let-it-ride'
  const unsure = allowUnsure ? fresh.filter(isUnsure) : []
  if (unsure.length && ctx.rng() < cfg.switching.unsureShare) {
    return unsure[Math.floor(ctx.rng() * unsure.length)]
  }
  const sure = fresh
    .filter((s) => !isUnsure(s) && fits(s, target, ctx))
    .sort(
      (a, b) =>
        votes(b, target) - votes(a, target) || effective(b)!.confidence - effective(a)!.confidence
    )
  if (!sure.length) return null
  // ponytail: random among the top 5 keeps variety; weight by votes if picks feel repetitive.
  const top = sure.slice(0, 5)
  return top[Math.floor(ctx.rng() * top.length)]
}

/** At most one target change per ~3 min (longer in downtime). */
export function createTargetTracker(): {
  current(): MusicTarget | null
  reset(): void
  /** Returns the new target if it changed now, else null. */
  update(desired: MusicTarget, activity: Activity, now: number): MusicTarget | null
} {
  let target: MusicTarget | null = null
  let changedAt = -Infinity
  return {
    current: () => target,
    reset() {
      target = null
      changedAt = -Infinity
    },
    update(desired, activity, now) {
      if (desired === target) return null
      const gap =
        cfg.switching.minTargetChangeMs *
        (activity === 'downtime' ? cfg.switching.downtimeChangeMultiplier : 1)
      if (target !== null && now - changedAt < gap) return null
      target = desired
      changedAt = now
      return desired
    }
  }
}
