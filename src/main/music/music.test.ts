import type {
  BusEvents,
  MusicController,
  MusicDecision,
  NowPlaying,
  PrivacyService,
  PrivacySettings,
  Session,
  Situation,
  Song,
  SongScores
} from '@shared/types'
import { DEFAULT_PRIVACY, DEFAULT_SETTINGS } from '@shared/types'
import { createBus } from '../bus'
import { memoryStorage } from './dev/memory-storage'
import { readFileSync } from 'node:fs'
import { createMusic, registerMusicIpc } from '.'
import { handle } from '../ipc'
import { FALLBACK_PLAYLISTS, musicConfig } from './config'
import type { TargetGap } from './selector'
import { sessionConfig } from '../session/config'
import { parseNowPlaying, SpotifyMacController } from './controller'

vi.mock('../ipc', () => ({ handle: vi.fn() }))

class FakeController implements MusicController {
  refocusResult = 'previous app requested'
  running = true
  calls: string[] = []
  contexts: (string | undefined)[] = []
  // Most tests begin with an already readable player. Cold-launch cases explicitly clear it.
  np: NowPlaying | null = {
    id: 'spotify:track:before',
    uri: 'spotify:track:before',
    name: 'Before',
    artist: 'a',
    album: '',
    durationMs: 200_000,
    positionMs: 0,
    state: 'paused',
    isAd: false
  }
  volume = 60
  getVolume?: () => Promise<number | null>
  startedAt = 0
  cb?: (t: NowPlaying) => void
  isAvailable = async (): Promise<boolean> => this.running
  play = async (uri: string, context?: string): Promise<void> => {
    this.calls.push(`play ${uri}`)
    this.contexts.push(context)
    if (uri.startsWith('spotify:track:')) {
      this.startedAt = Date.now()
      this.np = {
        id: uri,
        uri,
        name: uri,
        artist: 'a',
        album: '',
        durationMs: 200_000,
        positionMs: 0,
        state: 'playing',
        isAd: false
      }
    }
  }
  pause = async (): Promise<void> => void this.calls.push('pause')
  resume = async (): Promise<void> => void this.calls.push('resume')
  /** What Spotify plays after each `next track`; empty = Spotify refuses the skip. */
  queue: string[] = []
  next = async (): Promise<void> => {
    this.calls.push('next')
    const id = this.queue.shift()
    if (id) this.start(id)
  }
  mode = { shuffle: false, repeat: true }
  playMode = async (): Promise<{ shuffle: boolean; repeat: boolean }> => ({ ...this.mode })
  setPlayMode = async (mode: { shuffle: boolean; repeat: boolean }): Promise<void> => {
    this.mode = { ...mode }
  }
  setVolume = async (volume: number): Promise<void> => {
    this.volume = volume
  }
  current = async (): Promise<NowPlaying | null> =>
    this.np && { ...this.np, positionMs: Date.now() - this.startedAt }
  onTrackChange(cb: (t: NowPlaying) => void): () => void {
    this.cb = cb
    return () => (this.cb = undefined)
  }
  /** Spotify starts playing a track. */
  start(id: string, durationMs = 200_000): void {
    this.np = {
      id,
      uri: id,
      name: id,
      artist: 'a',
      album: '',
      durationMs,
      positionMs: 0,
      state: 'playing',
      isAd: false
    }
    this.startedAt = Date.now()
    this.cb?.(this.np)
  }
}

const PL = 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'
const PL2 = 'spotify:playlist:37i9dQZF1DX4sWSpwq3LiO'

const song = (id: string, s: Partial<SongScores>, playlists = [PL]): Song => ({
  id: `spotify:track:${id}`,
  title: id,
  artist: 'a',
  firstSeenAt: 0,
  playCount: 0,
  playlists,
  origin: 'mine',
  scores: {
    energy: 3,
    mood: 'neutral',
    vocals: 'light',
    confidence: 0.9,
    source: 'llm',
    scoredAt: 0,
    ...s
  }
})

const LIBRARY = [
  song('steady', { energy: 3 }),
  song('loud', { energy: 5, mood: 'bright' }),
  song('mid', { energy: 4, mood: 'neutral' }),
  song('calm', { energy: 1, mood: 'bright' })
]

