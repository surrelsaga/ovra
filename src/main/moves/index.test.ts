import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  type BusEventName,
  type BusEvents,
  type MetricsSnapshot,
  type MoveCardView,
  type MovesService,
  type PrivacyService,
  type Session,
  type StateUpdate
} from '@shared/types'
import { createBus } from '../bus'
import { MOVES_CONFIG as cfg } from './config'
import { createMoves } from '.'

vi.mock('../ipc', () => ({ handle: vi.fn() }))

const MIN = 60_000
const T0 = new Date('2026-11-12T09:00:00Z').getTime()

interface SetupOpts {
  face?: boolean
  camera?: boolean
  mode?: 'checkins' | 'continuous'
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup(opts: SetupOpts = {}) {
  const bus = createBus()
  const privacy = {
    canUseCamera: () => opts.camera ?? true,
    canUseFace: () => opts.face ?? true,
    getSettings: () => DEFAULT_SETTINGS
  } as unknown as PrivacyService
  const moves: MovesService = createMoves({ bus, privacy })
  const log: { event: BusEventName; payload: unknown }[] = []
  const names: BusEventName[] = [
    'move:nudge',
    'move:started',
    'move:step',
    'move:feedback',
    'move:completed',
    'move:snoozed',
    'move:skipped',
    'break:away',
    'break:returned',
    'break:return-check'
  ]
  for (const n of names) bus.on(n, (p) => log.push({ event: n, payload: p }))
  let card: MoveCardView = { kind: 'hidden' }
  bus.on('move:card', (v) => (card = v))
  const session: Session = {
    id: 's1',
    config: {
      activity: 'deep-work',
      lengthMin: 180,
      cameraMode: opts.mode ?? 'checkins',
      checkinIntervalMin: 5,
      music: true
    },
    startedAt: Date.now(),
    status: 'running',
    sensingEnabled: opts.camera ?? true
  }
  moves.startSession(session)
  const state = (p: Partial<StateUpdate>): void =>
    bus.emit('state:updated', {
      t: Date.now(),
      situation: 'focused',
      confidence: 0.8,
      seatedMinutes: 10,
      away: false,
      trend: 'steady',
      ...p
    })
  const metrics = (p: Partial<MetricsSnapshot>): void =>
    bus.emit('sdk:metrics', { t: Date.now(), ...p })
  const events = <E extends BusEventName>(e: E): BusEvents[E][] =>
    log.filter((l) => l.event === e).map((l) => l.payload as BusEvents[E])
  const nudgeId = (): string => {
    if (card.kind !== 'nudge') throw new Error(`card is ${card.kind}`)
    return card.nudge.id
  }
  return { bus, moves, state, metrics, events, card: () => card, nudgeId }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => vi.useRealTimers())

describe('nudges', () => {
  it('nudges on a trigger and shows the prompt', () => {
    const t = setup()
    t.state({ situation: 'tense' })
    expect(t.events('move:nudge')).toHaveLength(1)
    expect(t.card()).toMatchObject({ kind: 'nudge', nudge: { moveId: 'breathe' } })
  })

  it('at most one nudge per 20 min', () => {
    const t = setup()
    t.state({ seatedMinutes: 50 })
    t.moves.respond(t.nudgeId(), 'skip')
    expect(t.events('move:skipped')).toEqual([{ moveId: 'neck-stretch' }])
    vi.advanceTimersByTime(19 * MIN)
    t.state({ seatedMinutes: 70 })
    expect(t.events('move:nudge')).toHaveLength(1)
    vi.advanceTimersByTime(MIN)
    t.state({ seatedMinutes: 71 })
    expect(t.events('move:nudge').map((n) => n.moveId)).toEqual(['neck-stretch', 'stand-stretch'])
  })

  it('tense for 15+ min → step outside', () => {
    const t = setup()
    t.state({ situation: 'tense' })
    t.moves.respond(t.nudgeId(), 'skip')
    vi.advanceTimersByTime(16 * MIN)
    t.state({ situation: 'tense' })
    vi.advanceTimersByTime(4 * MIN)
    t.state({ situation: 'crashing' })
    expect(t.events('move:nudge').map((n) => n.moveId)).toEqual(['breathe', 'step-outside'])
  })

  it('snooze re-nudges the same move after 5 min, even inside the 20 min limit', () => {
    const t = setup()
    t.state({ situation: 'low' })
    t.moves.respond(t.nudgeId(), 'snooze')
    expect(t.events('move:snoozed')).toEqual([{ moveId: 'stand-stretch' }])
    expect(t.card()).toEqual({ kind: 'hidden' })
    vi.advanceTimersByTime(5 * MIN - 1)
    expect(t.events('move:nudge')).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(t.events('move:nudge').map((n) => n.moveId)).toEqual(['stand-stretch', 'stand-stretch'])
  })

  it('ignores a stale nudge id', () => {
    const t = setup()
    t.state({ situation: 'tense' })
    t.moves.respond('nope', 'go')
    expect(t.events('move:started')).toHaveLength(0)
  })

  it('without the camera, nudges from session time', () => {
    const t = setup({ camera: false })
    t.state({ situation: 'tense' }) // ignored: no sensing
    t.bus.emit('session:tick', { sessionId: 's1', elapsedSec: 60, remainingSec: 0 })
    expect(t.events('move:nudge')).toHaveLength(0)
    vi.advanceTimersByTime(45 * MIN)
    t.bus.emit('session:tick', { sessionId: 's1', elapsedSec: 2700, remainingSec: 0 })
    expect(t.events('move:nudge').map((n) => n.moveId)).toEqual(['neck-stretch'])
  })

  it('no nudges outside a session', () => {
    const t = setup()
    t.moves.stopSession()
    t.state({ situation: 'tense' })
    expect(t.events('move:nudge')).toHaveLength(0)
  })
})

describe('guided moves', () => {
  it('plays every step with a countdown and completes', () => {
    const t = setup()
    t.state({ seatedMinutes: 50 })
    t.moves.respond(t.nudgeId(), 'go')
    expect(t.events('move:started')).toEqual([{ moveId: 'neck-stretch' }])
    expect(t.card()).toMatchObject({ kind: 'move', stepIndex: 0, remainingSec: 25 })
    vi.advanceTimersByTime(1000)
    expect(t.card()).toMatchObject({ kind: 'move', stepIndex: 0, remainingSec: 24 })
    vi.advanceTimersByTime(89_000)
    const steps = t.events('move:step')
    expect(new Set(steps.map((s) => s.stepIndex))).toEqual(new Set([0, 1, 2, 3]))
    expect(t.events('move:completed')).toEqual([{ moveId: 'neck-stretch', verified: false }])
    expect(t.card()).toEqual({ kind: 'hidden' })
  })

  it('verifies head tilts past the threshold, only with face consent', () => {
    const t = setup()
    t.state({ seatedMinutes: 50 })
    t.moves.respond(t.nudgeId(), 'go')
    for (const roll of [-10, -25, -30, 30, -35])
      t.metrics({ face: { present: true, headRollDeg: roll } })
    expect(t.events('move:feedback')).toEqual([
      { moveId: 'neck-stretch', stepId: 'tilt-left', message: 'I can see the tilt' }
    ])
    expect(t.card()).toMatchObject({ feedback: 'I can see the tilt' })
    vi.advanceTimersByTime(25_000)
    expect(t.card()).toMatchObject({ stepIndex: 1, feedback: undefined })
    vi.advanceTimersByTime(65_000)
    expect(t.events('move:completed')).toEqual([{ moveId: 'neck-stretch', verified: true }])

    const v = setup({ face: false })
    v.state({ seatedMinutes: 50 })
    v.moves.respond(v.nudgeId(), 'go')
    for (let i = 0; i < 5; i++) v.metrics({ face: { present: true, headRollDeg: -40 } })
    expect(v.events('move:feedback')).toHaveLength(0)
  })

  it('verifies breathing slowing only when breathing readings exist', () => {
    const t = setup()
    t.state({ situation: 'tense' })
    t.moves.respond(t.nudgeId(), 'go')
    vi.advanceTimersByTime(10_000) // settle step
    expect(t.card()).toMatchObject({ stepIndex: 1 })
    for (const value of [15, 15, 15, 14, 13, 12])
      t.metrics({ breathing: { value, confidence: 90, stable: true } })
    expect(t.events('move:feedback').map((f) => f.message)).toEqual([
      'Your breathing is slowing down'
    ])
    vi.advanceTimersByTime(80_000)
    expect(t.events('move:completed')).toEqual([{ moveId: 'breathe', verified: true }])
  })

  it('unverifiable breathing just runs its timer', () => {
    const t = setup()
    t.state({ situation: 'tense' })
    t.moves.respond(t.nudgeId(), 'go')
    t.metrics({ pulse: { value: 70, confidence: 90, stable: true } })
    vi.advanceTimersByTime(90_000)
    expect(t.events('move:feedback')).toHaveLength(0)
    expect(t.events('move:completed')).toEqual([{ moveId: 'breathe', verified: false }])
  })

  it('verifies stand-up from a face position change', () => {
    const t = setup()
    t.metrics({ face: { present: true, center: { x: 0.5, y: 0.55 }, size: 0.3 } })
    t.state({ situation: 'low' })
    t.moves.respond(t.nudgeId(), 'go')
    t.metrics({ face: { present: true, center: { x: 0.5, y: 0.53 }, size: 0.3 } })
    expect(t.events('move:feedback')).toHaveLength(0)
    t.metrics({ face: { present: true, center: { x: 0.5, y: 0.3 }, size: 0.28 } })
    expect(t.events('move:feedback').map((f) => f.message)).toEqual(['I can see you standing'])
  })

  it('End stops the move early', () => {
    const t = setup()
    t.state({ situation: 'tense' })
    t.moves.respond(t.nudgeId(), 'go')
    t.moves.endMove()
    expect(t.events('move:completed')).toHaveLength(1)
    expect(t.card()).toEqual({ kind: 'hidden' })
    vi.advanceTimersByTime(90_000)
    expect(t.events('move:step')).toHaveLength(1)
  })
})

describe('breaks and the return check', () => {
  function walkToAwayStep(t: ReturnType<typeof setup>): void {
    t.state({ situation: 'crashing' })
    t.moves.respond(t.nudgeId(), 'go')
    vi.advanceTimersByTime(10_000)
    expect(t.card()).toMatchObject({ kind: 'move', stepIndex: 1 })
    vi.advanceTimersByTime(60_000) // the away step waits for "Okay, going"
    expect(t.card()).toMatchObject({ kind: 'move', stepIndex: 1 })
  }

  it('manual: going → away → back → return check → still tense → breathing round', () => {
    const t = setup()
    walkToAwayStep(t)
    t.moves.goingAway()
    expect(t.events('break:away')).toEqual([{ since: Date.now(), manual: true }])
    expect(t.card()).toEqual({ kind: 'away', since: Date.now(), manual: true })
    vi.advanceTimersByTime(4 * MIN)
    t.moves.back()
    expect(t.events('break:returned')).toEqual([{ awayMs: 4 * MIN }])
    expect(t.events('move:completed')).toEqual([{ moveId: 'walk', verified: false }])
    expect(t.card()).toEqual({ kind: 'return-check', progress: 0 })
    vi.advanceTimersByTime(15_000)
    expect(t.card()).toEqual({ kind: 'return-check', progress: 0.5 })
    t.state({ situation: 'tense' })
    t.bus.emit('sdk:checkin-ended', { phase: 'return-check' })
    vi.advanceTimersByTime(cfg.returnCheck.settleMs)
    expect(t.events('break:return-check')).toEqual([
      { result: 'still-tense', message: 'Still a bit tense. Want a 1 min breathing round?' }
    ])
    expect(t.card()).toMatchObject({ kind: 'return-result', result: 'still-tense' })
    t.moves.breatheRound()
    expect(t.card()).toMatchObject({ kind: 'move', move: { id: 'breathe', lengthSec: 60 } })
    vi.advanceTimersByTime(60_000)
    expect(t.events('move:completed').at(-1)).toEqual({ moveId: 'breathe', verified: false })
  })

  it('return check: calmer, and unknown with no fresh data', () => {
    const t = setup()
    walkToAwayStep(t)
    t.moves.goingAway()
    t.moves.back()
    t.state({ situation: 'focused' })
    t.bus.emit('sdk:checkin-ended', { phase: 'return-check' })
    vi.advanceTimersByTime(cfg.returnCheck.settleMs)
    expect(t.events('break:return-check')).toEqual([
      { result: 'calmer', message: "You're calmer than before." }
    ])
    vi.advanceTimersByTime(cfg.resultHideSec * 1000)
    expect(t.card()).toEqual({ kind: 'hidden' })

    const u = setup()
    walkToAwayStep(u)
    u.moves.goingAway()
    u.moves.back()
    vi.advanceTimersByTime((cfg.returnCheck.durationSec + cfg.returnCheck.graceSec) * 1000)
    expect(u.events('break:return-check')).toEqual([
      { result: 'unknown', message: 'Welcome back.' }
    ])
  })

  it('continuous mode: away and return from state updates', () => {
    const t = setup({ mode: 'continuous' })
    t.state({ away: true })
    expect(t.events('break:away')).toEqual([{ since: Date.now(), manual: false }])
    expect(t.card()).toMatchObject({ kind: 'away', manual: false })
    vi.advanceTimersByTime(3 * MIN)
    t.state({ away: false })
    expect(t.events('break:returned')).toEqual([{ awayMs: 3 * MIN }])
    expect(t.card()).toMatchObject({ kind: 'return-check' })
  })

  it('continuous mode: a walk is verified when the camera sees away-and-back', () => {
    const t = setup({ mode: 'continuous' })
    walkToAwayStep(t)
    t.state({ away: true })
    t.state({ away: false })
    expect(t.events('move:completed')).toEqual([{ moveId: 'walk', verified: true }])
  })

  it('continuous mode: losing the face during a desk move does not start a break', () => {
    const t = setup({ mode: 'continuous' })
    t.state({ situation: 'low' })
    t.moves.respond(t.nudgeId(), 'go')
    t.state({ away: true })
    expect(t.events('break:away')).toHaveLength(0)
  })

  it('check-in mode ignores state away flags', () => {
    const t = setup()
    t.state({ away: true })
    expect(t.events('break:away')).toHaveLength(0)
  })

  it('without the camera, coming back shows a plain welcome', () => {
    const t = setup({ camera: false })
    t.moves.goingAway()
    t.moves.back()
    expect(t.events('break:return-check')).toEqual([
      { result: 'unknown', message: 'Welcome back.' }
    ])
  })
})
