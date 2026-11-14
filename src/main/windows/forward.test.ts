import { createBus } from '../bus'
import { DEFAULT_PRIVACY, type MoveStep, type OrbView, type Session } from '@shared/types'
import { bindForwarding, breathAt, type ShellControl } from './forward'
import { windowsConfig } from './config'

function fakeShell(): ShellControl & {
  pushes: [string, unknown][]
  calls: string[]
  orb(): OrbView
} {
  const pushes: [string, unknown][] = []
  const calls: string[] = []
  return {
    pushes,
    calls,
    push: (c, p) => void pushes.push([c, p]),
    showOrb: () => void calls.push('showOrb'),
    hideOrb: () => void calls.push('hideOrb'),
    showMain: () => void calls.push('showMain'),
    setMoveCard: (v) => void calls.push(`card:${v.kind}`),
    orb: () => [...pushes].reverse().find(([c]) => c === 'push:orb')?.[1] as OrbView
  }
}

const session = (status: Session['status']): Session => ({
  id: 's1',
  config: {
    activity: 'focus',
    lengthMin: 60,
    cameraMode: 'checkins',
    checkinIntervalMin: 5,
    music: true
  },
  startedAt: 0,
  status,
  sensingEnabled: true
})

const breatheStep: MoveStep = {
  id: 'b1',
  title: 'Breathe along',
  howTo: 'In with the moon, out as it shrinks',
  durationSec: 60,
  animation: 'breathe',
  check: 'breathing-slows'
}