const session = (patch: Partial<Session['config']> = {}): Session => ({
  id: 's1',
  config: {
    activity: 'focus',
    lengthMin: 60,
    cameraMode: 'checkins',
    checkinIntervalMin: 5,
    music: true,
    ...patch
  },
  startedAt: 0,
  status: 'running',
  sensingEnabled: true
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture, inferred
async function setup(
  opts: {
    fetch?: typeof fetch
    songs?: Song[]
    privacy?: Partial<PrivacySettings>
    targetGap?: TargetGap
    leaveAlone?: boolean
    playlists?: string[]
  } = {}
) {
  const bus = createBus()
  const storage = memoryStorage()
  storage.files.set('songs', structuredClone(opts.songs ?? LIBRARY))
  storage.files.set(
    'playlists',
    (opts.playlists ?? [PL]).map((uri) => ({ uri, url: uri, addedAt: 0 }))
  )
  const controller = new FakeController()
  const setSettings = vi.fn(async () => DEFAULT_SETTINGS)
  const privacy = {
    get: () => ({ ...DEFAULT_PRIVACY, ...opts.privacy }),
    getSettings: () => ({ ...DEFAULT_SETTINGS, leaveMusicAlone: opts.leaveAlone ?? false }),
    setSettings
  } as unknown as PrivacyService
  const events: { name: keyof BusEvents; payload: unknown }[] = []
  for (const name of ['music:target-changed', 'music:track-changed', 'orb:bubble'] as const) {
    bus.on(name, (payload) => events.push({ name, payload }))
  }
  const decisions: MusicDecision[] = []
  bus.on('monitor:music', (d) => decisions.push(d))
  const music = createMusic({
    bus,
    storage,
    privacy,
    controller,
    getKey: () => null,
    rng: () => 0,
    targetGap: opts.targetGap,
    fetch:
      opts.fetch ??
      (async () => {
        throw new Error('offline')
      })
  })
  const state = (situation: Situation | null): void =>
    bus.emit('state:updated', {
      t: Date.now(),
      situation,
      confidence: 1,
      seatedMinutes: 0,
      away: false,
      trend: 'steady'
    })
  const targets = (): string[] =>
    events
      .filter((e) => e.name === 'music:target-changed')
      .map((e) => (e.payload as { target: string }).target)
  return { bus, storage, controller, music, events, state, targets, setSettings, decisions }
}

const MIN = 60_000

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('music service', () => {
  it('does nothing when the session has music off or privacy says no music', async () => {
    for (const s of [
      { cfg: { music: false }, privacy: {} },
      { cfg: {}, privacy: { music: 'none' as const } }
    ]) {
      const { music, controller, events } = await setup({ privacy: s.privacy })
      await music.startSession(session(s.cfg))
      expect(controller.calls).toEqual([])
      expect(controller.cb).toBeUndefined()
      expect(events).toEqual([])
    }
  })

  it('starts with the activity default and plays a fitting song', async () => {
    const { music, controller, events } = await setup()
    await music.startSession(session())
    expect(events[0]).toEqual({
      name: 'music:target-changed',
      payload: { target: 'steady', word: 'Focus', reason: expect.stringMatching(/steady/i) }
    })
    expect(controller.calls).toEqual(['play spotify:track:steady'])
    expect(music.status()).toMatchObject({ available: true, target: 'steady', scoredCount: 4 })
  })

  it('passes Reading’s energy and vocals lean into picks, but keeps the calm targets unchanged', async () => {
    const { music, controller, state } = await setup({
      songs: [
        song('vocal', { energy: 2, vocals: 'heavy' }),
        song('instrumental', { energy: 2, vocals: 'instrumental' }),
        song('settle', { energy: 1, mood: 'bright', vocals: 'light' })
      ]
    })
    await music.startSession(session({ activity: 'reading' }))
    expect(controller.calls).toEqual(['play spotify:track:instrumental'])
    await vi.advanceTimersByTimeAsync(3 * MIN)
    state('crashing')
    await vi.advanceTimersByTimeAsync(0)
    expect(music.status().target).toBe('settle')
    // Quiet's own rules: light singing is fine here although Reading's lean would skip it.
    controller.queue = ['spotify:track:settle']
    controller.start('spotify:track:vocal')
    await vi.advanceTimersByTimeAsync(5 * musicConfig.switching.settleFadeMs)
    expect(controller.calls.slice(1)).toEqual(['next'])
    expect(controller.np?.id).toBe('spotify:track:settle')
  })

  describe.each([false, true])('neutral start (demo: %s)', (demo) => {
    it.each(['focus', 'reading', 'creative', 'everyday', 'unwind'] as const)(
      '%s keeps its activity lean without Boost or Calm until a situation exists',
      async (activity) => {
        const { min, bright } = musicConfig.activityLean[activity]
        const preferred = song('preferred', {
          energy: min,
          mood: bright ? 'bright' : 'neutral',
          vocals: 'instrumental'
        })
        const t = await setup({
          songs: [song('other', { energy: 5, mood: 'dark', vocals: 'heavy' }), preferred]
        })
        await t.music.startSession({ ...session({ activity, demo }), status: 'calibrating' })
        expect(t.controller.calls).toEqual([`play ${preferred.id}`])
        // Failed calibration / Start anyway still has no situation; ticks cannot invent one.
        await vi.advanceTimersByTimeAsync(4 * MIN)
        t.state(null)
        t.bus.emit('session:tick', { sessionId: 's1', elapsedSec: 240, remainingSec: 600 })
        expect(t.targets()).toEqual(['steady'])
        expect(t.music.status().target).toBe('steady')
        await t.music.stopSession()
      }
    )

    it.each([
      ['focused', 'lift'],
      ['good', 'let-it-ride'],
      ['low', 'lift'],
      ['tense', 'ease-down'],
      ['crashing', 'settle']
    ] as const)(
      'applies the first %s situation before the music gap',
      async (situation, target) => {
        const t = await setup({ targetGap: demo ? { minTargetChangeMs: 15_000 } : undefined })
        await t.music.startSession(session({ activity: 'everyday', demo }))
        await vi.advanceTimersByTimeAsync(1000)
        t.controller.queue = ['spotify:track:calm']
        t.state(situation)
        await vi.advanceTimersByTimeAsync(5 * musicConfig.switching.settleFadeMs)
        expect(t.targets()).toEqual(['steady', target])
        // Quiet skips at once; other first targets wait for the next song.
        expect(t.controller.calls.slice(1)).toEqual(target === 'settle' ? ['next'] : [])
        t.state(null)
        expect(t.music.status().target).toBe(target)
        await t.music.stopSession()
      }
    )
  })

  it('a normal target change waits for the next song, then skips silently to a fit', async () => {
    const t = await setup()
    await t.music.startSession(session())
    t.controller.calls = []
    t.state('tense')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.music.status().target).toBe('ease-down')
    expect(t.controller.calls).toEqual([])
    // The song ends; Spotify's shuffle plays loud, then mid, then calm.
    t.controller.queue = ['spotify:track:mid', 'spotify:track:calm']
    t.controller.start('spotify:track:loud')
    await vi.advanceTimersByTimeAsync(2000)
    expect(t.controller.calls).toEqual(['next', 'next'])
    expect(t.controller.np?.id).toBe('spotify:track:calm')
    await t.music.stopSession()
  })

  it('resets the neutral start and first-situation exception for a new session', async () => {
    const t = await setup()
    await t.music.startSession(session())
    t.state('tense')
    await t.music.startSession({ ...session(), id: 's2' })
    expect(t.music.status().target).toBe('steady')
    t.state('low')
    expect(t.targets()).toEqual(['steady', 'ease-down', 'steady', 'lift'])
    await t.music.stopSession()
  })

  it('holds the last situation through unknown updates after the music gap', async () => {
    const t = await setup()
    await t.music.startSession(session())
    t.state('tense')
    await vi.advanceTimersByTimeAsync(3 * MIN)
    t.state(null)
    expect(t.targets()).toEqual(['steady', 'ease-down'])
    t.state('low')
    expect(t.targets()).toEqual(['steady', 'ease-down', 'lift'])
    await t.music.stopSession()
  })

  it('hints once when Spotify is not running and carries on', async () => {
    const { music, controller, events, state } = await setup()
    controller.running = false
    await music.startSession(session())
    await vi.advanceTimersByTimeAsync(3 * MIN)
    state('crashing') // settle tries to switch right away
    await vi.advanceTimersByTimeAsync(0)
    expect(events.filter((e) => e.name === 'orb:bubble')).toEqual([
      { name: 'orb:bubble', payload: { text: 'Open Spotify to get music.' } }
    ])
    expect(controller.calls).toEqual([])
    expect(music.status().available).toBe(false)
  })

  it('starts the music once Spotify is opened after the session started', async () => {
    const { music, controller, bus } = await setup()
    controller.running = false
    await music.startSession(session())
    const tick = (): void =>
      bus.emit('session:tick', { sessionId: 's1', elapsedSec: 0, remainingSec: 3600 })
    tick()
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.calls).toEqual([])
    controller.running = true // the user follows the "Open Spotify" hint
    await vi.advanceTimersByTimeAsync(10_000)
    tick()
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.calls).toEqual(['play spotify:track:steady'])
    controller.start('spotify:track:steady')
    await vi.advanceTimersByTimeAsync(10_000)
    tick()
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.calls).toHaveLength(1)
  })

  it.each([false, true])(
    'reports Spotify closing once per opening, including leave-alone=%s',
    async (leaveAlone) => {
      const t = await setup({ leaveAlone })
      t.controller.running = false
      const hints = (): unknown[] =>
        t.events.filter((e) => e.name === 'orb:bubble').map((e) => e.payload)
      const tick = async (): Promise<void> => {
        await vi.advanceTimersByTimeAsync(musicConfig.controller.unavailableRetryMs)
        t.bus.emit('session:tick', { sessionId: 's1', elapsedSec: 0, remainingSec: 3600 })
        await vi.advanceTimersByTimeAsync(musicConfig.controller.readyWaitMs)
      }
      await t.music.startSession(session())
      await tick()
      await tick()
      expect(hints()).toEqual([{ text: 'Open Spotify to get music.' }])
      t.controller.running = true
      await tick()
      expect(t.music.status().available).toBe(true)
      if (!leaveAlone) t.controller.start('spotify:track:steady')
      t.controller.calls = []
      t.controller.running = false
      t.controller.np = null
      await tick()
      expect(t.music.status()).toMatchObject({ available: false, nowPlaying: null })
      await tick()
      expect(hints()).toEqual([
        { text: 'Open Spotify to get music.' },
        { text: 'Spotify closed. Open it again for music.' }
      ])
      expect(t.controller.calls).toEqual([])
      t.controller.running = true
      await tick()
      expect(t.music.status().available).toBe(true)
      expect(t.controller.calls).toHaveLength(leaveAlone ? 0 : 1)
      t.controller.running = false
      await tick()
      expect(hints()).toHaveLength(3)
      await t.music.stopSession()
      await t.music.startSession({ ...session(), id: 's2' })
      expect(hints().at(-1)).toEqual({ text: 'Open Spotify to get music.' })
      expect(hints()).toHaveLength(4)
      await t.music.stopSession()
    }
  )

  it('starts a pick when switching is turned back on after Spotify opens', async () => {
    const t = await setup({ leaveAlone: true })
    await t.music.startSession(session())
    expect(t.controller.calls).toEqual([])
    t.music.setLeaveAlone(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(t.controller.calls).toEqual(['play spotify:track:steady'])
    await t.music.stopSession()
  })

  it('keeps the 3 minute gap after the first situation', async () => {
    const { music, state, targets, bus } = await setup()
    await music.startSession(session())
    await vi.advanceTimersByTimeAsync(MIN)
    state('tense')
    state('low')
    await vi.advanceTimersByTimeAsync(2 * MIN)
    state('low')
    expect(targets()).toEqual(['steady', 'ease-down'])
    await vi.advanceTimersByTimeAsync(MIN)
    bus.emit('session:tick', { sessionId: 's1', elapsedSec: 240, remainingSec: 3000 })
    expect(targets()).toEqual(['steady', 'ease-down', 'lift'])
    state('crashing')
    expect(targets()).toEqual(['steady', 'ease-down', 'lift'])
  })

  it('uses an overridden target-change gap (dev simulator fast mode)', async () => {
    const { music, state, targets } = await setup({
      targetGap: { minTargetChangeMs: 15_000 }
    })
    await music.startSession(session())
    state('focused')
    await vi.advanceTimersByTimeAsync(10_000)
    state('tense')
    expect(targets()).toEqual(['steady'])
    await vi.advanceTimersByTimeAsync(5_000)
    state('tense')
    expect(targets()).toEqual(['steady', 'ease-down'])
  })

  it('Quiet skips right away until a calm fit, and keeps the song when nothing calmer is left', async () => {
    const { music, controller, state } = await setup()
    await music.startSession(session())
    controller.calls = []
    await vi.advanceTimersByTimeAsync(3 * MIN)
    controller.queue = ['spotify:track:loud', 'spotify:track:calm']
    state('crashing')
    await vi.advanceTimersByTimeAsync(2000)
    expect(controller.calls).toEqual(['next', 'next'])

    const unsure = await setup({
      songs: [song('maybe', { energy: 1, mood: 'bright', confidence: 0.2 })]
    })
    await unsure.music.startSession(session())
    unsure.controller.calls = []
    await vi.advanceTimersByTimeAsync(3 * MIN)
    unsure.state('crashing')
    await vi.advanceTimersByTimeAsync(2000)
    // Unsure songs never count as calm, but skipping can't reach anything better.
    expect(unsure.controller.calls).toEqual([])
  })

  it('Quiet fades down, skips to a calm fit, and fades back to the starting volume', async () => {
    const { music, controller, state } = await setup()
    const volumes: number[] = []
    controller.getVolume = async () => controller.volume
    controller.setVolume = async (v) => {
      controller.volume = v
      volumes.push(v)
    }
    await music.startSession(session())
    controller.calls = []
    await vi.advanceTimersByTimeAsync(3 * MIN)
    controller.queue = ['spotify:track:calm']
    state('crashing')
    await vi.advanceTimersByTimeAsync(2500)
    expect(volumes).toEqual([50, 39, 29, 18, 8])
    await vi.advanceTimersByTimeAsync(2500)
    expect(controller.calls).toEqual(['next'])
    expect(volumes).toEqual([50, 39, 29, 18, 8, 18, 29, 39, 50, 60])
    expect(controller.volume).toBe(60)
  })

  it('restores volume on session stop and leaves a user-changed volume alone', async () => {
    const t = await setup()
    t.controller.getVolume = async () => t.controller.volume
    t.controller.setVolume = async (v) => {
      t.controller.volume = v
    }
    await t.music.startSession(session())
    await vi.advanceTimersByTimeAsync(3 * MIN)
    t.state('crashing')
    await vi.advanceTimersByTimeAsync(500)
    await t.music.stopSession()
    expect(t.controller.volume).toBe(60)

    const changed = await setup()
    changed.controller.getVolume = async () => changed.controller.volume
    changed.controller.setVolume = async (v) => {
      changed.controller.volume = v
    }
    await changed.music.startSession(session())
    await vi.advanceTimersByTimeAsync(3 * MIN)
    changed.state('crashing')
    await vi.advanceTimersByTimeAsync(500)
    changed.controller.volume = 44
    await vi.advanceTimersByTimeAsync(500)
    expect(changed.controller.volume).toBe(44)
  })

  it.each([-2, -1, 1, 2])(
    'finishes the fade despite volume readback rounding by %i',
    async (offset) => {
      const t = await setup()
      const volumes: number[] = []
      t.controller.getVolume = async () => t.controller.volume
      t.controller.setVolume = async (v) => {
        volumes.push(v)
        t.controller.volume = v + offset
      }
      const next = vi.spyOn(t.controller, 'next')
      await t.music.startSession(session())
      await vi.advanceTimersByTimeAsync(3 * MIN)
      t.controller.queue = ['spotify:track:calm']
      t.state('crashing')
      await vi.advanceTimersByTimeAsync(3 * musicConfig.switching.settleFadeMs)
      expect(volumes).toEqual([50, 39, 29, 18, 8, 18, 29, 39, 50, 60])
      expect(next).toHaveBeenCalledOnce()
    }
  )

  it.each([500, 3000])(
    'preserves a real user volume change at %i ms throughout cleanup',
    async (elapsed) => {
      const t = await setup()
      t.controller.getVolume = async () => t.controller.volume
      const setVolume = vi.spyOn(t.controller, 'setVolume')
      await t.music.startSession(session())
      await vi.advanceTimersByTimeAsync(3 * MIN)
      t.state('crashing')
      await vi.advanceTimersByTimeAsync(elapsed)
      t.controller.volume += 3
      const userVolume = t.controller.volume
      setVolume.mockClear()
      await vi.advanceTimersByTimeAsync(2 * musicConfig.switching.settleFadeMs)
      await t.music.stopSession()
      expect(t.controller.volume).toBe(userVolume)
      expect(setVolume).not.toHaveBeenCalled()
    }
  )

  it('restores a rounded volume when the fade is cancelled', async () => {
    const t = await setup()
    t.controller.getVolume = async () => t.controller.volume
    const setVolume = vi.spyOn(t.controller, 'setVolume').mockImplementation(async (v) => {
      t.controller.volume = v - 1
    })
    await t.music.startSession(session())
    await vi.advanceTimersByTimeAsync(3 * MIN)
    t.state('crashing')
    await vi.advanceTimersByTimeAsync(500)
    await t.music.stopSession()
    expect(setVolume).toHaveBeenLastCalledWith(60)
  })

  it.each([
    { applied: false, failedVolume: 50 },
    { applied: true, failedVolume: 50 },
    { applied: false, failedVolume: 39 },
    { applied: true, failedVolume: 39 }
  ])(
    'restores after a failed volume command ($failedVolume, applied: $applied)',
    async ({ applied, failedVolume }) => {
      const t = await setup()
      t.controller.getVolume = async () => t.controller.volume
      const setVolume = vi.spyOn(t.controller, 'setVolume').mockImplementation(async (v) => {
        if (applied || v !== failedVolume) t.controller.volume = v - 1
        if (v === failedVolume) throw new Error('volume command failed')
      })
      await t.music.startSession(session())
      await vi.advanceTimersByTimeAsync(3 * MIN)
      t.state('crashing')
      await vi.advanceTimersByTimeAsync(2 * musicConfig.switching.settleFadeMs)
      expect(setVolume).toHaveBeenLastCalledWith(60)
    }
  )

  it.each(['break', 'leave-alone', 'delete', 'privacy'] as const)(
    'restores volume when a Settle fade is aborted by %s',
    async (reason) => {
      const t = await setup()
      t.controller.getVolume = async () => t.controller.volume
      t.controller.setVolume = async (v) => {
        t.controller.volume = v
      }
      await t.music.startSession(session())
      await vi.advanceTimersByTimeAsync(3 * MIN)
      t.state('crashing')
      await vi.advanceTimersByTimeAsync(500)
      if (reason === 'break') t.bus.emit('break:away', { since: Date.now(), manual: true })
      if (reason === 'leave-alone') t.music.setLeaveAlone(true)
      if (reason === 'delete') t.bus.emit('data:deleted-all', {})
      if (reason === 'privacy') t.bus.emit('privacy:changed', { ...DEFAULT_PRIVACY, music: 'none' })
      await vi.advanceTimersByTimeAsync(0)
      expect(t.controller.volume).toBe(60)
    }
  )

  it('skips without a fade when volume cannot be read and restores after a failed skip', async () => {
    const t = await setup()
    t.controller.getVolume = async () => null
    await t.music.startSession(session())
    t.controller.calls = []
    await vi.advanceTimersByTimeAsync(3 * MIN)
    t.state('crashing')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.controller.calls).toEqual(['next'])

    const failed = await setup()
    failed.controller.getVolume = async () => failed.controller.volume
    failed.controller.setVolume = async (v) => {
      failed.controller.volume = v
    }
    failed.controller.next = async () => {
      throw new Error('skip failed')
    }
    await failed.music.startSession(session())
    await vi.advanceTimersByTimeAsync(3 * MIN)
    failed.state('crashing')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(failed.controller.volume).toBe(60)
  })

  it('plays without changing volume when AppleScript returns an empty answer', async () => {
    const t = await setup()
    const mac = new SpotifyMacController(async () => '')
    t.controller.getVolume = () => mac.getVolume()
    const setVolume = vi.spyOn(t.controller, 'setVolume')
    await t.music.startSession(session())
    t.controller.calls = []
    t.controller.queue = ['spotify:track:calm']
    t.state('crashing')
    await vi.advanceTimersByTimeAsync(2 * musicConfig.switching.settleFadeMs)
    expect(t.controller.calls).toEqual(['next'])
    expect(setVolume).not.toHaveBeenCalled()
    expect(t.controller.volume).toBe(60)
  })

  it('winds down in the last 10 minutes', async () => {
    const { music, bus, targets, state } = await setup()
    await music.startSession(session())
    state('focused')
    await vi.advanceTimersByTimeAsync(3 * MIN)
    bus.emit('session:tick', { sessionId: 's1', elapsedSec: 3000, remainingSec: 600 })
    expect(targets()).toEqual(['steady', 'wind-down'])
  })

  it('demo winds down only in the last 120 s and restores normal timing afterwards', async () => {
    const gap: TargetGap = {
      ...musicConfig.switching,
      windDownSec: sessionConfig.demo.musicWindDownSec
    }
    const t = await setup({ targetGap: gap })
    await t.music.startSession(session({ demo: true, lengthMin: 20 }))
    t.state('focused')
    await vi.advanceTimersByTimeAsync(3 * MIN)
    const tick = (remainingSec: number): void =>
      t.bus.emit('session:tick', {
        sessionId: 's1',
        elapsedSec: 1200 - remainingSec,
        remainingSec
      })
    tick(600)
    expect(t.music.status().target).toBe('steady')
    tick(121)
    expect(t.music.status().target).toBe('steady')
    tick(120)
    expect(t.music.status().target).toBe('wind-down')
    await t.music.stopSession()
    Object.assign(gap, musicConfig.switching)
    await t.music.startSession(session())
    t.state('focused')
    await vi.advanceTimersByTimeAsync(3 * MIN)
    tick(600)
    expect(t.music.status().target).toBe('wind-down')
    await t.music.stopSession()
  })

  it.each([true, false])(
    'demo=%s: demo steers at once on a target change, normal waits for the next song',
    async (demo) => {
      const t = await setup({
        songs: [
          song('dark', { energy: 3, mood: 'dark', vocals: 'instrumental' }),
          song('bright', { energy: 3, mood: 'bright', vocals: 'instrumental' }),
          song('loud', { energy: 5, mood: 'dark', vocals: 'instrumental' }),
          song('soft', { energy: 1, mood: 'bright', vocals: 'instrumental' })
        ],
        targetGap: demo
          ? {
              ...sessionConfig.demo.musicTargetGap,
              switchNow: sessionConfig.demo.musicSwitchNow,
              windDownSec: sessionConfig.demo.musicWindDownSec
            }
          : undefined
      })
      const volumes: number[] = []
      t.controller.getVolume = async () => t.controller.volume
      t.controller.setVolume = async (v) => {
        t.controller.volume = v
        volumes.push(v)
      }
      await t.music.startSession(session({ demo }))
      expect(t.controller.calls).toEqual(['play spotify:track:dark'])
      t.controller.queue = ['spotify:track:bright', 'spotify:track:soft']
      t.state('good')
      await vi.advanceTimersByTimeAsync(1000)
      if (!demo) {
        expect(t.controller.calls).toHaveLength(1)
        return t.music.stopSession()
      }
      // The skip is ducked to a quarter of the user's level and brought back.
      expect(t.controller.calls.slice(1)).toEqual(['next'])
      expect(volumes).toEqual([15, 60])
      await vi.advanceTimersByTimeAsync(20_000)
      t.state('crashing')
      await vi.advanceTimersByTimeAsync(3 * musicConfig.switching.settleFadeMs)
      expect(t.music.status().target).toBe('settle')
      // A kept play is settled; the next new song is judged against Quiet.
      expect(t.controller.calls.slice(1)).toEqual(['next'])
      t.controller.start('spotify:track:loud')
      await vi.advanceTimersByTimeAsync(3 * musicConfig.switching.settleFadeMs)
      expect(t.controller.calls.slice(1)).toEqual(['next', 'next'])
      expect(t.controller.volume).toBe(60)
      await t.music.stopSession()
    }
  )

  it('plays one of the user playlists at start when no song fits', async () => {
    const { music, controller } = await setup({ songs: [] })
    const link = await music.addPlaylist(
      'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x'
    )
    await music.startSession(session())
    expect(controller.calls).toEqual([`play ${link.uri}`])
  })

  it('leave alone: no switching, but still learns', async () => {
    const { music, controller, state, targets, setSettings } = await setup()
    music.setLeaveAlone(true)
    expect(setSettings).toHaveBeenCalledWith({ leaveMusicAlone: true })
    await music.startSession(session())
    controller.start('spotify:track:new1')
    await vi.advanceTimersByTimeAsync(3 * MIN)
    state('crashing')
    await vi.advanceTimersByTimeAsync(300_000)
    expect(controller.calls).toEqual([])
    expect(targets()).toEqual([])
    const lib = await music.library()
    expect(lib.songs.map((s) => s.id)).toContain('spotify:track:new1')
  })

  it('pauses on break:away and resumes on break:returned', async () => {
    const { music, controller, bus } = await setup()
    await music.startSession(session())
    controller.start('spotify:track:steady')
    controller.calls = []
    bus.emit('break:away', { since: Date.now(), manual: true })
    bus.emit('break:returned', { awayMs: 1000 })
    bus.emit('break:returned', { awayMs: 1000 })
    expect(controller.calls).toEqual(['pause', 'resume'])
  })

  it('learns from the body: settle votes and quick skips', async () => {
    // Leave-alone keeps learning and keeps steering out of the user's skips.
    const { music, controller, state } = await setup({ songs: [], leaveAlone: true })
    await music.startSession(session())
    state('tense')
    controller.start('spotify:track:a')
    await vi.advanceTimersByTimeAsync(MIN)
    state('focused')
    await vi.advanceTimersByTimeAsync(MIN)
    controller.start('spotify:track:b') // a ended, user moved on after 2 min
    await vi.advanceTimersByTimeAsync(10_000)
    controller.start('spotify:track:c') // user skipped b after 10 s
    await vi.advanceTimersByTimeAsync(0)
    const songs = new Map((await music.library()).songs.map((s) => [s.id, s]))
    expect(songs.get('spotify:track:a')?.learned).toMatchObject({
      settleVotes: 1,
      energyDelta: -0.5,
      plays: 1
    })
    expect(songs.get('spotify:track:b')?.learned).toMatchObject({
      quickSkips: 1,
      confidenceDelta: -0.1
    })
    expect(songs.get('spotify:track:c')?.learned).toBeUndefined()
  })

  it('marks learned songs with source "learned"', async () => {
    const { music, controller, state } = await setup()
    await music.startSession(session())
    state('focused')
    controller.start('spotify:track:steady')
    await vi.advanceTimersByTimeAsync(MIN)
    state('focused')
    controller.start('spotify:track:x')
    await vi.advanceTimersByTimeAsync(0)
    const s = (await music.library()).songs.find((x) => x.id === 'spotify:track:steady')
    expect(s?.learned?.steadyVotes).toBe(1)
    expect(s?.scores?.source).toBe('learned')
  })

  it('data:deleted-all drops songs, playlists and queue without writing songs back', async () => {
    const { music, bus, storage, controller } = await setup()
    await music.addPlaylist('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')
    await music.startSession(session())
    controller.start('spotify:track:steady')
    await vi.advanceTimersByTimeAsync(0)
    storage.writes.length = 0
    bus.emit('data:deleted-all', {})
    await music.stopSession() // would finish the play record and save it if not dropped
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await music.library()).toEqual({ songs: [], playlists: [] })
    expect(storage.writes).toEqual([])
    expect(music.status()).toMatchObject({ scoringQueue: 0, scoredCount: 0 })
  })
})

