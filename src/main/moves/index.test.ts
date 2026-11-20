import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  type Activity,
  type BusEventName,
  type BusEvents,
  type MetricsSnapshot,
  type MoveCardView,
  type PrivacyService,
  type Session,
  type StateUpdate
} from '@shared/types'
import { createBus } from '../bus'
import { MOVES_CONFIG as cfg } from './config'
import type { MovesConfig } from './config'
import { createMoves } from '.'

vi.mock('../ipc', () => ({ handle: vi.fn() }))

const MIN = 60_000
const T0 = new Date('2026-11-12T09:00:00Z').getTime()

interface SetupOpts {
  activity?: Activity
  face?: boolean
  camera?: boolean
  mode?: 'checkins' | 'continuous'
  config?: MovesConfig
  nudgeInterval?: number
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup(opts: SetupOpts = {}) {
  const bus = createBus()
  const privacy = {
    canUseCamera: () => opts.camera ?? true,
    canUseFace: () => opts.face ?? true,
    getSettings: () => ({
      ...DEFAULT_SETTINGS,
      nudgeMinIntervalMin: opts.nudgeInterval ?? DEFAULT_SETTINGS.nudgeMinIntervalMin
    })
  } as unknown as PrivacyService
  const moves = createMoves({ bus, privacy }, opts.config)
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
      activity: opts.activity ?? 'focus',
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
  return { bus, moves, session, state, metrics, events, card: () => card, nudgeId }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => vi.useRealTimers())

describe('nudges', () => {
  for (const [activity, neck, stand, walk] of [
    ['focus', 30, 60, 90],
    ['reading', 30, 60, 90],
    ['creative', 25, 50, 75],
    ['everyday', 25, 50, 75],
    ['unwind', 25, 50, 75]
  ] as const) {
    for (const camera of [true, false]) {
      it.each([
        ['neck-stretch', neck, undefined],
        ['stand-stretch', stand, 'neck-stretch'],
        ['walk', walk, 'stand-stretch']
      ] as const)(
        `${activity}, camera=${camera}: %s at %i minutes`,
        (moveId, threshold, earlier) => {
          const t = setup({ activity, camera, nudgeInterval: 0 })
          const update = (minutes: number): void => {
            vi.setSystemTime(T0 + minutes * MIN)
            if (camera) t.state({ seatedMinutes: minutes })
            else
              t.bus.emit('session:tick', {
                sessionId: t.session.id,
                elapsedSec: minutes * 60,
                remainingSec: 0
              })
          }
          update(threshold - 0.01)
          expect(t.events('move:nudge').at(-1)?.moveId).toBe(earlier)
          if (earlier) t.moves.respond(t.nudgeId(), 'skip')
          update(threshold)
          expect(t.events('move:nudge').at(-1)?.moveId).toBe(moveId)
          t.moves.stopSession()
        }
      )
    }
  }

  {
    for (const [moveId, trigger, threshold] of [
      ['neck-stretch', 'neckSeatedMin', 30],
      ['stand-stretch', 'standSeatedMin', 60],
      ['walk', 'walkSeatedMin', 90]
    ] as const) {
      it.each(['go', 'skip', 'snooze'] as const)(
        `${moveId} after %s waits another full seated threshold`,
        (response) => {
          const interval = 20
          const t = setup({
            nudgeInterval: interval,
            config: {
              ...cfg,
              triggers: {
                ...cfg.triggers,
                neckSeatedMin: Infinity,
                standSeatedMin: Infinity,
                walkSeatedMin: Infinity,
                [trigger]: cfg.triggers[trigger]
              }
            }
          })
          t.state({ seatedMinutes: threshold })
          expect(t.events('move:nudge').at(-1)?.moveId).toBe(moveId)
          t.moves.respond(t.nudgeId(), response)
          if (response === 'go') t.moves.endMove()
          if (response === 'snooze') {
            vi.advanceTimersByTime(cfg.snoozeMin * MIN)
            expect(t.events('move:nudge')).toHaveLength(2)
            t.moves.endMove() // dismiss the ignored snooze retry
          }
          const count = t.events('move:nudge').length
          vi.advanceTimersByTime(interval * MIN)
          t.state({ seatedMinutes: threshold + interval })
          expect(t.events('move:nudge')).toHaveLength(count)
          vi.advanceTimersByTime(threshold * MIN)
          t.state({ seatedMinutes: threshold * 2 })
          expect(t.events('move:nudge')).toHaveLength(count + 1)
          t.moves.stopSession()
        }
      )
    }
  }

  it('a fresh seated stretch resets reminder history and mood reminders stay independent', () => {
    const t = setup()
    t.state({ seatedMinutes: 45 })
    t.moves.respond(t.nudgeId(), 'skip')
    vi.advanceTimersByTime(20 * MIN)
    t.state({ situation: 'tense', seatedMinutes: 50 })
    expect(t.events('move:nudge').at(-1)?.moveId).toBe('breathe')
    t.moves.respond(t.nudgeId(), 'skip')
    t.state({ seatedMinutes: 0 })
    vi.advanceTimersByTime(45 * MIN)
    t.state({ seatedMinutes: 45 })
    expect(t.events('move:nudge').map((n) => n.moveId)).toEqual([
      'neck-stretch',
      'breathe',
      'neck-stretch'
    ])
  })

  it('timed reminders also wait for another full threshold', () => {
    const t = setup({ camera: false })
    const tick = (): void =>
      t.bus.emit('session:tick', { sessionId: 's1', elapsedSec: 0, remainingSec: 0 })
    vi.advanceTimersByTime(30 * MIN)
    tick()
    t.moves.respond(t.nudgeId(), 'skip')
    vi.advanceTimersByTime(20 * MIN)
    tick()
    expect(t.events('move:nudge')).toHaveLength(1)
    vi.advanceTimersByTime(10 * MIN)
    tick()
    t.moves.respond(t.nudgeId(), 'skip') // independent stand reminder
    vi.advanceTimersByTime(19 * MIN)
    tick()
    expect(t.events('move:nudge').map((n) => n.moveId)).toEqual(['neck-stretch', 'stand-stretch'])
    vi.advanceTimersByTime(MIN)
    tick()
    expect(t.events('move:nudge').map((n) => n.moveId)).toEqual([
      'neck-stretch',
      'stand-stretch',
      'neck-stretch'
    ])
  })

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

  it('a demo preview card is labelled, always shows, and leaves no nudge trace', () => {
    const t = setup()
    t.moves.preview('breathe', 'Preview: try it')
    expect(t.card()).toMatchObject({
      kind: 'nudge',
      nudge: { moveId: 'breathe', message: 'Preview: try it' }
    })
    t.moves.respond(t.nudgeId(), 'snooze')
    vi.advanceTimersByTime(10 * MIN)
    expect(t.card()).toEqual({ kind: 'hidden' })
    t.moves.preview('walk', 'Preview: walk')
    // An unanswered preview gives way to the next one.
    t.moves.preview('stand-stretch', 'Preview: stretch')
    expect(t.card()).toMatchObject({ nudge: { moveId: 'stand-stretch' } })
    t.moves.respond(t.nudgeId(), 'skip')
    expect(t.events('move:nudge')).toEqual([])
    expect(t.events('move:snoozed')).toEqual([])
    expect(t.events('move:skipped')).toEqual([])
    // It doesn't use up the reminder interval: a real reminder can follow at once.
    t.state({ situation: 'tense' })
    expect(t.events('move:nudge').map((n) => n.moveId)).toEqual(['breathe'])
    // In demo the step's card replaces a pending reminder.
    t.moves.preview('walk', 'Preview: walk')
    expect(t.card()).toMatchObject({ nudge: { moveId: 'walk' } })
    // Trying a preview is a real, guided move.
    t.moves.preview('breathe', 'Preview: try it')
    t.moves.respond(t.nudgeId(), 'go')
    expect(t.events('move:started')).toEqual([{ moveId: 'breathe' }])
    // It never interrupts an exercise; it shows right after.
    t.moves.preview('neck-stretch', 'Stretch?')
    expect(t.card()).toMatchObject({ kind: 'move', move: { id: 'breathe' } })
    t.moves.endMove()
    expect(t.card()).toMatchObject({ kind: 'nudge', nudge: { moveId: 'neck-stretch' } })
    t.moves.respond(t.nudgeId(), 'go')
    expect(t.events('move:started').at(-1)).toEqual({ moveId: 'neck-stretch' })
    expect(t.events('move:nudge').map((n) => n.moveId)).toEqual(['breathe'])
  })

  it("a demo stretch card uses up that seated reminder so it isn't shown twice", () => {
    const t = setup({ nudgeInterval: 0 })
    t.state({ seatedMinutes: 5 })
    t.moves.preview('neck-stretch', 'Stretch?')
    t.state({ seatedMinutes: 31 })
    t.moves.respond(t.nudgeId(), 'skip')
    t.state({ seatedMinutes: 32 })
    expect(t.events('move:nudge')).toEqual([])
    t.state({ seatedMinutes: 62 })
    expect(t.events('move:nudge').map((n) => n.moveId)).toEqual(['stand-stretch'])
  })

  describe('no pile-ups (normal mode)', () => {
    const at = (min: number): void => {
      vi.setSystemTime(T0 + min * MIN)
    }

    it('uses a 20 min default gap for both timed and mood suggestions', () => {
      expect(DEFAULT_SETTINGS.nudgeMinIntervalMin).toBe(20)
      const t = setup()
      t.state({ seatedMinutes: 30 }) // timed neck
      t.moves.respond(t.nudgeId(), 'skip')
      at(19)
      t.state({ situation: 'low', seatedMinutes: 49 })
      expect(t.events('move:nudge').map((n) => n.moveId)).toEqual(['neck-stretch'])
      at(20)
      t.state({ situation: 'low', seatedMinutes: 50 }) // mood, once the gap has passed
      t.moves.respond(t.nudgeId(), 'skip')
      at(39)
      t.state({ seatedMinutes: 90 }) // timed walk waits for the gap after a mood suggestion
      expect(t.events('move:nudge').map((n) => n.moveId)).toEqual(['neck-stretch', 'stand-stretch'])
      at(40)
      t.state({ seatedMinutes: 91 })
      expect(t.events('move:nudge').map((n) => n.moveId)).toEqual([
        'neck-stretch',
        'stand-stretch',
        'walk'
      ])
    })

    it.each([
      ['low', 'stand-stretch', 'standSeatedMin', 60],
      ['crashing', 'walk', 'walkSeatedMin', 90]
    ] as const)('%s → %s counts as the timed reminder', (situation, moveId, trigger, threshold) => {
      const t = setup({
        config: {
          ...cfg,
          triggers: {
            ...cfg.triggers,
            neckSeatedMin: Infinity,
            standSeatedMin: Infinity,
            walkSeatedMin: Infinity,
            [trigger]: threshold
          }
        }
      })
      t.state({ situation, seatedMinutes: 5 })
      expect(t.events('move:nudge').at(-1)?.moveId).toBe(moveId)
      t.moves.respond(t.nudgeId(), 'skip')
      at(threshold)
      t.state({ situation: 'focused', seatedMinutes: threshold }) // would fire without the rule
      expect(t.events('move:nudge')).toHaveLength(1)
      at(threshold + 5)
      t.state({ situation: 'focused', seatedMinutes: threshold + 5 })
      expect(t.events('move:nudge').map((n) => n.moveId)).toEqual([moveId, moveId])
    })

    it('a finished neck stretch for stress counts as the timed neck reminder', () => {
      const t = setup({
        config: { ...cfg, triggers: { ...cfg.triggers, earlyTenseMaxMin: 0 } }
      })
      t.state({ situation: 'tense', seatedMinutes: 25 })
      expect(t.events('move:nudge').at(-1)?.moveId).toBe('neck-stretch')
      t.moves.respond(t.nudgeId(), 'go')
      t.moves.endMove()
      at(20)
      t.state({ situation: 'focused', seatedMinutes: 45 }) // 45 ≥ 30, but the stress stretch counts
      expect(t.events('move:nudge')).toHaveLength(1)
      at(30)
      t.state({ situation: 'focused', seatedMinutes: 55 })
      expect(t.events('move:nudge').map((n) => n.moveId)).toEqual(['neck-stretch', 'neck-stretch'])
    })

    it('a flickering mood gets one suggestion per episode', () => {
      const t = setup({ nudgeInterval: 0 })
      t.state({ situation: 'low' })
      t.moves.respond(t.nudgeId(), 'skip')
      for (const [min, situation] of [
        [3, 'focused'],
        [6, 'low'],
        [9, 'focused'],
        [12, 'low'],
        [21, 'low']
      ] as const) {
        at(min)
        t.state({ situation })
      }
      expect(t.events('move:nudge')).toHaveLength(1)
      at(31) // 10 min without Tired ends the episode
      t.state({ situation: 'focused' })
      at(32)
      t.state({ situation: 'low' })
      expect(t.events('move:nudge').map((n) => n.moveId)).toEqual([
        'stand-stretch',
        'stand-stretch'
      ])
    })

    it('long stress gets one step-outside, then nothing more until it ends', () => {
      const t = setup()
      t.state({ situation: 'tense' })
      t.moves.respond(t.nudgeId(), 'skip')
      for (const min of [5, 10, 16, 20, 40, 60]) {
        at(min)
        t.state({ situation: 'tense' })
        if (t.card().kind === 'nudge') t.moves.respond(t.nudgeId(), 'skip')
      }
      expect(t.events('move:nudge').map((n) => n.moveId)).toEqual(['breathe', 'step-outside'])
    })

    it('a mood suggestion waits for the mood the state engine has held (no early guess)', () => {
      // The hold itself lives in the state engine (src/main/state/state.test.ts); moves only acts on
      // the held situation it reports, never on raw readings.
      const t = setup()
      t.state({ situation: 'focused', trend: 'rising' })
      t.metrics({ cardio: { pulseRate: { value: 110, confidence: 90, stable: true } } } as never)
      expect(t.events('move:nudge')).toHaveLength(0)
      t.state({ situation: 'tense' })
      expect(t.events('move:nudge').map((n) => n.moveId)).toEqual(['breathe'])
    })

    it('demo (nudges off) shows no mood or timed suggestion, with or without the camera', () => {
      for (const camera of [true, false]) {
        const t = setup({ camera, nudgeInterval: 0, config: { ...cfg, nudges: false } })
        for (const situation of ['tense', 'crashing', 'low'] as const) {
          t.state({ situation, seatedMinutes: 200 })
          at(30)
        }
        t.bus.emit('session:tick', { sessionId: 's1', elapsedSec: 60, remainingSec: 0 })
        expect(t.events('move:nudge')).toEqual([])
        expect(t.card().kind).toBe('hidden')
        t.moves.stopSession()
      }
    })
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

  it('falls back to timed nudges when the session loses sensing', () => {
    const t = setup()
    t.bus.emit('session:status', { ...t.session, sensingEnabled: false })
    vi.advanceTimersByTime(46 * MIN)
    t.bus.emit('session:tick', { sessionId: 's1', elapsedSec: 2760, remainingSec: 0 })
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
    expect(t.card()).toMatchObject({ kind: 'move', stepIndex: 0, remainingSec: 12 })
    vi.advanceTimersByTime(1000)
    expect(t.card()).toMatchObject({ kind: 'move', stepIndex: 0, remainingSec: 11 })
    vi.advanceTimersByTime(89_000)
    const steps = t.events('move:step')
    expect(new Set(steps.map((s) => s.stepIndex))).toEqual(new Set([0, 1, 2, 3, 4, 5]))
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
    vi.advanceTimersByTime(12_000)
    expect(t.card()).toMatchObject({ stepIndex: 1, feedback: undefined })
    vi.advanceTimersByTime(78_000)
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
      { result: 'still-tense', message: 'Still feeling stressed? Want to breathe along for 1 min?' }
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
