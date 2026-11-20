// Job 32: the whole main-process wiring through a demo wind-down (fake Spotify, no camera).
import type {
  Energy,
  MusicController,
  NowPlaying,
  SensingService,
  Song,
  StateEngine
} from '@shared/types'
import { createBus } from '../bus'
import { createPrivacy } from '../privacy'
import { memoryStorage } from '../music/dev/memory-storage'
import { createMusic } from '../music'
import { musicConfig } from '../music/config'
import { createMoves } from '../moves'
import { MOVES_CONFIG } from '../moves/config'
import { createStateEngine } from '../state'
import { bindForwarding } from '../windows/forward'
import { createMonitorModel } from '../monitor/model'
import { formatMonitor } from '../monitor/format'
import { sensingConfig } from '../sdk/config'
import { bindDemo } from './demo'
import { createSessionService } from './service'

vi.mock('../ipc', () => ({ handle: vi.fn(), broadcast: vi.fn(), push: vi.fn() }))

const PL = 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'
const track = (id: string): NowPlaying => ({
  id: `spotify:track:${id}`,
  uri: `spotify:track:${id}`,
  name: id,
  artist: 'a',
  album: '',
  durationMs: 200_000,
  positionMs: 0,
  state: 'playing',
  isAd: false
})
const song = (id: string, energy: Energy): Song => ({
  id: `spotify:track:${id}`,
  title: id,
  artist: 'a',
  firstSeenAt: 0,
  playCount: 0,
  playlists: [PL],
  origin: 'mine',
  scores: { energy, mood: 'bright', vocals: 'light', confidence: 0.9, source: 'llm', scoredAt: 0 }
})

/** Spotify that answers every command; `next` moves through `queue`. */
function fakeSpotify(): MusicController & { cb?: (t: NowPlaying) => void; queue: string[] } {
  let np: NowPlaying | null = track('anyone')
  let volume = 60
  const c = {
    queue: [] as string[],
    cb: undefined as ((t: NowPlaying) => void) | undefined,
    isAvailable: async () => true,
    play: async (uri: string) => {
      if (uri.startsWith('spotify:track:')) np = track(uri.slice(14))
    },
    pause: async () => {},
    resume: async () => {},
    next: async () => {
      const id = c.queue.shift()
      if (id) {
        np = track(id)
        c.cb?.(np)
      }
    },
    setVolume: async (v: number) => void (volume = v),
    getVolume: async () => volume,
    current: async () => np,
    onTrackChange(cb: (t: NowPlaying) => void) {
      c.cb = cb
      return () => (c.cb = undefined)
    }
  }
  return c
}

const MIN = 60_000

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('wind-down with everything going at once', () => {
  // Demo winds down in the last 120 s, a normal session in the last 10 min.
  it.each([
    { demo: true, lengthMin: 12, windDownSec: 120 },
    { demo: false, lengthMin: 15, windDownSec: 600 }
  ])('demo=$demo keeps ticking to 0:00 and shows the summary', async (c) => {
    const bus = createBus()
    const privacy = await createPrivacy({ storage: memoryStorage(), bus, settingsOverlay: {} })
    const storage = memoryStorage()
    storage.files.set('songs', [song('anyone', 4), song('soft', 1), song('softer', 1)])
    storage.files.set('playlists', [{ uri: PL, url: PL, addedAt: 0 }])
    const controller = fakeSpotify()
    const musicGap = { ...musicConfig.switching }
    const music = createMusic({
      bus,
      storage,
      privacy,
      controller,
      getKey: () => null,
      rng: () => 0,
      targetGap: musicGap,
      fetch: async () => {
        throw new Error('offline')
      }
    })
    const movesCfg = { ...MOVES_CONFIG }
    const moves = createMoves({ bus, privacy }, movesCfg)
    bindDemo({
      bus,
      privacy,
      overlay: {},
      moves: movesCfg,
      musicGap,
      sensing: { ...sensingConfig },
      music,
      cards: moves
    })
    const state = createStateEngine({ bus, privacy })
    const sensing = {
      phase: () => 'continuous',
      stop: async () => {},
      resume: async () => {},
      startCalibration: async () => {},
      startContinuous: async () => {},
      startCheckins: () => {},
      startReturnCheck: async () => {}
    } as unknown as SensingService
    const session = createSessionService({
      bus,
      privacy,
      sensing,
      state: state as StateEngine,
      music,
      moves
    })
    bindForwarding(bus, {
      push: () => {},
      showOrb: () => {},
      hideOrb: () => {},
      showMain: () => {},
      setMoveCard: () => {}
    })
    const lines: string[] = []
    const monitor = createMonitorModel(
      { bus, sensing, state, session, music },
      (l) => void lines.push(l)
    )
    const monitorTimer = setInterval(() => lines.push(formatMonitor(monitor.snapshot())), 5000)
    const ticks: number[] = []
    const targets = new Set<string | null>()
    bus.on('session:tick', (t) => {
      ticks.push(t.remainingSec)
      if (t.remainingSec < c.windDownSec) targets.add(music.status().target)
    })
    const ended = vi.fn()
    bus.on('session:ended', ended)
    const mood = (): void =>
      bus.emit('state:updated', {
        t: Date.now(),
        situation: 'focused',
        confidence: 1,
        seatedMinutes: 1,
        away: false,
        trend: 'steady'
      })

    await session.start({
      activity: 'unwind',
      lengthMin: c.lengthMin,
      cameraMode: 'continuous',
      checkinIntervalMin: 5,
      music: true,
      demo: c.demo
    })
    await vi.advanceTimersByTimeAsync(1000)
    controller.cb?.(track('anyone'))
    mood()
    // A Tired preview ending right at wind-down, a stretch running, and a ducked skip chain starting
    // at the same moment (decision 61).
    await vi.advanceTimersByTimeAsync(c.lengthMin * MIN - (c.windDownSec + 30) * 1000)
    music.preview('low', 30_000)
    const nudge = await new Promise<string>((resolve) => {
      const off = bus.on('move:card', (v) => {
        if (v.kind !== 'nudge') return
        off()
        resolve(v.nudge.id)
      })
      moves.preview('stand-stretch', 'Stretch?')
    })
    moves.respond(nudge, 'go')
    controller.queue = ['spotify:track:soft']
    for (let s = 0; s < c.windDownSec + 30; s += 5) {
      mood()
      await vi.advanceTimersByTimeAsync(5000)
    }
    await vi.advanceTimersByTimeAsync(5000)
    clearInterval(monitorTimer)
    // Wind-down steered (one ducked skip), the clock reached 0:00 and the summary was sent.
    expect(lines.some((l) => l.includes('music skip reason="doesn\'t fit Wind down"'))).toBe(true)
    expect(ticks.slice(-3)).toEqual([2, 1, 0])
    expect([...targets]).toEqual(['wind-down'])
    expect(lines.filter((l) => / remaining=\d+s/.test(l)).length).toBeGreaterThanOrEqual(
      (c.lengthMin * 60) / 5 - 2
    )
    expect(ended).toHaveBeenCalledOnce()
    expect(ended.mock.calls[0][0]).toMatchObject({ activity: 'unwind', lengthMin: c.lengthMin })
  })
})