it('disabling music clears stale now-playing state without controlling playback', async () => {
  const t = await setup()
  await t.music.startSession(session())
  t.controller.start('spotify:track:steady')
  await Promise.resolve()
  expect(t.music.status().nowPlaying).not.toBeNull()
  t.controller.calls = []
  await t.music.stopSession()
  await t.music.startSession(session({ music: false }))
  expect(t.music.status()).toMatchObject({ nowPlaying: null, available: false, target: null })
  t.bus.emit('break:away', { since: Date.now(), manual: true })
  expect(t.controller.calls).toEqual([])
})

it('does not play after deletion while checking Spotify availability', async () => {
  const t = await setup()
  let resolve!: (available: boolean) => void
  let checking!: () => void
  const entered = new Promise<void>((r) => {
    checking = r
  })
  t.controller.isAvailable = () => {
    checking()
    return new Promise((r) => {
      resolve = r
    })
  }
  const started = t.music.startSession(session())
  await entered
  t.bus.emit('data:deleted-all', {})
  resolve(true)
  await started
  expect(t.music.status().available).toBe(false)
  expect(t.controller.calls).toEqual([])
  expect(await t.music.library()).toEqual({ songs: [], playlists: [] })
})

it('deletion cancels a music start which is still waiting for its library', async () => {
  const t = await setup()
  const started = t.music.startSession(session())
  t.bus.emit('data:deleted-all', {})
  await started
  expect(t.controller.cb).toBeUndefined()
  expect(t.music.status().target).toBeNull()
  expect(t.controller.calls).toEqual([])
})

