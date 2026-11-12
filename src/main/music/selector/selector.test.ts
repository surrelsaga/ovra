import type { Song, SongScores } from '@shared/types'
import {
  baseTarget,
  createTargetTracker,
  desiredTarget,
  effective,
  fits,
  isUnsure,
  pickSong,
  steadyEnergy
} from '.'

const song = (id: string, s?: Partial<SongScores>, extra: Partial<Song> = {}): Song => ({
  id: `spotify:track:${id}`,
  title: id,
  artist: 'a',
  firstSeenAt: 0,
  playCount: 0,
  scores: s
    ? {
        energy: 3,
        mood: 'neutral',
        vocals: 'light',
        confidence: 0.9,
        source: 'llm',
        scoredAt: 0,
        ...s
      }
    : undefined,
  ...extra
})

const ctx = { now: 10 * 3600_000, rng: () => 0.99 }

describe('targets', () => {
  it('maps situations to targets', () => {
    expect(baseTarget('crashing', 'deep-work')).toBe('settle')
    expect(baseTarget('tense', 'deep-work')).toBe('ease-down')
    expect(baseTarget('focused', 'deep-work')).toBe('steady')
    expect(baseTarget('low', 'deep-work')).toBe('lift')
    expect(baseTarget('good', 'deep-work')).toBe('let-it-ride')
  })
  it('uses activity defaults when focused or unknown', () => {
    expect(baseTarget(null, 'debugging')).toBe('steady')
    expect(baseTarget(null, 'writing')).toBe('steady')
    expect(baseTarget('focused', 'admin')).toBe('lift')
    expect(baseTarget(null, 'downtime')).toBe('let-it-ride')
    expect(baseTarget('tense', 'admin')).toBe('ease-down')
  })
  it('winds down in the last ~10 min, except when settling', () => {
    expect(desiredTarget({ situation: 'focused', activity: 'deep-work', remainingSec: 601 })).toBe(
      'steady'
    )
    expect(desiredTarget({ situation: 'focused', activity: 'deep-work', remainingSec: 600 })).toBe(
      'wind-down'
    )
    expect(desiredTarget({ situation: 'low', activity: 'admin', remainingSec: 60 })).toBe(
      'wind-down'
    )
    expect(desiredTarget({ situation: 'crashing', activity: 'deep-work', remainingSec: 60 })).toBe(
      'settle'
    )
  })
})

describe('song fit', () => {
  it('applies learned adjustments, clamped', () => {
    const s = song(
      'x',
      { energy: 2, confidence: 0.6 },
      {
        learned: {
          energyDelta: -2,
          confidenceDelta: -0.2,
          settleVotes: 4,
          steadyVotes: 0,
          quickSkips: 2,
          plays: 6,
          updatedAt: 0
        }
      }
    )
    expect(effective(s)).toMatchObject({ energy: 1, confidence: expect.closeTo(0.4) })
    expect(isUnsure(s)).toBe(true)
    expect(isUnsure(song('y'))).toBe(true)
  })
  it('settle: energy 1–2, not dark', () => {
    expect(fits(song('a', { energy: 2, mood: 'bright' }), 'settle', ctx)).toBe(true)
    expect(fits(song('b', { energy: 2, mood: 'dark' }), 'settle', ctx)).toBe(false)
    expect(fits(song('c', { energy: 3 }), 'settle', ctx)).toBe(false)
  })
  it('ease-down: one step below the current song', () => {
    expect(fits(song('a', { energy: 3 }), 'ease-down', { ...ctx, currentEnergy: 4 })).toBe(true)
    expect(fits(song('a', { energy: 4 }), 'ease-down', { ...ctx, currentEnergy: 4 })).toBe(false)
    expect(fits(song('a', { energy: 3 }), 'ease-down', ctx)).toBe(true)
  })
  it('lift: energy 3–4, bright; let it ride: bright; steady: near what worked', () => {
    expect(fits(song('a', { energy: 4, mood: 'bright' }), 'lift', ctx)).toBe(true)
    expect(fits(song('a', { energy: 5, mood: 'bright' }), 'lift', ctx)).toBe(false)
    expect(fits(song('a', { energy: 5, mood: 'bright' }), 'let-it-ride', ctx)).toBe(true)
    expect(fits(song('a', { energy: 5 }), 'steady', ctx)).toBe(false)
    expect(fits(song('a', { energy: 5 }), 'steady', { ...ctx, steadyEnergy: 4.5 })).toBe(true)
  })
  it('steady energy follows songs with steady votes', () => {
    const l = {
      energyDelta: 0,
      confidenceDelta: 0,
      settleVotes: 0,
      steadyVotes: 2,
      quickSkips: 0,
      plays: 2,
      updatedAt: 0
    }
    expect(steadyEnergy([song('a', { energy: 2 }, { learned: l }), song('b', { energy: 5 })])).toBe(
      2
    )
    expect(steadyEnergy([])).toBe(3)
  })
})

