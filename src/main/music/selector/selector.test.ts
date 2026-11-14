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
  it('always chooses the nearest own or heard song, even when unscored or out of band', () => {
    const mine = song('mine', { energy: 5, mood: 'dark' }, { origin: 'mine' })
    const heard = song('heard', { energy: 3 }, { origin: 'heard' })
    expect(pickSong([mine, heard], 'settle', ctx)?.id).toBe(heard.id)
    expect(pickSong([song('new')], 'settle', ctx)?.id).toBe('spotify:track:new')
    expect(pickSong([song('blocked', {}, { playable: false })], 'steady', ctx)).toBeNull()
  })

  it('prefers a sure calm song to an unsure calm song', () => {
    const sure = song('sure', { energy: 2 })
    const unsure = song('unsure', { energy: 1, confidence: 0.1 })
    expect(pickSong([unsure, sure], 'settle', ctx)?.id).toBe(sure.id)
  })

  it('never repeats during a session until exhausted, then plays the oldest', () => {
    const songs = [song('a', { energy: 1 }), song('b', { energy: 4 }), song('c', { energy: 5 })]
    const played = new Map<string, number>()
    for (let i = 0; i < songs.length; i++) {
      const picked = pickSong(songs, 'settle', { ...ctx, played })!
      expect(played.has(picked.id)).toBe(false)
      played.set(picked.id, i)
    }
    expect(pickSong(songs, 'settle', { ...ctx, played })?.id).toBe(songs[0].id)
    expect(pickSong([songs[0]], 'settle', { ...ctx, played, currentId: songs[0].id })?.id).toBe(
      songs[0].id
    )
  })

  it('keeps outside picks to at most one in ten, and only when own songs are far', () => {
    const mine = song('mine', { energy: 5, mood: 'dark' }, { origin: 'mine' })
    const outside = song('outside', { energy: 1 }, { origin: 'fallback' })
    let fallbackPicks = 0
    for (let picks = 0; picks < 40; picks++) {
      const selected = pickSong([mine, outside], 'settle', { ...ctx, picks, fallbackPicks })!
      fallbackPicks += selected.origin === 'fallback' ? 1 : 0
      expect(fallbackPicks).toBeLessThanOrEqual(Math.floor((picks + 1) / 10))
    }
    expect(fallbackPicks).toBe(4)
    expect(
      pickSong([song('close', { energy: 1 }), outside], 'settle', { ...ctx, picks: 9 })?.origin
    ).not.toBe('fallback')
  })

  it.each([
    ['settle', 'settleVotes'],
    ['steady', 'steadyVotes'],
    ['lift', 'liftVotes'],
    ['let-it-ride', 'goodVotes']
  ] as const)('three positive %s plays outrank an AI guess', (target, field) => {
    const voted = song(
      'voted',
      { energy: 5, mood: 'dark' },
      {
        learned: {
          energyDelta: 0,
          confidenceDelta: 0,
          settleVotes: 0,
          steadyVotes: 0,
          quickSkips: 0,
          plays: 3,
          updatedAt: 0,
          [field]: 3
        }
      }
    )
    const guessed = song('guess', { energy: target === 'lift' ? 3 : 1, mood: 'bright' })
    expect(pickSong([guessed, voted], target, ctx)?.id).toBe(voted.id)
  })

  it('uses playlist-name hints only as a small nudge for unsure songs', () => {
    const calm = song('calm', undefined, { playlists: ['piano'] })
    const gym = song('gym', undefined, { playlists: ['gym'] })
    const playlistNames = new Map([
      ['piano', 'Calm Piano'],
      ['gym', 'Gym Workout']
    ])
    // With an RNG at zero, ranking exposes the small nudge instead of its random slack.
    expect(pickSong([gym, calm], 'settle', { ...ctx, rng: () => 0, playlistNames })?.id).toBe(
      calm.id
    )
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

  it('reads an overridden gap on every update (dev simulator fast mode)', () => {
    const gap = { minTargetChangeMs: 15_000, downtimeChangeMultiplier: 1.2 }
    const t = createTargetTracker(gap)
    t.update('steady', 'deep-work', 0)
    expect(t.update('ease-down', 'deep-work', 14_000)).toBeNull()
    expect(t.update('ease-down', 'deep-work', 15_000)).toBe('ease-down')
    const d = createTargetTracker(gap)
    d.update('let-it-ride', 'downtime', 0)
    expect(d.update('lift', 'downtime', 15_000)).toBeNull()
    expect(d.update('lift', 'downtime', 18_000)).toBe('lift')
    gap.minTargetChangeMs = 180_000 // fast mode off
    expect(t.update('settle', 'deep-work', 30_000)).toBeNull()
  })
})