it('starts a catalog track in its playlist context, then lets the playlist run', async () => {
  const html = readFileSync(new URL('./library/fixtures/piano.html', import.meta.url), 'utf8')
  const f = vi.fn(async () => new Response(html))
  const t = await setup({ songs: [], fetch: f, playlists: [] })
  const p = await t.music.addPlaylist(PL2)
  await t.music.startSession(session())
  expect(t.controller.calls).toHaveLength(1)
  expect(t.controller.calls[0]).toMatch(/^play spotify:track:/)
  expect(t.controller.contexts[0]).toBe(p.uri)
  // Song ends: Spotify's own shuffle moves on; no further play track (no pop-up).
  t.controller.start(t.controller.np!.id, 5000)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(t.controller.calls.filter((c) => c.startsWith('play'))).toHaveLength(1)
  await t.music.stopSession()
})

it('refreshes availability when status is requested without a session, without launching Spotify', async () => {
  const t = await setup()
  expect(t.music.status().available).toBe(false)
  await vi.advanceTimersByTimeAsync(0)
  expect(t.music.status().available).toBe(true)
  t.controller.running = false
  await vi.advanceTimersByTimeAsync(0)
  t.music.status()
  await vi.advanceTimersByTimeAsync(0)
  expect(t.music.status().available).toBe(false)
  expect(t.controller.calls).toEqual([])
})

it('learns a fresh play when the same track restarts after exhaustion', async () => {
  const s = song('only', { energy: 3 })
  const t = await setup({ songs: [s] })
  await t.music.startSession(session())
  t.controller.start(s.id, 200_000)
  await vi.advanceTimersByTimeAsync(40_000)
  t.controller.start(s.id, 200_000)
  await vi.advanceTimersByTimeAsync(0)
  expect((await t.music.library()).songs[0].playCount).toBe(2)
  expect((await t.music.library()).songs[0].learned?.plays).toBe(1)
  await t.music.stopSession()
})