describe('pickSong', () => {
  const calm = song('calm', { energy: 1, mood: 'bright' })
  const unsureCalm = song('unsure', { energy: 1, mood: 'bright', confidence: 0.2 })
  const unscored = song('new')

  it('never uses unsure songs for settle or ease-down', () => {
    expect(pickSong([unsureCalm, unscored], 'settle', { ...ctx, rng: () => 0 })).toBeNull()
    expect(pickSong([unsureCalm, unscored], 'ease-down', { ...ctx, rng: () => 0 })).toBeNull()
    expect(pickSong([unsureCalm, calm], 'settle', { ...ctx, rng: () => 0 })?.id).toBe(calm.id)
  })

  it('lets about 1 in 5 steady picks be unsure', () => {
    const steady = song('steady', { energy: 3 })
    const songs = [steady, unscored]
    let i = 0
    const seq = [0.1, 0.0, 0.5, 0.0] // first pick: rng < 0.2 → unsure; second: ≥ 0.2 → sure
    const rng = (): number => seq[i++]
    expect(pickSong(songs, 'steady', { ...ctx, rng })?.id).toBe(unscored.id)
    expect(pickSong(songs, 'steady', { ...ctx, rng })?.id).toBe(steady.id)
    expect(pickSong([unscored], 'steady', { ...ctx, rng: () => 0.5 })).toBeNull()
  })

  it('skips the current and recently played songs, prefers settle votes', () => {
    const recent = song('recent', { energy: 1 }, { lastPlayedAt: ctx.now - 60_000 })
    const voted = song(
      'voted',
      { energy: 2 },
      {
        learned: {
          energyDelta: 0,
          confidenceDelta: 0,
          settleVotes: 3,
          steadyVotes: 0,
          quickSkips: 0,
          plays: 3,
          updatedAt: 0
        }
      }
    )
    expect(pickSong([recent], 'settle', ctx)).toBeNull()
    expect(pickSong([calm], 'settle', { ...ctx, currentId: calm.id })).toBeNull()
    expect(pickSong([calm, voted], 'settle', { ...ctx, rng: () => 0 })?.id).toBe(voted.id)
  })
})

describe('target tracker', () => {
  it('allows at most one change per 3 min, longer in downtime', () => {
    const t = createTargetTracker()
    expect(t.update('steady', 'deep-work', 0)).toBe('steady')
    expect(t.update('steady', 'deep-work', 1)).toBeNull()
    expect(t.update('ease-down', 'deep-work', 60_000)).toBeNull()
    expect(t.current()).toBe('steady')
    expect(t.update('ease-down', 'deep-work', 180_000)).toBe('ease-down')
    const d = createTargetTracker()
    d.update('let-it-ride', 'downtime', 0)
    expect(d.update('lift', 'downtime', 180_000)).toBeNull()
    expect(d.update('lift', 'downtime', 540_000)).toBe('lift')
  })
})
