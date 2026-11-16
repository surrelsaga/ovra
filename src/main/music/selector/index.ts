// Owner: Agent C (music). Situation → music target, and which song fits a target. See PLAN.md §6.
import type { Activity, MusicTarget, Situation, Song, SongMood, Vocals } from '@shared/types'
import { ACTIVITY_DEFAULT_TARGET, musicConfig } from '../config'

const cfg = musicConfig

export function baseTarget(situation: Situation | null, activity: Activity): MusicTarget {
  switch (situation) {
    case null:
      return 'steady'
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
export function desiredTarget(
  i: {
    situation: Situation | null
    activity: Activity
    remainingSec?: number
  },
  gap: Pick<TargetGap, 'windDownSec'> = cfg.switching
): MusicTarget {
  const t = baseTarget(i.situation, i.activity)
  if (
    i.situation !== null &&
    t !== 'settle' &&
    i.remainingSec !== undefined &&
    i.remainingSec <= (gap.windDownSec ?? cfg.switching.windDownSec)
  ) {
    return 'wind-down'
  }
  return t
}

/** Wellness wording only. */
export const TARGET_REASON: Record<MusicTarget, string> = {
  settle: 'You seem very stressed. Playing quiet songs.',
  'ease-down': 'You seem stressed. Playing calmer songs.',
  steady: 'Keeping the music steady.',
  lift: 'You seem tired. Playing more upbeat songs.',
  'let-it-ride': 'You seem in a good mood. Keeping the music going.',
  'wind-down': 'The session is almost done. Playing softer songs.'
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
  played?: ReadonlyMap<string, number>
  picks?: number
  fallbackPicks?: number
  /** Only set when focused, good or unknown; overrides the target’s usual energy/vocals lean. */
  activity?: Activity
  playlistNames?: ReadonlyMap<string, string>
}

/** Does a scored song fit the target? Unsure songs are handled by pickSong. */
export function fits(song: Song, target: MusicTarget, ctx: PickContext): boolean {
  const e = effective(song)
  if (!e) return false
  const lean = ctx.activity ? cfg.activityLean[ctx.activity] : undefined
  if (lean)
    return e.energy >= lean.min && e.energy <= lean.max && (!lean.bright || e.mood === 'bright')
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

const votes = (s: Song, target: MusicTarget): number => {
  const l = s.learned
  return target === 'steady'
    ? (l?.steadyVotes ?? 0)
    : target === 'let-it-ride'
      ? (l?.goodVotes ?? 0)
      : target === 'lift'
        ? (l?.liftVotes ?? 0)
        : (l?.settleVotes ?? 0)
}

/** Nearest fit, with small penalties for uncertainty, recent plays and skips. */
export function songDistance(s: Song, target: MusicTarget, ctx: PickContext): number {
  const c = cfg.selection
  const e = effective(s)
  let energy = e?.energy ?? cfg.songs.steadyDefaultEnergy
  if (isUnsure(s)) {
    const names = (s.playlists ?? []).map((p) => ctx.playlistNames?.get(p) ?? '').join(' ')
    if (/chill|calm|sleep|piano/i.test(names)) energy -= c.playlistHint
    if (/gym|workout|hype|party/i.test(names)) energy += c.playlistHint
  }
  const stepDown =
    ctx.currentEnergy !== undefined
      ? Math.max(1, Math.round(ctx.currentEnergy) - 1)
      : cfg.songs.easeDownDefaultMax
  const steady = ctx.steadyEnergy ?? cfg.songs.steadyDefaultEnergy
  const ride = ctx.currentEnergy ?? steady
  const lean = ctx.activity ? cfg.activityLean[ctx.activity] : undefined
  const [min, max] = lean
    ? [lean.min, lean.max]
    : target === 'settle'
      ? [1, 2]
      : target === 'ease-down' || target === 'wind-down'
        ? [1, stepDown]
        : target === 'lift'
          ? [3, 4]
          : target === 'let-it-ride'
            ? [ride - 1, ride + 1]
            : [steady - cfg.songs.steadyEnergyRange, steady + cfg.songs.steadyEnergyRange]
  let distance = Math.max(min - energy, energy - max, 0)
  const calm = target === 'settle' || target === 'ease-down'
  if (calm && e?.mood === 'dark') distance += c.darkPenalty
  // Good mood keeps it bright whatever the activity; otherwise the lean decides.
  if (
    (target === 'let-it-ride' || (lean ? lean.bright : target === 'lift')) &&
    e?.mood !== 'bright'
  )
    distance +=
      e?.mood === 'neutral' && (target === 'lift' || target === 'let-it-ride')
        ? c.neutralMoodPenalty
        : c.moodPenalty
  if (lean && e) distance += lean.vocals[e.vocals]
  if ((calm || target === 'wind-down') && e) distance += c.calmVocals[e.vocals]
  if (isUnsure(s)) distance += calm ? c.unsurePenaltyCalm : c.unsurePenalty
  if (s.lastPlayedAt !== undefined && ctx.now - s.lastPlayedAt < c.cooldownMs)
    distance += c.cooldownPenalty
  return (
    distance +
    (s.learned?.quickSkips ?? 0) * c.skipPenalty -
    Math.min(c.maxVoteBonus, votes(s, target) * c.voteBonus)
  )
}

/** Same title by the same lead artist under another id (single, album, feat. version) counts as heard. */
export function songKey(title: string, artist: string): string {
  return `${title}\n${artist.split(',')[0]}`.normalize('NFKC').toLowerCase().trim()
}

/**
 * Steering: may this song keep playing for the target? Same distance as picks, minus the
 * cross-session cooldown (a playlist song heard a few hours ago still fits). Unscored songs come
 * from the user's own playlists, so they may play, except for the calm targets (PLAN §6).
 */
export function fitsNow(s: Song | undefined, target: MusicTarget, ctx: PickContext): boolean {
  if (!s?.scores) return target !== 'settle' && target !== 'ease-down'
  return songDistance({ ...s, lastPlayedAt: undefined }, target, ctx) <= cfg.steering.fitDistance
}

/** User playlists and heard tracks lead; outside picks cannot exceed one in ten. */
export function pickSong(songs: Song[], target: MusicTarget, ctx: PickContext): Song | null {
  const c = cfg.selection
  const playable = songs.filter((s) => s.playable !== false)
  const own = playable.filter((s) => s.origin !== 'fallback')
  const outside = playable.filter((s) => s.origin === 'fallback')
  const key = (s: Song): string => songKey(s.title, s.artist)
  const heard = new Set(
    playable.filter((s) => s.id === ctx.currentId || ctx.played?.has(s.id)).map(key)
  )
  const available = (pool: Song[]): Song[] => {
    const fresh = pool.filter((s) => !heard.has(key(s)))
    if (fresh.length) return fresh
    // Exhaustion: replay the longest-ago song, including the current song in a one-song library.
    const older = pool.filter((s) => s.id !== ctx.currentId)
    const remaining = older.length ? older : pool
    if (!remaining.length) return []
    const oldest = Math.min(
      ...remaining.map((s) => ctx.played?.get(s.id) ?? s.lastPlayedAt ?? -Infinity)
    )
    return remaining.filter(
      (s) => (ctx.played?.get(s.id) ?? s.lastPlayedAt ?? -Infinity) === oldest
    )
  }
  let pool = available(own)
  // Three positive plays outweigh a guess, even if the guessed energy is far away.
  const trusted = pool.filter(
    (s) => (s.learned?.plays ?? 0) >= c.votesToTrust && votes(s, target) >= c.votesToTrust
  )
  const best = Math.min(...pool.map((s) => songDistance(s, target, ctx)))
  const outsideAllowed =
    (ctx.fallbackPicks ?? 0) < Math.floor(((ctx.picks ?? 0) + 1) / c.fallbackEvery)
  if (trusted.length) pool = trusted
  // No playlists of the user's own: the target's editorial playlist is the library.
  else if (!pool.length) pool = available(outside)
  else if (outsideAllowed && outside.length && best > c.fallbackMinDistance)
    pool = available(outside)
  if (!pool.length) return null
  pool.sort((a, b) => songDistance(a, target, ctx) - songDistance(b, target, ctx))
  const closest = songDistance(pool[0], target, ctx)
  const top = pool
    .filter((s) => songDistance(s, target, ctx) <= closest + c.pickSlack)
    .slice(0, c.topK)
  return top[Math.min(top.length - 1, Math.floor(ctx.rng() * top.length))]
}

export interface TargetGap {
  minTargetChangeMs: number
  windDownSec?: number
  switchNow?: boolean
}

/**
 * At most one target change per ~3 min for every activity. `gap` is read on every update, so the
 * dev simulator can swap its values; the app uses the defaults.
 */
export function createTargetTracker(gap: TargetGap = cfg.switching): {
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
    update(desired, _activity, now) {
      if (desired === target) return null
      const minMs = gap.minTargetChangeMs
      if (target !== null && now - changedAt < minMs) return null
      target = desired
      changedAt = now
      return desired
    }
  }
}