it('a pending old pick cannot block playback in a new session', async () => {
  const t = await setup()
  let resolve!: (value: boolean) => void
  let entered!: () => void
  const checking = new Promise<void>((r) => {
    entered = r
  })
  t.controller.isAvailable = vi
    .fn()
    .mockImplementationOnce(() => {
      entered()
      return new Promise<boolean>((r) => {
        resolve = r
      })
    })
    .mockResolvedValue(true)
  const old = t.music.startSession(session())
  await checking
  await t.music.startSession({ ...session(), id: 'new' })
  expect(t.controller.calls).toEqual(['play spotify:track:steady'])
  resolve(true)
  await old
  expect(t.controller.calls).toHaveLength(1)
  await t.music.stopSession()
})

it('repicks if Spotify did not start the requested song after one poll', async () => {
  const t = await setup({ songs: [song('steady', { energy: 3 }), song('calm', { energy: 1 })] })
  t.controller.start('spotify:track:outside')
  const play = t.controller.play
  t.controller.play = async (uri, context) => {
    if (uri === 'spotify:track:steady') t.controller.calls.push(`play ${uri}`)
    else await play(uri, context)
  }
  await t.music.startSession(session())
  expect(t.controller.calls).toEqual(['play spotify:track:steady'])
  await vi.advanceTimersByTimeAsync(musicConfig.controller.playVerifyMs)
  expect(t.controller.calls).toEqual(['play spotify:track:steady', 'play spotify:track:calm'])
  await vi.advanceTimersByTimeAsync(2000)
  expect(t.controller.calls).toHaveLength(2)
  await t.music.stopSession()
})

it('tries another song after a playback command fails', async () => {
  const t = await setup({ songs: [song('steady', { energy: 3 }), song('calm', { energy: 1 })] })
  const play = t.controller.play
  t.controller.play = async (uri, context) => {
    if (uri === 'spotify:track:steady') throw new Error('unavailable')
    await play(uri, context)
  }
  await t.music.startSession(session())
  await vi.advanceTimersByTimeAsync(0)
  expect(t.controller.calls).toEqual(['play spotify:track:calm'])
  await t.music.stopSession()
})

it('awaits the controller check for status IPC and shares an already pending check', async () => {
  const t = await setup()
  let resolve!: (available: boolean) => void
  t.controller.isAvailable = vi.fn(
    () =>
      new Promise<boolean>((r) => {
        resolve = r
      })
  )
  t.music.status()
  vi.mocked(handle).mockClear()
  registerMusicIpc(t.music)
  const handler = vi.mocked(handle).mock.calls.find(([channel]) => channel === 'music:status')![1]
  const result = handler(undefined as never)
  let settled = false
  void Promise.resolve(result).then(() => {
    settled = true
  })
  await Promise.resolve()
  expect(settled).toBe(false)
  expect(t.controller.isAvailable).toHaveBeenCalledTimes(1)
  resolve(true)
  await expect(result).resolves.toMatchObject({ available: true })
  expect(t.controller.calls).toEqual([])
  t.controller.isAvailable = vi.fn().mockRejectedValue(new Error('unavailable'))
  await expect(handler(undefined as never)).resolves.toMatchObject({ available: false })
})