describe('bus → push forwarding', () => {
  afterEach(() => vi.useRealTimers())

  it('forwards bus events to the right push channels', () => {
    const bus = createBus()
    const shell = fakeShell()
    bindForwarding(bus, shell)
    const state = {
      t: 1,
      situation: null,
      confidence: 0,
      seatedMinutes: 0,
      away: false,
      trend: 'steady'
    } as const
    const music = {
      available: true,
      leaveAlone: false,
      target: null,
      nowPlaying: null,
      scoringQueue: 3,
      scoredCount: 1
    }
    bus.emit('session:status', session('calibrating'))
    bus.emit('session:tick', { sessionId: 's1', elapsedSec: 1, remainingSec: 2 })
    bus.emit('sdk:calibration-progress', { progress: 0.5, hint: null })
    bus.emit('state:updated', state)
    bus.emit('music:status', music)
    bus.emit('move:card', { kind: 'hidden' })
    bus.emit('privacy:changed', DEFAULT_PRIVACY)
    const channels = shell.pushes.map(([c]) => c)
    expect(channels).toEqual([
      'push:session',
      'push:session-tick',
      'push:calibration',
      'push:state',
      'push:music',
      'push:move-card',
      'push:privacy'
    ])
    expect(shell.calls).toEqual(['card:hidden'])
  })

  it('shows the orb when running and the main window with the summary at the end', () => {
    const bus = createBus()
    const shell = fakeShell()
    bindForwarding(bus, shell)
    bus.emit('session:status', session('calibrating'))
    bus.emit('session:status', session('running'))
    bus.emit('session:status', session('on-break'))
    bus.emit('session:status', session('running'))
    expect(shell.calls).toEqual(['showOrb'])
    bus.emit('session:ended', {
      id: 's1',
      activity: 'focus',
      startedAt: 0,
      endedAt: 1,
      lengthMin: 60,
      cameraMode: 'checkins',
      moodTimeline: [],
      moves: [],
      snoozes: 0,
      longestSeatedMin: 0,
      learnedSongIds: []
    })
    expect(shell.pushes.some(([c]) => c === 'push:session-summary')).toBe(true)
    expect(shell.calls).toEqual(['showOrb', 'hideOrb', 'showMain'])
  })

  it('composes the orb view from state, camera, breaks and music', () => {
    vi.useFakeTimers()
    const bus = createBus()
    const shell = fakeShell()
    const fw = bindForwarding(bus, shell)
    bus.emit('state:updated', {
      t: 1,
      situation: 'tense',
      confidence: 0.8,
      seatedMinutes: 10,
      away: false,
      trend: 'rising'
    })
    expect(fw.orb()).toMatchObject({ mood: 'uneasy', bubble: 'You seem a bit tense.' })

    bus.emit('sdk:checkin-started', { phase: 'checkin' })
    expect(fw.orb().listening).toBe(true)
    expect(fw.orb().calibration).toBeUndefined()
    bus.emit('sdk:calibration-progress', { progress: 0.3, hint: null })
    expect(fw.orb().calibration).toBeUndefined()
    bus.emit('sdk:checkin-ended', { phase: 'checkin' })
    expect(fw.orb().listening).toBe(false)

    // Calibration: the moon waxes with progress, then goes back to full.
    bus.emit('sdk:checkin-started', { phase: 'calibration' })
    expect(fw.orb()).toMatchObject({ listening: true, calibration: 0 })
    bus.emit('sdk:calibration-progress', { progress: 0.5, hint: null })
    expect(fw.orb().calibration).toBe(0.5)
    bus.emit('sdk:checkin-ended', { phase: 'calibration' })
    expect(fw.orb()).toMatchObject({ listening: false, calibration: undefined })

    bus.emit('break:away', { since: 123, manual: true })
    expect(fw.orb()).toMatchObject({ away: true, awaySince: 123 })
    bus.emit('break:returned', { awayMs: 5 })
    expect(fw.orb().away).toBe(false)

    bus.emit('music:track-changed', {
      id: 'spotify:track:1',
      uri: 'spotify:track:1',
      name: 'Song',
      artist: 'Band',
      album: '',
      durationMs: 1,
      positionMs: 0,
      state: 'playing',
      isAd: false
    })
    bus.emit('music:target-changed', { target: 'ease-down', word: 'Calm', reason: '' })
    expect(fw.orb().nowPlaying).toEqual({ name: 'Song', artist: 'Band', word: 'Calm' })
    expect(fw.orb().bubble).toBe('Easing into calmer songs.')
    bus.emit('music:target-changed', {
      target: 'lift',
      word: 'Boost',
      reason: 'Brighter songs now.'
    })
    expect(fw.orb()).toMatchObject({ bubble: 'Brighter songs now.', nowPlaying: { word: 'Boost' } })
    bus.emit('music:target-changed', { target: 'ease-down', word: 'Calm', reason: '' })

    vi.advanceTimersByTime(windowsConfig.bubbleTtlMs + 1)
    expect(fw.orb().bubble).toBeUndefined()
    expect(shell.orb()).toEqual(fw.orb())
  })

  it('only changes mood and bubble when the situation changes', () => {
    const bus = createBus()
    const shell = fakeShell()
    const fw = bindForwarding(bus, shell)
    const s = {
      t: 1,
      situation: 'good',
      confidence: 1,
      seatedMinutes: 1,
      away: false,
      trend: 'steady'
    } as const
    bus.emit('state:updated', s)
    expect(fw.orb().mood).toBe('bright')
    bus.emit('orb:bubble', { text: 'Hello' })
    bus.emit('state:updated', { ...s, t: 2 })
    expect(fw.orb().bubble).toBe('Hello')
  })

  it('animates breath during a Breathe-along step and stops after', () => {
    vi.useFakeTimers()
    vi.setSystemTime(windowsConfig.breathPeriodMs * 1000)
    const bus = createBus()
    const fw = bindForwarding(bus, fakeShell())
    bus.emit('move:step', { moveId: 'breathe', stepIndex: 0, step: breatheStep, remainingSec: 60 })
    expect(fw.orb().breath).toBe(0)
    vi.advanceTimersByTime(windowsConfig.breathPeriodMs / 2)
    expect(fw.orb().breath).toBeCloseTo(1, 1)
    bus.emit('move:completed', { moveId: 'breathe', verified: true })
    expect(fw.orb().breath).toBeUndefined()
  })

  it('keeps the orb up while the camera is on after the session ends', () => {
    const bus = createBus()
    const shell = fakeShell()
    bindForwarding(bus, shell)
    bus.emit('session:status', session('running'))
    bus.emit('sdk:checkin-started', { phase: 'checkin' })
    bus.emit('session:status', session('ended'))
    expect(shell.orb().listening).toBe(true)
    bus.emit('sdk:checkin-ended', { phase: 'checkin' })
    expect(shell.calls.filter((c) => c === 'hideOrb')).toHaveLength(2)
  })

  it('tracks camera pause and resets it when the session ends', () => {
    const bus = createBus()
    const fw = bindForwarding(bus, fakeShell())
    bus.emit('session:status', session('running'))
    bus.emit('sdk:checkin-started', { phase: 'checkin' })
    bus.emit('privacy:camera-paused', {})
    expect(fw.orb()).toMatchObject({ paused: true, listening: false })
    bus.emit('privacy:camera-resumed', {})
    expect(fw.orb().paused).toBe(false)
    bus.emit('privacy:camera-paused', {})
    bus.emit('session:status', session('ended'))
    expect(fw.orb().paused).toBe(false)
  })

  it('breathAt follows a 10 s cycle', () => {
    expect(breathAt(0)).toBe(0)
    expect(breathAt(5000)).toBeCloseTo(1)
    expect(breathAt(10_000)).toBeCloseTo(0)
  })
})

