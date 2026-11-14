import type {
  BusEvents,
  MusicController,
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
import { createMusic } from '.'

vi.mock('../ipc', () => ({ handle: vi.fn() }))

class FakeController implements MusicController {
  running = true
  calls: string[] = []
  contexts: (string | undefined)[] = []
  np: NowPlaying | null = null
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
  next = async (): Promise<void> => {}
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

const song = (id: string, s: Partial<SongScores>): Song => ({
  id: `spotify:track:${id}`,
  title: id,
  artist: 'a',
  firstSeenAt: 0,
  playCount: 0,
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
    activity: 'deep-work',
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
    targetGap?: { minTargetChangeMs: number; downtimeChangeMultiplier: number }
  } = {}
) {
  const bus = createBus()
  const storage = memoryStorage()
  storage.files.set('songs', structuredClone(opts.songs ?? LIBRARY))
  const controller = new FakeController()
  const setSettings = vi.fn(async () => DEFAULT_SETTINGS)
  const privacy = {
    get: () => ({ ...DEFAULT_PRIVACY, ...opts.privacy }),
    getSettings: () => DEFAULT_SETTINGS,
    setSettings
  } as unknown as PrivacyService
  const events: { name: keyof BusEvents; payload: unknown }[] = []
  for (const name of ['music:target-changed', 'music:track-changed', 'orb:bubble'] as const) {
    bus.on(name, (payload) => events.push({ name, payload }))
  }
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
  return { bus, storage, controller, music, events, state, targets, setSettings }
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

  it('admin starts on Lift', async () => {
    const { music, targets } = await setup()
    await music.startSession(session({ activity: 'admin' }))
    expect(targets()).toEqual(['lift'])
  })

  it('hints once when Spotify is not running and carries on', async () => {
    const { music, controller, events, state } = await setup()
    controller.running = false
    await music.startSession(session())
    await vi.advanceTimersByTimeAsync(3 * MIN)
    state('crashing') // settle tries to switch right away
    await vi.advanceTimersByTimeAsync(0)
    expect(events.filter((e) => e.name === 'orb:bubble')).toEqual([
      { name: 'orb:bubble', payload: { text: 'Open Spotify to let me pick music' } }
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

  it('changes the target at most once per 3 min', async () => {
    const { music, state, targets, bus } = await setup()
    await music.startSession(session())
    state('tense')
    await vi.advanceTimersByTimeAsync(2 * MIN)
    state('tense')
    expect(targets()).toEqual(['steady'])
    await vi.advanceTimersByTimeAsync(MIN)
    bus.emit('session:tick', { sessionId: 's1', elapsedSec: 180, remainingSec: 3000 })
    expect(targets()).toEqual(['steady', 'ease-down'])
    state('low')
    expect(targets()).toEqual(['steady', 'ease-down'])
  })

  it('uses an overridden target-change gap (dev simulator fast mode)', async () => {
    const { music, state, targets } = await setup({
      targetGap: { minTargetChangeMs: 15_000, downtimeChangeMultiplier: 1.2 }
    })
    await music.startSession(session())
    await vi.advanceTimersByTimeAsync(10_000)
    state('tense')
    expect(targets()).toEqual(['steady'])
    await vi.advanceTimersByTimeAsync(5_000)
    state('tense')
    expect(targets()).toEqual(['steady', 'ease-down'])
  })

  it('switches only between tracks: ease-down waits for the song to end', async () => {
    const { music, controller, state } = await setup()
    await music.startSession(session())
    controller.calls = []
    await vi.advanceTimersByTimeAsync(3 * MIN)
    controller.start('spotify:track:loud') // user put on an energy-5 song
    state('tense')
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.calls).toEqual([]) // not mid-song
    await vi.advanceTimersByTimeAsync(200_000 - 1500)
    // One step below energy 5, not dark, not recent: "mid" (energy 4).
    expect(controller.calls).toEqual(['play spotify:track:mid'])
  })

  it('settle switches right away and keeps picking even if only unsure songs exist', async () => {
    const { music, controller, state } = await setup()
    await music.startSession(session())
    controller.calls = []
    controller.start('spotify:track:loud')
    await vi.advanceTimersByTimeAsync(3 * MIN)
    state('crashing')
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.calls).toEqual(['play spotify:track:calm'])

    const unsure = await setup({
      songs: [song('maybe', { energy: 1, mood: 'bright', confidence: 0.2 })]
    })
    await unsure.music.startSession(session())
    unsure.controller.calls = [] // Steady at start may pick an unsure song (1 in 5)
    await vi.advanceTimersByTimeAsync(3 * MIN)
    unsure.state('crashing')
    await vi.advanceTimersByTimeAsync(0)
    expect(unsure.controller.calls).toEqual(['play spotify:track:maybe'])
  })

  it('fades down, switches, and restores the starting volume for Settle', async () => {
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
    state('crashing')
    await vi.advanceTimersByTimeAsync(2500)
    expect(controller.calls).toEqual(['play spotify:track:calm'])
    await vi.advanceTimersByTimeAsync(2500)
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

  it('switches without a fade when volume cannot be read and restores after play failure', async () => {
    const t = await setup()
    t.controller.getVolume = async () => null
    await t.music.startSession(session())
    t.controller.calls = []
    await vi.advanceTimersByTimeAsync(3 * MIN)
    t.state('crashing')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.controller.calls).toEqual(['play spotify:track:calm'])

    const failed = await setup()
    failed.controller.getVolume = async () => failed.controller.volume
    failed.controller.setVolume = async (v) => {
      failed.controller.volume = v
    }
    const originalPlay = failed.controller.play
    let playCount = 0
    failed.controller.play = async (uri) => {
      if (playCount++) throw new Error('play failed')
      await originalPlay(uri)
    }
    await failed.music.startSession(session())
    await vi.advanceTimersByTimeAsync(3 * MIN)
    failed.state('crashing')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(failed.controller.volume).toBe(60)
  })

  it('winds down in the last 10 minutes', async () => {
    const { music, bus, targets } = await setup()
    await music.startSession(session())
    await vi.advanceTimersByTimeAsync(3 * MIN)
    bus.emit('session:tick', { sessionId: 's1', elapsedSec: 3000, remainingSec: 600 })
    expect(targets()).toEqual(['steady', 'wind-down'])
  })

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
    const { music, controller, state } = await setup({ songs: [] })
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

it('picks catalog tracks with playlist context repeatedly at the same target', async () => {
  const html = readFileSync(new URL('./library/fixtures/piano.html', import.meta.url), 'utf8')
  const f = vi.fn(async () => new Response(html))
  const t = await setup({ songs: [], fetch: f })
  const p = await t.music.addPlaylist('spotify:playlist:37i9dQZF1DX4sWSpwq3LiO')
  await t.music.startSession(session())
  for (let i = 0; i < 3; i++) {
    const uri = t.controller.calls.at(-1)!.slice('play '.length)
    expect(uri).toMatch(/^spotify:track:/)
    expect(t.controller.contexts.at(-1)).toBe(p.uri)
    t.controller.start(uri, 5000)
    await vi.advanceTimersByTimeAsync(3500)
  }
  expect(t.controller.calls).toHaveLength(4)
  expect(new Set(t.controller.calls.slice(0, 3)).size).toBe(3)
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
  await vi.advanceTimersByTimeAsync(2000)
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