describe('playback confirmation', () => {
  function loadPaused(t: Awaited<ReturnType<typeof setup>>): ReturnType<typeof vi.spyOn> {
    const play = t.controller.play
    return vi.spyOn(t.controller, 'play').mockImplementation(async (uri, context) => {
      await play(uri, context)
      if (t.controller.np) {
        t.controller.np.state = 'paused'
        t.controller.cb?.(t.controller.np)
      }
    })
  }

  it.each([false, true])(
    'waits for a cold player after dialog availability succeeds (demo=%s)',
    async (demo) => {
      const t = await setup()
      t.controller.np = null
      expect(await t.music.refreshStatus()).toMatchObject({ available: true })
      const started = t.music.startSession(session({ demo }))
      await vi.advanceTimersByTimeAsync(musicConfig.controller.readyWaitMs - 1)
      expect(t.controller.calls).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      await started
      expect(t.controller.calls).toEqual(['play spotify:track:steady'])
      await t.music.stopSession()
    }
  )

  it('waits before the first play when the session availability retry sees Spotify open', async () => {
    const t = await setup()
    t.controller.running = false
    t.controller.np = null
    await t.music.startSession(session())
    t.controller.running = true
    await vi.advanceTimersByTimeAsync(musicConfig.controller.unavailableRetryMs)
    t.bus.emit('session:tick', { sessionId: 's1', elapsedSec: 10, remainingSec: 3590 })
    await vi.advanceTimersByTimeAsync(musicConfig.controller.readyWaitMs - 1)
    expect(t.controller.calls).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(t.controller.calls).toEqual(['play spotify:track:steady'])
    await t.music.stopSession()
  })

  it('cancels the startup wait when the session stops', async () => {
    const t = await setup()
    t.controller.np = null
    const started = t.music.startSession(session())
    await vi.advanceTimersByTimeAsync(0)
    await t.music.stopSession()
    await started
    await vi.advanceTimersByTimeAsync(10_000)
    expect(t.controller.calls).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries a loaded paused track, then leaves a later user pause alone', async () => {
    const t = await setup()
    const play = t.controller.play
    let attempts = 0
    t.controller.play = async (uri, context) => {
      await play(uri, context)
      if (++attempts === 1) t.controller.np!.state = 'paused'
      t.controller.cb?.(t.controller.np!)
    }
    await t.music.startSession(session())
    expect(t.music.status().nowPlaying?.state).toBe('paused')
    await vi.advanceTimersByTimeAsync(musicConfig.controller.playVerifyMs - 1)
    expect(attempts).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(attempts).toBe(2)
    expect(t.music.status().nowPlaying?.state).toBe('playing')
    t.controller.np!.state = 'paused'
    t.controller.cb?.(t.controller.np!)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(attempts).toBe(2)
    expect(t.controller.contexts[1]).toBe(t.controller.contexts[0])
    await t.music.stopSession()
  })

  it('confirms immediate success without a track-change event and respects a quick user pause', async () => {
    const t = await setup()
    const play = vi.spyOn(t.controller, 'play')
    await t.music.startSession(session())
    t.controller.np!.state = 'paused'
    await vi.advanceTimersByTimeAsync(30_000)
    expect(play).toHaveBeenCalledTimes(1)
    await t.music.stopSession()
  })

  it('limits a permanently paused track to the configured total attempts', async () => {
    const t = await setup()
    const play = loadPaused(t)
    await t.music.startSession(session())
    await vi.advanceTimersByTimeAsync(60_000)
    expect(play).toHaveBeenCalledTimes(musicConfig.controller.maxPlayAttempts)
    expect(new Set(t.controller.calls)).toEqual(new Set(['play spotify:track:steady']))
    await t.music.stopSession()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries when the player cannot be read, including a failed retry reply', async () => {
    const t = await setup()
    const play = loadPaused(t)
    await t.music.startSession(session())
    t.controller.current = vi.fn().mockRejectedValue(new Error('player still loading'))
    play.mockImplementationOnce(async () => {
      throw new Error('no reply')
    })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(play).toHaveBeenCalledTimes(musicConfig.controller.maxPlayAttempts)
    await t.music.stopSession()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('verifies playlist fallback plays too', async () => {
    const t = await setup({ songs: [] })
    const link = await t.music.addPlaylist('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')
    const play = loadPaused(t)
    await t.music.startSession(session())
    await vi.advanceTimersByTimeAsync(30_000)
    expect(play).toHaveBeenCalledTimes(musicConfig.controller.maxPlayAttempts)
    expect(new Set(t.controller.calls)).toEqual(new Set([`play ${link.uri}`]))
    await t.music.stopSession()
  })

  it.each(['stop', 'leave-alone', 'break', 'delete', 'privacy', 'closed'] as const)(
    'cancels pending retries on %s',
    async (reason) => {
      const t = await setup()
      const play = loadPaused(t)
      await t.music.startSession(session())
      if (reason === 'stop') await t.music.stopSession()
      if (reason === 'leave-alone') t.music.setLeaveAlone(true)
      if (reason === 'break') t.bus.emit('break:away', { since: Date.now(), manual: true })
      if (reason === 'delete') t.bus.emit('data:deleted-all', {})
      if (reason === 'privacy') t.bus.emit('privacy:changed', { ...DEFAULT_PRIVACY, music: 'none' })
      if (reason === 'closed') t.controller.running = false
      await vi.advanceTimersByTimeAsync(30_000)
      expect(play).toHaveBeenCalledTimes(1)
      await t.music.stopSession()
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it.each(['playing', 'paused'] as const)(
    'leaves a user-selected %s track alone during verification',
    async (state) => {
      const t = await setup()
      const play = loadPaused(t)
      await t.music.startSession(session())
      t.controller.start('spotify:track:mine')
      t.controller.np!.state = state
      t.controller.cb?.(t.controller.np!)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(play).toHaveBeenCalledTimes(1)
      await t.music.stopSession()
    }
  )
})

it('simulator switchNow plays the current target before track end and never plays when Spotify is closed', async () => {
  const { music, controller, state } = await setup({ privacy: { music: 'spotify' } })
  await music.startSession(session())
  controller.calls.length = 0
  state('low')
  expect(music.status().target).toBe('lift')
  await music.switchNow()
  expect(controller.calls.some((c) => c.startsWith('play '))).toBe(true)
  controller.calls.length = 0
  controller.running = false
  await music.switchNow()
  expect(controller.calls).toEqual([])
  await music.stopSession()
})

it('simulator switchNow preserves leave-alone and no-session guards', async () => {
  const { music, controller } = await setup({ privacy: { music: 'spotify' }, leaveAlone: true })
  await music.switchNow()
  await music.startSession(session())
  await music.switchNow()
  expect(controller.calls).toEqual([])
  await music.stopSession()
})

describe('steering inside a playlist (decision 61)', () => {
  const MANY = [
    song('s1', { energy: 3, vocals: 'instrumental' }, [PL, PL2]),
    song('s2', { energy: 3, vocals: 'instrumental' }, [PL2]),
    song('s3', { energy: 3, vocals: 'instrumental' }, [PL2]),
    song('loud1', { energy: 5, mood: 'dark' }),
    song('loud2', { energy: 5, mood: 'dark' }),
    song('loud3', { energy: 5, mood: 'dark' }),
    song('mine', { energy: 3, vocals: 'instrumental' })
  ]

  it.each([false, true])(
    'demo=%s: stale reads after a skip cannot skip the good song',
    async (demo) => {
      const t = await setup({
        songs: MANY,
        targetGap: demo ? { switchNow: true, minTargetChangeMs: 20_000 } : undefined
      })
      await t.music.startSession(session({ demo }))
      t.controller.calls = []
      t.controller.next = async () => {
        t.controller.calls.push('next')
        // Spotify keeps returning the old id after accepting next track.
        setTimeout(() => t.controller.start('spotify:track:mine'), 1500)
      }
      t.controller.start('spotify:track:loud1')
      const stale = { ...t.controller.np! }
      await vi.advanceTimersByTimeAsync(1000)
      t.controller.cb?.(stale)
      expect(t.controller.calls).toEqual(['next'])
      await vi.advanceTimersByTimeAsync(1000)
      t.controller.cb?.(stale) // a delayed poll reply after the new song arrived
      await vi.advanceTimersByTimeAsync(5000)
      expect(t.controller.calls).toEqual(['next'])
      expect(t.music.status().nowPlaying?.id).toBe('spotify:track:mine')
      expect(t.decisions.filter((d) => d.action === 'keep')).toHaveLength(1)
      await t.music.stopSession()
    }
  )

  it('a kept song stays kept through duplicate polls, pause/resume and target changes', async () => {
    const t = await setup({ songs: MANY, targetGap: { switchNow: true, minTargetChangeMs: 0 } })
    await t.music.startSession(session())
    t.controller.start('spotify:track:mine')
    await vi.advanceTimersByTimeAsync(0)
    t.controller.calls = []
    t.controller.cb?.(t.controller.np!)
    t.state('crashing')
    await vi.advanceTimersByTimeAsync(0)
    t.controller.np = { ...t.controller.np!, state: 'paused' }
    t.controller.cb?.(t.controller.np)
    t.controller.np = { ...t.controller.np, state: 'playing' }
    t.controller.cb?.(t.controller.np)
    await vi.advanceTimersByTimeAsync(5000)
    expect(t.controller.calls).toEqual([])
    expect(t.decisions.filter((d) => d.action === 'keep')).toHaveLength(1)
    await t.music.stopSession()
  })

  it('judges a new play of a previously kept id after another track', async () => {
    const t = await setup({ songs: [...MANY, song('spare', { energy: 3 })] })
    await t.music.startSession(session())
    t.controller.start('spotify:track:mine')
    await vi.advanceTimersByTimeAsync(1000)
    t.controller.start('spotify:track:s1')
    await vi.advanceTimersByTimeAsync(1000)
    t.controller.calls = []
    t.controller.queue = ['spotify:track:s2']
    t.controller.start('spotify:track:mine')
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.controller.calls).toEqual(['next'])
    await t.music.stopSession()
  })

  it('judges a genuine same-id restart as a new play without counting duplicate polls', async () => {
    const t = await setup({ songs: MANY })
    await t.music.startSession(session())
    t.controller.start('spotify:track:mine', 20_000)
    await vi.advanceTimersByTimeAsync(1000)
    t.controller.np = { ...t.controller.np!, positionMs: 1000 }
    t.controller.cb?.(t.controller.np)
    await vi.advanceTimersByTimeAsync(19_000)
    t.controller.start('spotify:track:mine', 20_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(t.decisions.filter((d) => d.action === 'keep')).toHaveLength(2)
    expect(t.music.status().playlist?.played).toBe(1)
    await t.music.stopSession()
  })

  it('stops a skip chain when the next item is an ad', async () => {
    const t = await setup({ songs: MANY })
    await t.music.startSession(session())
    t.controller.calls = []
    t.controller.next = async () => {
      t.controller.calls.push('next')
      t.controller.np = parseNowPlaying(
        [
          'spotify:track:promo',
          'Listen to music, ad-free.',
          '',
          '',
          '30000',
          '0',
          'playing',
          ''
        ].join('\t')
      )
      t.controller.cb?.(t.controller.np!)
    }
    t.controller.start('spotify:track:loud1')
    await vi.advanceTimersByTimeAsync(5000)
    expect(t.controller.calls).toEqual(['next'])
    expect(t.music.status().playlist?.played).toBe(0)
    expect((await t.music.library()).songs.some((s) => s.id === 'spotify:track:promo')).toBe(false)
    await t.music.stopSession()
  })

  it('times out a refused skip without retrying the same id on later judgments', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = await setup({ songs: MANY, targetGap: { switchNow: true, minTargetChangeMs: 0 } })
    await t.music.startSession(session())
    t.controller.calls = []
    t.controller.start('spotify:track:loud1')
    await vi.advanceTimersByTimeAsync(musicConfig.steering.skipWaitMs + 1000)
    t.controller.cb?.(t.controller.np!)
    t.state('crashing')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(t.controller.calls).toEqual(['next'])
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
    await t.music.stopSession()
  })

  it.each([
    ['spotify:ad:promo', 'An ad', 'Artist', 'Album', '30000'],
    ['spotify:track:promo', 'Listen to music, ad-free.', '', '', '30000'],
    ['spotify:track:promo', 'A sponsor', '', 'Advertisement', '30000'],
    ['spotify:track:promo', 'A sponsor', '', '', '0']
  ])('never skips, learns or counts ad %j / %j', async (id, name, artist, album, duration) => {
    const t = await setup({ songs: MANY })
    await t.music.startSession(session())
    t.controller.calls = []
    const ad = parseNowPlaying([id, name, artist, album, duration, '0', 'playing', id].join('\t'))!
    t.controller.np = ad
    t.controller.cb?.(ad)
    await vi.advanceTimersByTimeAsync(40_000)
    t.controller.start('spotify:track:mine')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.controller.calls).toEqual([])
    expect(t.music.status().playlist?.played).toBe(0)
    expect((await t.music.library()).songs.some((s) => s.id === id)).toBe(false)
    await t.music.stopSession()
  })

  it('starts the playlist with the most fitting songs, shuffle on, and restores shuffle/repeat at the end', async () => {
    const t = await setup({ songs: MANY, playlists: [PL, PL2] })
    await t.music.startSession(session())
    expect(t.controller.calls).toEqual(['play spotify:track:s1'])
    expect(t.controller.contexts).toEqual([PL2])
    expect(t.controller.mode).toEqual({ shuffle: true, repeat: true })
    await t.music.stopSession()
    expect(t.controller.mode).toEqual({ shuffle: false, repeat: true })

    // The user turned shuffle off themselves: they took over, leave it.
    await t.music.startSession({ ...session(), id: 's2' })
    t.controller.mode = { shuffle: false, repeat: false }
    await t.music.stopSession()
    expect(t.controller.mode).toEqual({ shuffle: false, repeat: false })
  })

  it('keeps a fitting song, ducks a skip to a quarter, and leaves ads alone', async () => {
    const t = await setup({
      songs: [...MANY, song('spare', { energy: 3, vocals: 'instrumental' })]
    })
    const volumes: number[] = []
    t.controller.getVolume = async () => t.controller.volume
    t.controller.setVolume = async (v) => {
      t.controller.volume = v
      volumes.push(v)
    }
    await t.music.startSession(session())
    t.controller.calls = []
    t.controller.start('spotify:track:mine')
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.controller.calls).toEqual([])

    t.controller.np = { ...t.controller.np!, id: 'spotify:ad:x', uri: 'spotify:ad:x', artist: '' }
    t.controller.np.isAd = true
    t.controller.cb?.(t.controller.np)
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.controller.calls).toEqual([])

    t.controller.queue = ['spotify:track:loud2', 'spotify:track:spare']
    t.controller.start('spotify:track:loud1')
    await vi.advanceTimersByTimeAsync(2000)
    expect(t.controller.calls).toEqual(['next', 'next'])
    expect(volumes).toEqual([15, 60])
    // App skips are not the user's quick skips.
    const songs = new Map((await t.music.library()).songs.map((s) => [s.id, s]))
    expect(songs.get('spotify:track:loud1')?.learned?.quickSkips ?? 0).toBe(0)
    await t.music.stopSession()
  })

  it('treats the same title by the same lead artist as a repeat', async () => {
    const t = await setup({
      songs: [
        song('a', { energy: 3, vocals: 'instrumental' }),
        { ...song('a2', { energy: 3, vocals: 'instrumental' }), title: 'a', artist: 'a, b' },
        song('b', { energy: 3, vocals: 'instrumental' })
      ]
    })
    await t.music.startSession(session())
    t.controller.start('spotify:track:a')
    t.controller.calls = []
    t.controller.queue = ['spotify:track:b']
    const dup = { ...t.controller.np!, id: 'spotify:track:a2', uri: 'spotify:track:a2' }
    t.controller.np = { ...dup, artist: 'a, b' }
    t.controller.cb?.(t.controller.np)
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.controller.calls).toEqual(['next'])
    await t.music.stopSession()
  })

  it('switches playlist after the skip cap, refocusing via the controller, at most once per gap', async () => {
    const loud = Array.from({ length: 12 }, (_, i) => song(`l${i}`, { energy: 5, mood: 'dark' }))
    const t = await setup({ songs: [...loud, ...MANY], playlists: [PL, PL2] })
    await t.music.startSession(session())
    expect(t.controller.contexts).toEqual([PL2])
    t.controller.calls = []
    await vi.advanceTimersByTimeAsync(musicConfig.steering.switchGapMs)
    t.controller.queue = loud.slice(1).map((s) => s.id)
    t.controller.start(loud[0].id)
    await vi.advanceTimersByTimeAsync(10_000)
    const { maxSkips } = musicConfig.steering
    expect(t.controller.calls.filter((c) => c === 'next')).toHaveLength(maxSkips)
    expect(t.controller.calls.at(-1)).toMatch(/^play spotify:track:(mine|s1)$/)
    expect(t.controller.contexts.at(-1)).toBe(PL)

    // Another capped chain inside the gap keeps the song instead of popping Spotify up again.
    t.controller.calls = []
    t.controller.queue = loud.map((s) => s.id).reverse()
    t.controller.start('spotify:track:loud3')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(t.controller.calls.filter((c) => c.startsWith('play'))).toEqual([])
    await t.music.stopSession()
  })

  it('switches at once when the playlist has no fitting unplayed song left, else keeps the song', async () => {
    const fit = { energy: 3 as const, vocals: 'instrumental' as const }
    const t = await setup({
      songs: [
        song('p1', fit),
        song('fitA', fit, [PL2]),
        song('fitB', fit, [PL2]),
        song('dark', { energy: 5, mood: 'dark' }, [PL2])
      ],
      playlists: [PL, PL2]
    })
    await t.music.startSession(session())
    expect(t.controller.contexts).toEqual([PL2])
    await vi.advanceTimersByTimeAsync(musicConfig.steering.switchGapMs)
    t.controller.calls = []
    t.controller.start('spotify:track:fitA')
    t.controller.start('spotify:track:fitB')
    t.controller.start('spotify:track:dark')
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.controller.calls).toEqual(['play spotify:track:p1'])
    expect(t.controller.contexts.at(-1)).toBe(PL)
    expect(t.decisions).toContainEqual(
      expect.objectContaining({ action: 'switch', reason: 'mood needs', from: PL2, to: PL })
    )

    // Every own fit is heard now: the next switch falls back to the target's editorial playlist.
    await vi.advanceTimersByTimeAsync(musicConfig.steering.switchGapMs)
    t.controller.start('spotify:track:p1')
    t.controller.calls = []
    t.controller.start('spotify:track:dark')
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.controller.calls.filter((c) => c.startsWith('play '))).toEqual([
      `play ${FALLBACK_PLAYLISTS.steady[0].replace('https://open.spotify.com/playlist/', 'spotify:playlist:')}`
    ])
    expect(t.decisions).toContainEqual(
      expect.objectContaining({ action: 'switch', reason: 'editorial fallback' })
    )
    await t.music.stopSession()
  })

  it('keeps the song and logs once when Spotify refuses a skip', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = await setup({ songs: MANY })
    await t.music.startSession(session())
    t.controller.calls = []
    t.controller.start('spotify:track:loud1')
    await vi.advanceTimersByTimeAsync(musicConfig.steering.skipWaitMs + 1000)
    t.controller.start('spotify:track:loud2')
    await vi.advanceTimersByTimeAsync(musicConfig.steering.skipWaitMs + 1000)
    expect(t.controller.calls).toEqual(['next', 'next'])
    expect(t.controller.np?.id).toBe('spotify:track:loud2')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
    await t.music.stopSession()
  })

  it('never steers during leave-alone or a break', async () => {
    const t = await setup({ songs: MANY })
    await t.music.startSession(session())
    t.controller.start('spotify:track:mine')
    t.bus.emit('break:away', { since: Date.now(), manual: true })
    t.controller.calls = []
    t.controller.start('spotify:track:loud1')
    await vi.advanceTimersByTimeAsync(5000)
    expect(t.controller.calls).toEqual([])
    await t.music.stopSession()
  })
})

