import { createBus } from '../bus'
import {
  DEFAULT_PRIVACY,
  DEFAULT_SETTINGS,
  type BusEventName,
  type BusEvents,
  type MovesService,
  type MusicService,
  type NowPlaying,
  type PrivacyService,
  type SensingService,
  type SessionConfig,
  type StateEngine
} from '@shared/types'
import { createSessionService } from './service'
import { sessionConfig } from './config'

const cfg: SessionConfig = {
  activity: 'deep-work',
  lengthMin: 60,
  cameraMode: 'checkins',
  checkinIntervalMin: 5,
  music: true
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test harness, inferred
function setup(camera = true) {
  const bus = createBus()
  const seen: { [E in BusEventName]?: BusEvents[E][] } = {}
  const log = <E extends BusEventName>(e: E): void => {
    bus.on(e, (p) => ((seen[e] ??= [] as never) as BusEvents[E][]).push(p))
  }
  ;(
    ['session:started', 'session:status', 'session:tick', 'session:ended', 'orb:bubble'] as const
  ).forEach(log)
  const sensing = {
    startCalibration: vi.fn(async () => {}),
    startCheckins: vi.fn(),
    startContinuous: vi.fn(async () => {}),
    startReturnCheck: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    phase: vi.fn(() => 'idle' as const)
  } satisfies SensingService
  const state = { reset: vi.fn(), dispose: vi.fn(), current: vi.fn() } as unknown as StateEngine
  const music = {
    startSession: vi.fn(async () => {}),
    stopSession: vi.fn(async () => {})
  } as unknown as MusicService
  const moves = { startSession: vi.fn(), stopSession: vi.fn() } as unknown as MovesService
  const privacy = {
    canUseCamera: () => camera,
    get: () => DEFAULT_PRIVACY,
    getSettings: () => DEFAULT_SETTINGS,
    saveSession: vi.fn(async () => {})
  } as unknown as PrivacyService
  const svc = createSessionService({ bus, privacy, sensing, state, music, moves })
  const statuses = (): string[] => (seen['session:status'] ?? []).map((s) => s.status)
  return { bus, seen, sensing, state, music, moves, privacy, svc, statuses }
}

const track = (id: string, isAd = false): NowPlaying => ({
  id,
  uri: id,
  name: 'n',
  artist: 'a',
  album: '',
  durationMs: 1,
  positionMs: 0,
  state: 'playing',
  isAd
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => vi.useRealTimers())

describe('session', () => {
  it('camera yes: calibrating → running → check-ins', async () => {
    const t = setup()
    const s = await t.svc.start(cfg)
    expect(s).toMatchObject({ status: 'calibrating', sensingEnabled: true })
    expect(t.seen['session:started']).toHaveLength(1)
    expect(t.state.reset).toHaveBeenCalled()
    expect(t.sensing.startCalibration).toHaveBeenCalled()
    expect(t.music.startSession).toHaveBeenCalledWith(s)
    expect(t.moves.startSession).toHaveBeenCalledWith(s)
    expect(t.sensing.startCheckins).not.toHaveBeenCalled()

    t.bus.emit('state:baseline-ready', { ok: true })
    expect(t.statuses()).toEqual(['calibrating', 'running'])
    expect(t.sensing.startCheckins).toHaveBeenCalledWith(5)
    expect(t.seen['orb:bubble']).toBeUndefined()
  })

  it('continuous mode starts continuous sensing', async () => {
    const t = setup()
    await t.svc.start({ ...cfg, cameraMode: 'continuous' })
    t.bus.emit('state:baseline-ready', { ok: true })
    expect(t.sensing.startContinuous).toHaveBeenCalled()
    expect(t.sensing.startCheckins).not.toHaveBeenCalled()
  })

  it('baseline failure still runs and tells the user', async () => {
    const t = setup()
    await t.svc.start(cfg)
    t.bus.emit('state:baseline-ready', { ok: false, reason: 'too few' })
    expect(t.svc.current()?.status).toBe('running')
    expect(t.sensing.startCheckins).toHaveBeenCalled()
    expect(t.seen['orb:bubble']?.[0].text).toBe(sessionConfig.baselineFailedBubble)
  })

  it('camera declined: straight to running without sensing', async () => {
    const t = setup(false)
    const s = await t.svc.start(cfg)
    expect(s).toMatchObject({ status: 'running', sensingEnabled: false })
    expect(t.sensing.startCalibration).not.toHaveBeenCalled()
    expect(t.music.startSession).toHaveBeenCalled()
    expect(t.moves.startSession).toHaveBeenCalled()
    const rec = await t.svc.end()
    expect(rec?.cameraMode).toBe('off')
  })

  it('camera failing to start falls back to running without sensing', async () => {
    const t = setup()
    t.sensing.startCalibration.mockRejectedValueOnce(new Error('no key'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = await t.svc.start(cfg)
    expect(s).toMatchObject({ status: 'running', sensingEnabled: false })
    expect(t.seen['orb:bubble']?.[0].text).toBe(sessionConfig.cameraFailedBubble)
  })

  it('rejects a second start and normalises bad config', async () => {
    const t = setup()
    const s = await t.svc.start({ activity: 'admin', lengthMin: -5 } as SessionConfig)
    expect(s.config).toEqual({
      activity: 'admin',
      lengthMin: 45,
      cameraMode: 'checkins',
      checkinIntervalMin: 5,
      music: true
    })
    await expect(t.svc.start(cfg)).rejects.toThrow()
  })

  it('check-in mode break: on-break, camera off, return check, then check-ins again', async () => {
    const t = setup()
    await t.svc.start(cfg)
    t.bus.emit('state:baseline-ready', { ok: true })
    t.bus.emit('break:away', { since: Date.now(), manual: true })
    expect(t.svc.current()?.status).toBe('on-break')
    expect(t.sensing.stop).toHaveBeenCalled()

    t.bus.emit('break:returned', { awayMs: 60_000 })
    expect(t.svc.current()?.status).toBe('running')
    expect(t.sensing.startReturnCheck).toHaveBeenCalled()
    expect(t.sensing.startCheckins).toHaveBeenCalledTimes(1)
    t.bus.emit('sdk:checkin-ended', { phase: 'return-check' })
    expect(t.sensing.startCheckins).toHaveBeenCalledTimes(2)
  })

  it('continuous mode keeps sensing through breaks and starts a return check', async () => {
    const t = setup()
    await t.svc.start({ ...cfg, cameraMode: 'continuous' })
    t.bus.emit('state:baseline-ready', { ok: true })
    t.bus.emit('break:away', { since: Date.now(), manual: true })
    t.bus.emit('break:away', { since: Date.now(), manual: false })
    expect(t.svc.current()?.status).toBe('on-break')
    expect(t.sensing.stop).not.toHaveBeenCalled()
    t.bus.emit('break:returned', { awayMs: 10_000 })
    expect(t.sensing.startReturnCheck).toHaveBeenCalledOnce()
    t.bus.emit('sdk:checkin-ended', { phase: 'return-check' })
    expect(t.sensing.startContinuous).toHaveBeenCalledTimes(2)
  })

  it('ticks every second and auto-ends at the session length', async () => {
    const t = setup()
    await t.svc.start({ ...cfg, lengthMin: 1 })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(t.seen['session:tick']?.at(-1)).toMatchObject({ elapsedSec: 30, remainingSec: 30 })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(t.seen['session:ended']).toHaveLength(1)
    expect(t.svc.current()).toBeNull()
    expect(t.statuses().at(-1)).toBe('ended')
    expect(t.sensing.stop).toHaveBeenCalled()
    expect(t.music.stopSession).toHaveBeenCalled()
    expect(t.moves.stopSession).toHaveBeenCalled()
    expect(t.state.dispose).toHaveBeenCalled()
    const ticks = t.seen['session:tick']!.length
    await vi.advanceTimersByTimeAsync(5_000)
    expect(t.seen['session:tick']).toHaveLength(ticks)
  })

  it('builds a record of labels and counts only', async () => {
    const t = setup()
    const s = await t.svc.start(cfg)
    t.bus.emit('state:baseline-ready', { ok: true })
    const u = { confidence: 0.9, trend: 'steady' as const }
    t.bus.emit('state:updated', { ...u, t: 1, situation: 'focused', seatedMinutes: 5, away: false })
    t.bus.emit('state:updated', {
      ...u,
      t: 2,
      situation: 'focused',
      seatedMinutes: 10,
      away: false
    })
    t.bus.emit('state:updated', {
      ...u,
      t: 3,
      situation: 'tense',
      seatedMinutes: 42.7,
      away: false
    })
    t.bus.emit('state:updated', { ...u, t: 4, situation: 'tense', seatedMinutes: 0, away: true })
    t.bus.emit('state:updated', { ...u, t: 5, situation: null, seatedMinutes: 1, away: false })
    t.bus.emit('move:snoozed', { moveId: 'neck-stretch' })
    t.bus.emit('move:completed', { moveId: 'neck-stretch', verified: true })
    t.bus.emit('move:skipped', { moveId: 'walk' })
    t.bus.emit('music:track-changed', track('spotify:track:a'))
    t.bus.emit('music:track-changed', track('spotify:ad:x', true))
    t.bus.emit('music:track-changed', track('spotify:track:b'))
    t.bus.emit('music:track-changed', track('spotify:track:a'))
    vi.setSystemTime(2_000_000)

    const rec = (await t.svc.end())!
    expect(rec).toEqual({
      id: s.id,
      activity: 'deep-work',
      startedAt: 1_000_000,
      endedAt: 2_000_000,
      lengthMin: 60,
      cameraMode: 'checkins',
      moodTimeline: [
        { t: 1, situation: 'focused' },
        { t: 3, situation: 'tense' },
        { t: 4, situation: 'away' },
        { t: 5, situation: 'unknown' }
      ],
      moves: [
        { t: 1_000_000, moveId: 'neck-stretch', outcome: 'snoozed' },
        { t: 1_000_000, moveId: 'neck-stretch', outcome: 'done' },
        { t: 1_000_000, moveId: 'walk', outcome: 'skipped' }
      ],
      snoozes: 1,
      longestSeatedMin: 42,
      learnedSongIds: ['spotify:track:a', 'spotify:track:b']
    })
    expect(t.privacy.saveSession).toHaveBeenCalledWith(rec)
    expect(t.seen['session:ended']).toEqual([rec])
    // No vitals: none of the keys storage refuses, anywhere in the record.
    expect(JSON.stringify(rec)).not.toMatch(
      /pulse|breathing|hrv|rmssd|baevsky|landmark|expression|baseline|blinkRate|headRoll|metrics|confidence/i
    )
    // Listeners are gone after end.
    t.bus.emit('move:skipped', { moveId: 'walk' })
    expect(rec.moves).toHaveLength(3)
  })

  it('delete everything mid-session stops without writing a new record', async () => {
    const t = setup()
    await t.svc.start(cfg)
    t.bus.emit('move:skipped', { moveId: 'walk' })
    t.bus.emit('music:track-changed', track('spotify:track:a'))
    t.bus.emit('data:deleted-all', {})
    expect(await t.svc.end()).toBeNull()
    expect(t.privacy.saveSession).not.toHaveBeenCalled()
    expect(t.sensing.stop).toHaveBeenCalledOnce()
    expect(t.svc.current()).toBeNull()
  })

  it('revoking camera consent stops capture and switches to timed nudges', async () => {
    const t = setup()
    await t.svc.start(cfg)
    t.bus.emit('privacy:changed', { ...DEFAULT_PRIVACY, camera: 'not-now' })
    expect(t.svc.current()).toMatchObject({ status: 'running', sensingEnabled: false })
    expect(t.sensing.stop).toHaveBeenCalledOnce()
    expect(t.state.dispose).toHaveBeenCalledOnce()
  })

  it('concurrent end calls share the same cleanup and saved record', async () => {
    const t = setup(false)
    await t.svc.start(cfg)
    const [a, b] = await Promise.all([t.svc.end(), t.svc.end()])
    expect(a).toEqual(b)
    expect(t.privacy.saveSession).toHaveBeenCalledOnce()
  })

  it('end() without a session returns null', async () => {
    expect(await setup().svc.end()).toBeNull()
  })
})

it('deletion during asynchronous end cannot resurrect a saved record', async () => {
  const t = setup(false)
  await t.svc.start(cfg)
  let stopped!: () => void
  t.sensing.stop.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        stopped = resolve
      })
  )
  const ending = t.svc.end()
  t.bus.emit('data:deleted-all', {})
  stopped()
  expect(await ending).toBeNull()
  expect(t.privacy.saveSession).not.toHaveBeenCalled()
  expect(t.seen['session:ended']).toBeUndefined()
})

it('history remembers camera use when consent is revoked before ending', async () => {
  const t = setup()
  await t.svc.start(cfg)
  t.bus.emit('privacy:changed', { ...DEFAULT_PRIVACY, camera: 'not-now' })
  expect(t.svc.current()?.sensingEnabled).toBe(false)
  expect((await t.svc.end())?.cameraMode).toBe('checkins')
})

it('terminal SDK errors stop retries and leave the timer and timed nudges running', async () => {
  const t = setup()
  await t.svc.start(cfg)
  t.bus.emit('sdk:error', { code: 4, message: 'Measurement credits exhausted', retryable: false })
  expect(t.svc.current()).toMatchObject({ status: 'running', sensingEnabled: false })
  expect(t.sensing.stop).toHaveBeenCalledOnce()
  expect(t.state.dispose).toHaveBeenCalledOnce()
  t.bus.emit('state:baseline-ready', { ok: false })
  expect(t.sensing.startCheckins).not.toHaveBeenCalled()
  expect(t.seen['orb:bubble']?.at(-1)?.text).toBe(sessionConfig.cameraFailedBubble)
  await vi.advanceTimersByTimeAsync(1000)
  expect(t.seen['session:tick']).toHaveLength(1)
  expect(t.moves.stopSession).not.toHaveBeenCalled()
  await t.svc.end()
})
