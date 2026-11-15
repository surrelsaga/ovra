import type { Activity, Song, SongScores } from '@shared/types'
import {
  baseTarget,
  createTargetTracker,
  desiredTarget,
  effective,
  fits,
  isUnsure,
  pickSong,
  songDistance,
  steadyEnergy
} from '.'
import { musicConfig } from '../config'

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
    expect(baseTarget('crashing', 'focus')).toBe('settle')
    expect(baseTarget('tense', 'focus')).toBe('ease-down')
    expect(baseTarget('focused', 'focus')).toBe('steady')
    expect(baseTarget('low', 'focus')).toBe('lift')
    expect(baseTarget('good', 'focus')).toBe('let-it-ride')
  })
  it.each(['focus', 'reading', 'creative', 'everyday', 'unwind'] as const)(
    'keeps %s neutral before a situation, even near the session end',
    (activity) => {
      expect(baseTarget(null, activity)).toBe('steady')
      expect(desiredTarget({ situation: null, activity, remainingSec: 60 })).toBe('steady')
    }
  )
  it('uses activity defaults when focused', () => {
    expect(baseTarget('focused', 'everyday')).toBe('lift')
    expect(baseTarget('focused', 'unwind')).toBe('let-it-ride')
    expect(baseTarget('tense', 'everyday')).toBe('ease-down')
  })
  it('winds down in the last ~10 min, except when settling', () => {
    expect(desiredTarget({ situation: 'focused', activity: 'focus', remainingSec: 601 })).toBe(
      'steady'
    )
    expect(desiredTarget({ situation: 'focused', activity: 'focus', remainingSec: 600 })).toBe(
      'wind-down'
    )
    expect(desiredTarget({ situation: 'low', activity: 'everyday', remainingSec: 60 })).toBe(
      'wind-down'
    )
    expect(desiredTarget({ situation: 'crashing', activity: 'focus', remainingSec: 60 })).toBe(
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
  it.each(['lift', 'let-it-ride'] as const)(
    '%s admits neutral songs alongside bright ones, with the same dark penalty',
    (target) => {
      const bright = song('bright', { mood: 'bright' })
      const neutral = song('neutral', { mood: 'neutral', vocals: 'heavy' })
      const dark = song('dark', { mood: 'dark' })
      for (const activity of [undefined, 'everyday', 'unwind'] as const) {
        const context = { ...ctx, activity }
        expect(songDistance(neutral, target, context)).toBe(
          musicConfig.selection.neutralMoodPenalty
        )
        expect(songDistance(dark, target, context)).toBe(musicConfig.selection.moodPenalty)
        expect(songDistance(bright, target, context)).toBe(0)
        expect(pickSong([dark, neutral, bright], target, context)?.id).toBe(neutral.id)
        expect(pickSong([neutral, bright], target, { ...context, rng: () => 0 })?.id).toBe(
          bright.id
        )
      }
    }
  )

  it.each(['settle', 'ease-down', 'wind-down'] as const)(
    '%s ranks instrumental, light and heavy vocals, while allowing light vocals in the pool',
    (target) => {
      const instrumental = song('instrumental', { energy: 2, vocals: 'instrumental' })
      const light = song('light', { energy: 2, vocals: 'light' })
      const heavy = song('heavy', { energy: 2, vocals: 'heavy' })
      expect(songDistance(light, target, ctx)).toBe(musicConfig.selection.calmVocals.light)
      expect(songDistance(heavy, target, ctx)).toBe(musicConfig.selection.calmVocals.heavy)
      expect(pickSong([heavy, light, instrumental], target, ctx)?.id).toBe(light.id)
      expect(pickSong([heavy, light, instrumental], target, { ...ctx, rng: () => 0 })?.id).toBe(
        instrumental.id
      )
      expect(pickSong([heavy, light], target, ctx)?.id).toBe(light.id)
      expect(pickSong([heavy], target, ctx)?.id).toBe(heavy.id)
    }
  )

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

  it('treats the same title by the same lead artist under another id as already played', () => {
    const single = song('single', { energy: 1 }, { title: 'That Should Be Me' })
    const album = song(
      'album',
      { energy: 1 },
      { title: 'That Should Be Me', artist: 'a,\u00a0Rascal Flatts' }
    )
    const other = song('other', { energy: 2 })
    const played = new Map([[single.id, 0]])
    expect(pickSong([single, album, other], 'settle', { ...ctx, rng: () => 0, played })?.id).toBe(
      other.id
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
  it('uses the same 3 minute gap for all activities', () => {
    const t = createTargetTracker()
    expect(t.update('steady', 'focus', 0)).toBe('steady')
    expect(t.update('steady', 'focus', 1)).toBeNull()
    expect(t.update('ease-down', 'focus', 60_000)).toBeNull()
    expect(t.current()).toBe('steady')
    expect(t.update('ease-down', 'focus', 180_000)).toBe('ease-down')
    const d = createTargetTracker()
    d.update('let-it-ride', 'unwind', 0)
    expect(d.update('lift', 'unwind', 179_999)).toBeNull()
    expect(d.update('lift', 'unwind', 180_000)).toBe('lift')
  })

  it('reads an overridden gap on every update (dev simulator fast mode)', () => {
    const gap = { minTargetChangeMs: 15_000 }
    const t = createTargetTracker(gap)
    t.update('steady', 'focus', 0)
    expect(t.update('ease-down', 'focus', 14_000)).toBeNull()
    expect(t.update('ease-down', 'focus', 15_000)).toBe('ease-down')
    const d = createTargetTracker(gap)
    d.update('let-it-ride', 'unwind', 0)
    expect(d.update('lift', 'unwind', 14_999)).toBeNull()
    expect(d.update('lift', 'unwind', 15_000)).toBe('lift')
    gap.minTargetChangeMs = 180_000 // fast mode off
    expect(t.update('settle', 'focus', 30_000)).toBeNull()
  })
})

describe('activity music lean', () => {
  it.each(['steady', 'let-it-ride'] as const)(
    'Focus allows a fitting light-vocal song for %s, still ranks instrumentals first and avoids heavy vocals',
    (target) => {
      const context = { ...ctx, activity: 'focus' as const }
      const instrumental = song('instrumental', {
        energy: 2,
        mood: 'bright',
        vocals: 'instrumental'
      })
      const light = song('light', { energy: 3, mood: 'bright', vocals: 'light' })
      const heavy = song('heavy', { energy: 3, mood: 'bright', vocals: 'heavy' })
      expect(pickSong([heavy, light, instrumental], target, context)?.id).toBe(light.id)
      expect(pickSong([light, instrumental], target, { ...context, rng: () => 0 })?.id).toBe(
        instrumental.id
      )
      expect(pickSong([heavy, instrumental], target, context)?.id).toBe(instrumental.id)
    }
  )

  it.each(['focused', 'good', null] as const)(
    'Reading prefers instrumental, then light vocals for %s, with no vocal filter',
    (situation) => {
      const heavy = song('heavy', { energy: 2, vocals: 'heavy' })
      const light = song('light', { energy: 2, vocals: 'light' })
      const instrumental = song('instrumental', { energy: 2, vocals: 'instrumental' })
      const context = { ...ctx, activity: 'reading' as const }
      const target = baseTarget(situation, 'reading')
      expect(pickSong([heavy, light, instrumental], target, context)?.id).toBe(instrumental.id)
      expect(pickSong([heavy, light], target, context)?.id).toBe(light.id)
      expect(pickSong([heavy], target, context)?.id).toBe(heavy.id)
      expect(fits(heavy, target, context)).toBe(true)
    }
  )

  it.each(['focus', 'reading', 'creative'] as const)(
    'good mood still prefers bright songs with %s',
    (activity) => {
      const { min } = musicConfig.activityLean[activity]
      const neutral = song('neutral', { energy: min, vocals: 'instrumental' })
      const bright = song('bright', { energy: min, vocals: 'instrumental', mood: 'bright' })
      const context = { ...ctx, rng: () => 0, activity }
      expect(pickSong([neutral, bright], baseTarget('good', activity), context)?.id).toBe(bright.id)
      // Focused keeps the activity lean only: no mood preference.
      const focused = baseTarget('focused', activity)
      expect(pickSong([neutral, bright], focused, context)?.id).toBe(neutral.id)
    }
  )

  it.each([
    ['focus', { energy: 3, vocals: 'instrumental' }, { energy: 5, vocals: 'heavy' }],
    ['reading', { energy: 1, vocals: 'instrumental' }, { energy: 3, vocals: 'instrumental' }],
    ['creative', { energy: 3, vocals: 'heavy' }, { energy: 1, vocals: 'instrumental' }],
    ['everyday', { energy: 4, mood: 'bright' }, { energy: 1, mood: 'neutral' }],
    ['unwind', { energy: 5, mood: 'bright', vocals: 'heavy' }, { energy: 2, mood: 'neutral' }]
  ] as [Activity, Partial<SongScores>, Partial<SongScores>][])(
    '%s has its own energy and mood lean',
    (activity, preferred, other) => {
      const a = song('preferred', preferred)
      const b = song('other', other)
      const context = { ...ctx, rng: () => 0, activity }
      expect(pickSong([b, a], baseTarget('focused', activity), context)?.id).toBe(a.id)
      expect(fits(a, 'steady', context)).toBe(true)
      expect(fits(b, 'steady', context)).toBe(false)
    }
  )
})