describe('playlist variety (decision 64)', () => {
  const PL3 = 'spotify:playlist:1111111111111111111111'
  const fit = { energy: 2 as const, vocals: 'instrumental' as const }
  const shortCount: TargetGap = {
    minTargetChangeMs: musicConfig.switching.minTargetChangeMs,
    switchAfterSongs: { focus: 2, reading: 2, creative: 2, everyday: 2, unwind: 2 }
  }
  const pool = (prefix: string, count: number, uri = PL): Song[] =>
    Array.from({ length: count }, (_, i) => song(`${prefix}${i}`, fit, [uri]))
  const plays = (t: Awaited<ReturnType<typeof setup>>): string[] =>
    t.controller.calls.filter((c) => c.startsWith('play '))

  async function boundary(
    t: Awaited<ReturnType<typeof setup>>,
    id: string,
    ms = 200_000
  ): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms)
    t.controller.start(id)
    await vi.advanceTimersByTimeAsync(0)
  }

  it.each(['focus', 'reading', 'creative', 'everyday', 'unwind'] as const)(
    'switches after exactly the configured number of completed songs for %s, never mid-song',
    async (activity) => {
      const count = musicConfig.steering.switchAfterSongs[activity]
      const scores = {
        ...fit,
        energy: musicConfig.activityLean[activity].min,
        mood: 'bright' as const
      }
      const own = pool('own', count + 2).map((s) => ({ ...s, scores: { ...s.scores!, ...scores } }))
      const other = pool('other', 2, PL2).map((s) => ({
        ...s,
        scores: { ...s.scores!, ...scores }
      }))
      const t = await setup({ songs: [...own, ...other], playlists: [PL, PL2] })
      await t.music.startSession(session({ activity }))
      t.controller.start(own[0].id)
      await vi.advanceTimersByTimeAsync(0)
      for (let i = 1; i < count; i++) await boundary(t, own[i].id)
      await vi.advanceTimersByTimeAsync(200_000)
      expect(plays(t)).toHaveLength(1)
      t.controller.start(own[count].id)
      await vi.advanceTimersByTimeAsync(0)
      expect(plays(t)).toHaveLength(2)
      expect(t.controller.contexts).toEqual([PL, PL2])
      expect(t.decisions).toContainEqual(
        expect.objectContaining({
          action: 'playlist',
          reason: 'song completed',
          played: count,
          playlist: PL
        })
      )
      expect(t.decisions).toContainEqual(
        expect.objectContaining({
          action: 'switch',
          reason: 'song count',
          from: PL,
          to: PL2,
          played: 0
        })
      )
      expect(t.music.status().playlist).toEqual({ uri: PL2, name: undefined, played: 0 })
      await t.music.stopSession()
      expect(t.music.status().playlist).toBeUndefined()
    }
  )

  it('ignores user skips, app skips, ads and paused time', async () => {
    const own = pool('own', 12)
    const t = await setup({
      songs: [...own, ...pool('other', 3, PL2), song('loud', { energy: 5, mood: 'dark' })],
      playlists: [PL, PL2],
      targetGap: shortCount
    })
    await t.music.startSession(session())
    t.controller.start(own[0].id)
    await boundary(t, own[1].id, 5000) // quick user skip
    await boundary(t, own[2].id, 100_000) // later user skip, still not completed
    await boundary(t, 'spotify:track:loud', 5000)
    t.controller.queue = [own[3].id]
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.controller.calls).toContain('next')
    await vi.advanceTimersByTimeAsync(5000)
    t.controller.np = { ...t.controller.np!, id: 'spotify:ad:x', uri: 'spotify:ad:x', isAd: true }
    t.controller.cb?.(t.controller.np)
    await boundary(t, own[4].id)
    expect(plays(t)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(5000)
    t.controller.np = { ...t.controller.np!, state: 'paused' }
    t.controller.cb?.(t.controller.np)
    await vi.advanceTimersByTimeAsync(200_000)
    t.controller.np = { ...t.controller.np!, state: 'playing' }
    t.controller.cb?.(t.controller.np)
    await boundary(t, own[5].id, 5000) // the long pause is not listening
    await boundary(t, own[6].id)
    expect(plays(t)).toHaveLength(1)
    await boundary(t, own[7].id)
    expect(t.controller.contexts).toEqual([PL, PL2])
    await t.music.stopSession()
  })

  it('counts completed short songs too, without treating an early skip as a play', async () => {
    const a = pool('a', 5)
    const t = await setup({
      songs: [...a, ...pool('b', 3, PL2)],
      playlists: [PL, PL2],
      targetGap: shortCount
    })
    await t.music.startSession(session())
    await vi.advanceTimersByTimeAsync(musicConfig.steering.switchGapMs)
    t.controller.start(a[0].id, 20_000)
    await vi.advanceTimersByTimeAsync(20_000)
    t.controller.start(a[1].id, 20_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(plays(t)).toHaveLength(1)
    await boundary(t, a[2].id, 20_000)
    expect(t.controller.contexts).toEqual([PL, PL2])
    await t.music.stopSession()
  })

  it('prefers an unused playlist over a used playlist with more fits and resets on each switch', async () => {
    const a = pool('a', 8)
    const b = pool('b', 5, PL2)
    const c = pool('c', 3, PL3)
    const t = await setup({
      songs: [...a, ...b, ...c],
      playlists: [PL, PL2, PL3],
      targetGap: shortCount
    })
    await t.music.startSession(session())
    t.controller.start(a[0].id)
    await boundary(t, a[1].id)
    await boundary(t, a[2].id)
    expect(t.controller.contexts).toEqual([PL, PL2])
    t.controller.start(t.controller.np!.id)
    await vi.advanceTimersByTimeAsync(0)
    await boundary(t, b[1].id)
    expect(t.controller.contexts).toEqual([PL, PL2])
    await boundary(t, b[2].id)
    expect(t.controller.contexts).toEqual([PL, PL2, PL3])
    await t.music.stopSession()
    // Session history and the count start fresh.
    await t.music.startSession({ ...session(), id: 'new' })
    expect(t.controller.contexts.at(-1)).toBe(PL)
    await t.music.stopSession()
  })

  it('resets the count after an early mood-driven switch', async () => {
    const a = pool('a', 8)
    const b = pool('b', 5, PL3).map((s) => ({ ...s, scores: { ...s.scores!, energy: 1 as const } }))
    const t = await setup({ songs: [...a, ...b], playlists: [PL, PL3], targetGap: shortCount })
    await t.music.startSession(session())
    t.controller.start(a[0].id)
    await boundary(t, a[1].id)
    t.state('tense')
    await vi.advanceTimersByTimeAsync(0)
    // Calm down needs energy 1 after the kept energy-2 song; no fit remains in PL.
    await boundary(t, a[2].id, 5000)
    expect(t.controller.contexts).toEqual([PL, PL3])
    t.controller.start(t.controller.np!.id)
    await vi.advanceTimersByTimeAsync(0)
    await boundary(t, b[1].id)
    expect(plays(t)).toHaveLength(2)
    await boundary(t, b[2].id)
    expect(plays(t)).toHaveLength(3) // both own alternatives exhausted for Calm down: editorial
    await t.music.stopSession()
  })

  it('falls back to the matching editorial playlist only on a switch, including an unreadable catalog', async () => {
    const a = pool('a', 5)
    const t = await setup({
      songs: [...a, song('wrong', { energy: 5, mood: 'dark' }, [PL2])],
      playlists: [PL, PL2],
      targetGap: shortCount
    })
    await t.music.startSession(session())
    expect(t.controller.contexts).toEqual([PL])
    t.controller.start(a[0].id)
    await boundary(t, a[1].id)
    await boundary(t, a[2].id)
    const editorial = FALLBACK_PLAYLISTS.steady[0].replace(
      'https://open.spotify.com/playlist/',
      'spotify:playlist:'
    )
    expect(plays(t)).toEqual([`play ${a[0].id}`, `play ${editorial}`])
    await t.music.stopSession()
  })

  it('stays with a single playlist, without reading editorial playlists', async () => {
    const a = pool('a', 5)
    const fetch = vi.fn(async () => {
      throw new Error('offline')
    })
    const t = await setup({ songs: a, fetch, targetGap: shortCount })
    await t.music.startSession(session())
    fetch.mockClear()
    t.controller.start(a[0].id)
    await boundary(t, a[1].id)
    await boundary(t, a[2].id)
    t.state('tense')
    await boundary(t, a[3].id)
    expect(plays(t)).toHaveLength(1)
    expect(fetch).not.toHaveBeenCalled()
    expect(t.decisions).toContainEqual(
      expect.objectContaining({ action: 'switch blocked', reason: 'single playlist' })
    )
    await t.music.stopSession()
  })

  it('keeps the switch gap and waits for another song change after it expires', async () => {
    const a = pool('a', 8)
    const t = await setup({
      songs: [...a, ...pool('b', 3, PL2)],
      playlists: [PL, PL2],
      targetGap: shortCount
    })
    await t.music.startSession(session())
    t.controller.start(a[0].id, 40_000)
    await vi.advanceTimersByTimeAsync(40_000)
    t.controller.start(a[1].id, 40_000)
    await vi.advanceTimersByTimeAsync(40_000)
    t.controller.start(a[2].id)
    await vi.advanceTimersByTimeAsync(0)
    expect(plays(t)).toHaveLength(1)
    expect(t.decisions).toContainEqual(
      expect.objectContaining({ action: 'switch blocked', reason: 'gap' })
    )
    await vi.advanceTimersByTimeAsync(musicConfig.steering.switchGapMs)
    t.state('focused')
    await vi.advanceTimersByTimeAsync(0)
    expect(plays(t)).toHaveLength(1)
    t.controller.start(a[3].id)
    await vi.advanceTimersByTimeAsync(0)
    expect(t.controller.contexts).toEqual([PL, PL2])
    await t.music.stopSession()
  })

  it.each(['focus', 'reading', 'creative', 'everyday', 'unwind'] as const)(
    'uses the demo overlay count of 3 for %s',
    async (activity) => {
      const scores = {
        ...fit,
        energy: musicConfig.activityLean[activity].min,
        mood: 'bright' as const
      }
      const a = pool('a', 8).map((s) => ({ ...s, scores: { ...s.scores!, ...scores } }))
      const b = pool('b', 3, PL2).map((s) => ({ ...s, scores: { ...s.scores!, ...scores } }))
      const t = await setup({
        songs: [...a, ...b],
        playlists: [PL, PL2],
        targetGap: { ...shortCount, switchAfterSongs: sessionConfig.demo.musicSwitchAfterSongs }
      })
      await t.music.startSession(session({ activity, demo: true }))
      t.controller.start(a[0].id)
      await boundary(t, a[1].id)
      await boundary(t, a[2].id)
      expect(plays(t)).toHaveLength(1)
      await boundary(t, a[3].id)
      expect(t.controller.contexts).toEqual([PL, PL2])
      await t.music.stopSession()
    }
  )
})