it('replays current state and move card to a newly loaded renderer', () => {
  const bus = createBus()
  const fw = bindForwarding(bus, fakeShell())
  const current = session('running')
  bus.emit('session:status', current)
  bus.emit('privacy:camera-paused', {})
  bus.emit('move:card', { kind: 'away', since: 123, manual: true })
  const seen = new Map<string, unknown>()
  fw.snapshot((channel, payload) => {
    seen.set(channel, payload)
  })
  expect(seen.get('push:session')).toEqual(current)
  expect(seen.get('push:orb')).toMatchObject({ paused: true, listening: false })
  expect(seen.get('push:move-card')).toEqual({ kind: 'away', since: 123, manual: true })
  fw.dispose()
})

it('keeps the target before the first track, recovers the song from music status and clears ads', () => {
  const bus = createBus()
  const fw = bindForwarding(bus, fakeShell())
  bus.emit('music:target-changed', { target: 'steady', word: 'Focus', reason: '' })
  const track = {
    id: 'spotify:track:bones',
    uri: 'spotify:track:bones',
    name: 'Bones',
    artist: 'Imagine Dragons',
    album: '',
    durationMs: 200_000,
    positionMs: 0,
    state: 'playing' as const,
    isAd: false
  }
  bus.emit('music:track-changed', track)
  expect(fw.orb().nowPlaying).toEqual({ name: 'Bones', artist: 'Imagine Dragons', word: 'Focus' })
  const music = {
    available: true,
    leaveAlone: false,
    target: 'steady' as const,
    nowPlaying: track,
    scoringQueue: 0,
    scoredCount: 0
  }
  bus.emit('music:status', {
    ...music,
    target: 'lift',
    nowPlaying: { ...track, name: 'Another song' }
  })
  expect(fw.orb().nowPlaying).toMatchObject({ name: 'Another song', word: 'Boost' })
  bus.emit('music:status', { ...music, nowPlaying: { ...track, isAd: true } })
  expect(fw.orb().nowPlaying).toBeUndefined()
  bus.emit('music:status', music)
  expect(fw.orb().nowPlaying?.name).toBe('Bones')
  bus.emit('music:status', { ...music, nowPlaying: null })
  expect(fw.orb().nowPlaying).toBeUndefined()
  fw.dispose()
})

describe('demo badge, why line and demo hints', () => {
  afterEach(() => vi.useRealTimers())
  const state = {
    t: 1,
    situation: 'tense' as const,
    confidence: 1,
    seatedMinutes: 0,
    away: false,
    trend: 'steady' as const
  }

  it('shows the badge only in demo sessions and forwards the why line', () => {
    vi.useFakeTimers()
    const bus = createBus()
    const shell = fakeShell()
    let why: OrbView['why'] = { text: 'Close to your usual', moving: false }
    const fw = bindForwarding(bus, shell, undefined, () => why)
    bus.emit('session:started', session('calibrating'))
    expect(fw.orb().demo).toBeUndefined()
    bus.emit('session:status', session('ended'))
    const demo = session('calibrating')
    bus.emit('session:started', { ...demo, config: { ...demo.config, demo: true } })
    bus.emit('session:status', session('running'))
    expect(fw.orb().demo).toBe(true)
    bus.emit('state:updated', state)
    expect(fw.orb().why).toEqual({ text: 'Close to your usual', moving: false })
    why = { text: "Can't see you · away in 9 s", progress: 0.4, moving: true }
    vi.advanceTimersByTime(windowsConfig.whyTickMs)
    expect(fw.orb().why).toEqual(why)
    bus.emit('session:status', session('ended'))
    expect(fw.orb().demo).toBeUndefined()
    expect(fw.orb().why).toBeUndefined()
    fw.dispose()
  })

  it('queues demo hints after state bubbles and re-shows an interrupted hint', () => {
    vi.useFakeTimers()
    const bus = createBus()
    const fw = bindForwarding(bus, fakeShell())
    const hint = 'Demo: try 40 s of squats off camera, then sit down.'
    bus.emit('state:updated', state) // "You seem a bit tense."
    bus.emit('orb:bubble', { text: hint, ttlMs: 15_000 })
    expect(fw.orb().bubble).toBe('You seem a bit tense.')
    vi.advanceTimersByTime(windowsConfig.bubbleTtlMs)
    expect(fw.orb().bubble).toBe(hint)
    bus.emit('orb:bubble', { text: 'Easing into calmer songs.' })
    expect(fw.orb().bubble).toBe('Easing into calmer songs.')
    vi.advanceTimersByTime(windowsConfig.bubbleTtlMs)
    expect(fw.orb().bubble).toBe(hint)
    vi.advanceTimersByTime(15_000)
    expect(fw.orb().bubble).toBeUndefined()
    fw.dispose()
  })
})