it('reports coarse steering decisions and keeps the same skip/keep behaviour', async () => {
  const t = await setup()
  await t.music.startSession(session())
  expect(t.decisions).toContainEqual(
    expect.objectContaining({ action: 'switch', reason: 'start', from: 'none', to: PL, played: 0 })
  )
  expect(t.decisions).toContainEqual(
    expect.objectContaining({ action: 'refocus', reason: 'previous app requested' })
  )
  t.controller.calls = []
  t.controller.queue = ['spotify:track:calm']
  t.state('crashing')
  await vi.advanceTimersByTimeAsync(6000)
  expect(t.decisions).toContainEqual(
    expect.objectContaining({ action: 'skip', reason: "doesn't fit Quiet" })
  )
  expect(t.decisions).toContainEqual(
    expect.objectContaining({ action: 'keep', reason: 'fits target' })
  )
  expect(t.controller.calls).toEqual(['next'])
  expect(JSON.stringify(t.decisions)).not.toMatch(/pulse|breathing|hrv|baseline|landmarks/i)
  await t.music.stopSession()
})

it('reports no fitting playlist when the current editorial playlist has no alternative', async () => {
  const editorial = FALLBACK_PLAYLISTS.steady[0].replace(
    'https://open.spotify.com/playlist/',
    'spotify:playlist:'
  )
  const t = await setup({
    playlists: [],
    songs: [song('only', { energy: 2, vocals: 'instrumental' }, [editorial])]
  })
  await t.music.startSession(session())
  t.controller.start('spotify:track:only')
  await vi.advanceTimersByTimeAsync(musicConfig.steering.switchGapMs)
  t.controller.calls = []
  t.controller.start('spotify:track:unknown')
  await vi.advanceTimersByTimeAsync(0)
  expect(t.decisions).toContainEqual(
    expect.objectContaining({ action: 'switch blocked', reason: 'no fitting playlist' })
  )
  expect(t.controller.calls).toEqual([])
  await t.music.stopSession()
})
