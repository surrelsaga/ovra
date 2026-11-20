import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AppSettings,
  Baseline,
  MetricsSnapshot,
  MoveCardView,
  MoveId,
  Session,
  Situation
} from '@shared/types'
import { createBus } from '../bus'
import { createStorage } from '../storage'
import { createPrivacy } from '../privacy'
import { createMoves } from '../moves'
import { MOVES_CONFIG } from '../moves/config'
import { musicConfig } from '../music/config'
import { sensingConfig } from '../sdk/config'
import { SPOTIFY_CLOSED_HINT, SPOTIFY_HINT } from '../music/config'
import { classify, evaluateWindow, type WindowEval } from '../state/classifier'
import { resolveConfig, stateConfig, type StateConfig } from '../state/config'
import { sessionConfig, type DemoStep } from './config'
import { bindDemo } from './demo'

vi.mock('../ipc', () => ({ broadcast: vi.fn(), handle: vi.fn() }))

const demo = sessionConfig.demo
const session = (demoOn: boolean): Session => ({
  id: demoOn ? 'demo' : 'real',
  startedAt: 0,
  status: 'calibrating',
  sensingEnabled: true,
  config: {
    activity: 'focus',
    lengthMin: 15,
    cameraMode: 'continuous',
    checkinIntervalMin: 5,
    music: true,
    ...(demoOn && { demo: true })
  }
})

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ovra-demo-'))
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true })
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test harness, inferred
async function setup(face = true) {
  const bus = createBus()
  const overlay: Partial<AppSettings> = {}
  const privacy = await createPrivacy({
    storage: createStorage(dir),
    bus,
    settingsOverlay: overlay
  })
  const moves = { ...MOVES_CONFIG }
  const musicGap = { ...musicConfig.switching }
  const sensing = { ...sensingConfig }
  await privacy.set({ face: face ? 'vitals-and-face' : 'vitals-only' })
  const music = { preview: vi.fn() }
  const cards = { preview: vi.fn() }
  const dispose = bindDemo({ bus, privacy, overlay, moves, musicGap, sensing, music, cards })
  const live = (): Record<string, unknown> => ({
    state: resolveConfig(privacy.getSettings().thresholdOverrides),
    nudge: privacy.getSettings().nudgeMinIntervalMin,
    nudges: moves.nudges,
    exercises: moves.moves,
    returnMessages: moves.returnMessages,
    triggers: moves.triggers,
    snooze: moves.snoozeMin,
    returnCheck: moves.returnCheck,
    musicGap: { ...musicGap },
    sensing: { ...sensing }
  })
  return { bus, privacy, live, dispose, music, cards }
}

describe('demo pace', () => {
  it('shortens only waits, keeps thresholds, writes nothing and restores everything', async () => {
    const { bus, privacy, live } = await setup()
    const normal = live()

    bus.emit('session:started', session(true))
    const c = live().state as StateConfig
    expect(c).toMatchObject({ tenseHoldMin: 0.75, lowHoldMin: 1, noReadForgetMin: 1 })
    for (const key of Object.keys(stateConfig) as (keyof StateConfig)[]) {
      const want = key in demo.state ? demo.state[key as keyof typeof demo.state] : stateConfig[key]
      expect(c[key], key).toBe(want)
    }
    expect(live().sensing).toMatchObject(demo.sensing)
    expect(live().musicGap).toMatchObject({
      minTargetChangeMs: 20_000,
      windDownSec: 120,
      switchNow: true,
      switchAfterSongs: { focus: 3, reading: 3, creative: 3, everyday: 3, unwind: 3 }
    })
    // Only the tour shows cards: suggestions off, short walk / step outside, no breathing round.
    expect(live().nudges).toBe(false)
    expect(live().exercises).toMatchObject(demo.moves)
    expect(live().returnMessages).toMatchObject({ stillTense: demo.stillTense })
    expect(live().triggers).toBe(MOVES_CONFIG.triggers)
    expect((live().returnCheck as { durationSec: number }).durationSec).toBe(20)

    bus.emit('session:status', { ...session(true), status: 'ended' })
    expect(live()).toEqual(normal)
    expect(privacy.getSettings()).not.toHaveProperty('thresholdOverrides.tenseHoldMin')
    expect(await readdir(dir)).not.toContain('settings.json')

    // A normal session afterwards runs on normal timings.
    bus.emit('session:started', session(false))
    expect(live()).toEqual(normal)
    expect(MOVES_CONFIG.triggers.neckSeatedMin).toEqual({
      focus: 30,
      reading: 30,
      creative: 25,
      everyday: 25,
      unwind: 25
    })
    expect(musicConfig.switching.minTargetChangeMs).toBe(3 * 60_000)
    expect(musicConfig.switching.windDownSec).toBe(600)
    expect(musicConfig.switching.switchNow).toBe(false)
    expect(stateConfig.baselineSettleMin).toBe(0)
    expect(MOVES_CONFIG.snoozeMin).toBe(5)
  })

  it("keeps the user's own threshold overrides during a demo", async () => {
    const { bus, privacy, live } = await setup()
    await privacy.setSettings({ thresholdOverrides: { tensePulsePct: 0.12 } })
    bus.emit('session:started', session(true))
    expect((live().state as StateConfig).tensePulsePct).toBe(0.12)
    bus.emit('session:status', { ...session(true), status: 'ended' })
    expect(privacy.getSettings().thresholdOverrides).toEqual({ tensePulsePct: 0.12 })
  })
})

/** Sit down after a squat burst: pulse +40 % decaying back to the usual (pulse only, 1 reading a second). */
function exerciseRun(cfg: StateConfig): Situation[] {
  const baseline: Baseline = { pulse: 70, samples: 30, builtAt: 0 }
  const snaps: MetricsSnapshot[] = Array.from({ length: 600 }, (_, i) => ({
    t: i * 1000,
    pulse: { value: 70 * (1 + 0.4 * Math.exp(-i / 90)), confidence: 90, stable: true }
  }))
  const history: WindowEval[] = []
  let situation: Situation | null = 'focused'
  const seen: Situation[] = []
  for (let t = cfg.continuousUpdateSec * 1000; t <= 600_000; t += cfg.continuousUpdateSec * 1000) {
    const w = snaps.filter((s) => s.t <= t && s.t >= t - cfg.continuousWindowSec * 1000)
    const ev = evaluateWindow(w, baseline, cfg)
    if (ev) history.push(ev)
    situation = classify(history, 'continuous', situation, cfg).situation
    if (situation) seen.push(situation)
  }
  return seen
}

describe('synthetic exercise curve', () => {
  it('reaches tense in demo pace but not with normal timings', () => {
    expect(exerciseRun(resolveConfig({ ...demo.state }))).toContain('tense')
    expect(exerciseRun(resolveConfig())).not.toContain('tense')
  })

  it.each([
    { dipSec: 10, lowWindows: 1 },
    { dipSec: 20, lowWindows: 3 }
  ])(
    'rejects a $dipSec s dip followed by no reads ($lowWindows low windows)',
    ({ dipSec, lowWindows }) => {
      const cfg = resolveConfig(demo.state)
      const baseline: Baseline = { pulse: 70, samples: 30, builtAt: 0 }
      // Synthetic log shape: steady, a short dip, then visible but unmeasurable.
      const snaps: MetricsSnapshot[] = Array.from({ length: 240 }, (_, i) => ({
        t: i * 1000,
        ...(i < 40 + dipSec && {
          pulse: { value: i < 40 ? 70 : 63, confidence: 90, stable: true }
        })
      }))
      const history: WindowEval[] = []
      let situation: Situation | null = 'focused'
      const seen: (Situation | null)[] = []
      for (let t = 30_000; t < 240_000; t += cfg.continuousUpdateSec * 1000) {
        history.push(
          evaluateWindow(
            snaps.filter((s) => s.t <= t && s.t >= t - cfg.continuousWindowSec * 1000),
            baseline,
            cfg
          )
        )
        situation = classify(history, 'continuous', situation, cfg).situation
        seen.push(situation)
      }
      expect(history.filter((w) => w.signal === 'low')).toHaveLength(lowWindows)
      expect(history.at(-1)?.signal).toBe('noread')
      expect(seen).not.toContain('low')
      expect(seen.every((s) => s === 'focused')).toBe(true)
    }
  )
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test harness
async function tour(face = true, demoOn = true) {
  const t = await setup(face)
  const hints: string[] = []
  t.bus.on('orb:bubble', (b) => {
    expect(b.ttlMs).toBe(b.previewMood ? demo.previewMs : demo.hintTtlMs)
    hints.push(b.text)
  })
  const state = (situation: Situation, away = false): void =>
    t.bus.emit('state:updated', {
      t: Date.now(),
      situation,
      confidence: 1,
      seatedMinutes: 0,
      away,
      trend: 'steady'
    })
  const next = (): void => {
    vi.advanceTimersByTime(demo.doneDelayMs)
  }
  /** After a mood step showed its card, the next step waits for it to be read. */
  const read = (): void => {
    vi.advanceTimersByTime(demo.cardReadMs)
  }
  const timeout = (index: number): void => {
    const step: DemoStep = demo.steps[index]
    vi.advanceTimersByTime(step.limitMs!)
    expect(hints.at(-1)).toBe(step.fallback)
    if (step.card && step.preview && step.preview !== 'away') read()
    else next()
  }
  const returned = (): void =>
    t.bus.emit('break:return-check', { result: 'calmer', message: 'Welcome back.' })
  t.bus.emit('session:started', session(demoOn))
  const calibrated = (): void => t.bus.emit('state:baseline-ready', { ok: true })
  return { ...t, hints, state, next, read, timeout, returned, calibrated }
}

const cardMoves = (calls: unknown[][]): unknown[] => calls.map(([move]) => move)
const ALL_CARDS = ['neck-stretch', 'breathe', 'walk', 'step-outside', 'stand-stretch']

describe('demo steps', () => {
  beforeEach(() => vi.useFakeTimers())

  it('records early moods and an early away without jumping ahead or skipping a card', async () => {
    const t = await tour()
    t.state('low') // even before calibration completes
    expect(t.hints).toEqual([])
    t.calibrated()
    expect(t.hints).toEqual([demo.steps[0].text])
    t.state('low')
    expect(t.hints).toHaveLength(1)
    t.state('focused')
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[1].text)
    t.returned() // an early away and back doesn't count for step 7
    t.timeout(1)
    expect(t.hints.at(-1)).toBe(demo.steps[2].text)
    t.bus.emit('move:completed', { moveId: 'neck-stretch', verified: true })
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[3].text)
    t.timeout(3) // no tense: breathing is offered as a labelled preview, not skipped
    expect(t.hints.at(-1)).toBe(demo.steps[4].unseen)
    t.timeout(4)
    expect(t.hints.at(-1)).toBe(demo.steps[5].text)
    t.timeout(5)
    expect(t.hints.at(-1)).toBe(demo.steps[6].text)
    t.returned()
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[7].already)
    t.read()
    expect(t.hints.at(-1)).toBe(demo.steps[8].text)
    expect(t.hints.every((h) => h.startsWith('Demo:'))).toBe(true)
    expect(cardMoves(t.cards.preview.mock.calls)).toEqual(ALL_CARDS)
  })

  it('times out to an honest fallback, then enters only the next step after 5 s', async () => {
    const t = await tour()
    t.calibrated()
    vi.advanceTimersByTime(demo.steps[0].limitMs! - 1)
    expect(t.hints).toEqual([demo.steps[0].text])
    vi.advanceTimersByTime(1)
    expect(t.hints.at(-1)).toBe(demo.steps[0].fallback)
    vi.advanceTimersByTime(demo.doneDelayMs - 1)
    expect(t.hints).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(t.hints.at(-1)).toBe(demo.steps[1].text)
  })

  it('acknowledges early moods, but card steps always run and show their card', async () => {
    const t = await tour()
    t.calibrated()
    t.state('good')
    vi.advanceTimersByTime(demo.doneDelayMs - 1)
    expect(t.hints).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(t.hints.at(-1)).toBe(demo.steps[1].already)
    t.bus.emit('move:completed', { moveId: 'breathe', verified: true })
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[2].text) // an earlier move doesn't skip the stretch
    t.state('tense')
    t.state('focused') // settled early: step 5 still waits for its own breathing
    t.bus.emit('move:completed', { moveId: 'neck-stretch', verified: true })
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[3].already)
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[4].text)
    t.state('crashing')
    vi.advanceTimersByTime(demo.steps[4].limitMs! - 1)
    expect(t.hints.at(-1)).toBe(demo.steps[4].text)
    vi.advanceTimersByTime(1)
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[5].already)
    t.read()
    expect(t.hints.at(-1)).toBe(demo.steps[6].text)
    expect(t.cards.preview.mock.calls).toEqual([
      ['neck-stretch', demo.steps[2].card!.text],
      ['breathe', MOVES_CONFIG.messages.breathe.tense],
      ['walk', demo.steps[5].card!.text],
      ['step-outside', demo.steps[6].card!.text]
    ])
  })

  it('skips Good mood with an explanation when face reading is off', async () => {
    const t = await tour(false)
    t.calibrated()
    t.state('focused')
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[1].noFace)
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[2].text)
  })

  it('visits the whole tour in order with real goals, including move completion and settling', async () => {
    const t = await tour()
    t.calibrated()
    t.state('focused')
    t.next()
    t.state('good')
    t.next()
    t.bus.emit('move:completed', { moveId: 'neck-stretch', verified: true })
    t.next()
    t.state('tense')
    t.next()
    t.bus.emit('move:completed', { moveId: 'breathe', verified: true })
    t.next()
    t.state('crashing')
    t.read()
    t.returned()
    t.next()
    t.state('low')
    t.read()
    expect(t.hints).toEqual(demo.steps.map((s) => s.text))
    vi.advanceTimersByTime(1_000_000)
    expect(t.hints).toHaveLength(9)
  })

  it('step 7 waits while you are away, and ends with the return check', async () => {
    const t = await tour()
    t.calibrated()
    for (let i = 0; i < 6; i++) t.timeout(i)
    expect(t.hints.at(-1)).toBe(demo.steps[6].text)
    expect(t.cards.preview).toHaveBeenLastCalledWith('step-outside', demo.steps[6].card!.text)
    t.bus.emit('break:away', { since: Date.now(), manual: false })
    vi.advanceTimersByTime(10 * 60_000) // no "didn't see you leave" while out
    expect(t.hints.at(-1)).toBe(demo.steps[6].text)
    t.bus.emit('break:returned', { awayMs: 20_000 }) // the return check is still running
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[6].text)
    t.returned()
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[7].text)
  })

  it('starts after successful calibration only, and remains hint-free in normal mode', async () => {
    const t = await tour(true, false)
    t.calibrated()
    t.state('good')
    vi.advanceTimersByTime(1_000_000)
    expect(t.hints).toEqual([])
    t.bus.emit('session:started', session(true))
    t.bus.emit('state:baseline-ready', { ok: false, reason: 'No steady reading' })
    expect(t.hints).toEqual([])
    t.calibrated()
    expect(t.hints).toEqual([demo.steps[0].text])
    t.calibrated()
    expect(t.hints).toHaveLength(1)
  })

  it.each(['end', 'dispose', 'new normal session'])('clears timers on %s', async (stop) => {
    const t = await tour()
    t.calibrated()
    t.state('focused') // delayed next step is pending
    if (stop === 'end') t.bus.emit('session:status', { ...session(true), status: 'ended' })
    else if (stop === 'dispose') t.dispose()
    else t.bus.emit('session:started', session(false))
    vi.advanceTimersByTime(1_000_000)
    t.state('good')
    expect(t.hints).toHaveLength(1)
  })
})

it('keeps an all-fallback tour within about 11 minutes, with readable times in every hint', () => {
  // Step cards leave time to do the 90 s move.
  expect(demo.steps[2].limitMs).toBeGreaterThan(MOVES_CONFIG.moves['neck-stretch'].lengthSec * 1000)
  expect(demo.steps[4].limitMs).toBeGreaterThan(MOVES_CONFIG.moves.breathe.lengthSec * 1000)
  expect(demo.steps[3].limitMs).toBeLessThanOrEqual(60_000)
  expect(demo.steps[5].limitMs).toBeLessThanOrEqual(60_000)
  expect(demo.steps[6].limitMs).toBeLessThanOrEqual(60_000)
  expect(demo.steps[7].limitMs).toBeLessThanOrEqual(45_000)
  for (const s of demo.steps.slice(0, -1)) expect(s.text).toMatch(/about (\d+ s|a minute|1½ min)/)
  // Readable: previews at least 6 s, music long enough to hear a switch.
  expect(demo.previewMs).toBeGreaterThanOrEqual(6_000)
  expect(demo.previewMusicMs).toBeGreaterThanOrEqual(20_000)
  expect(demo.previewMusicMs).toBeLessThanOrEqual(30_000)
  expect(demo.cardReadMs).toBeGreaterThanOrEqual(10_000)
  const steps: DemoStep[] = demo.steps
  const maxTour =
    demo.sensing.calibrationMaxMs +
    steps.reduce((ms, s) => ms + (s.limitMs ?? 0), 0) +
    steps
      .slice(0, -1)
      .reduce(
        (ms, s) =>
          ms + (s.card && s.preview && s.preview !== 'away' ? demo.cardReadMs : demo.doneDelayMs),
        0
      )
  expect(maxTour).toBeLessThanOrEqual(11 * 60_000)
})

describe('missed-mood reaction previews', () => {
  beforeEach(() => vi.useFakeTimers())

  it('previews orb, music and card for each missed mood, recording nothing', async () => {
    const t = await tour()
    const emit = vi.spyOn(t.bus, 'emit')
    t.calibrated()
    emit.mockClear()
    for (let i = 0; i < demo.steps.length - 1; i++) t.timeout(i)
    expect(t.hints.at(-1)).toBe(demo.steps[8].text)
    // Only the bubble (with its labelled moon look) goes on the bus: no state, history or move events.
    expect(new Set(emit.mock.calls.map(([name]) => name))).toEqual(new Set(['orb:bubble']))
    const previews = emit.mock.calls
      .map(([, b]) => b as { text: string; previewMood?: string })
      .filter((b) => b.previewMood)
    expect(previews.map((b) => b.previewMood)).toEqual([
      'calm',
      'bright',
      'uneasy',
      'stormy',
      'away',
      'dim'
    ])
    for (const b of previews) expect(b.text).toContain('Preview:')
    expect(t.music.preview.mock.calls).toEqual(
      (['focused', 'good', 'tense', 'crashing', 'low'] as const).map((s) => [
        s,
        demo.previewMusicMs
      ])
    )
    // Every exercise card once, in step order: the stretch at once, the rest labelled previews.
    expect(cardMoves(t.cards.preview.mock.calls)).toEqual(ALL_CARDS)
    for (const [, text] of t.cards.preview.mock.calls.slice(1)) expect(text).toMatch(/^Preview: /)
    // The music words in the bubble match the orb pill's music labels.
    expect(demo.steps[3].fallback).toContain('Calm down')
    expect(demo.steps[5].fallback).toContain('Quiet')
    expect(demo.steps[7].fallback).toContain('Pick me up')
    // Step 5 is a labelled breathing preview, not a dead end.
    expect(t.hints).toContain(demo.steps[4].unseen)
    t.dispose()
  })

  it('a tried preview breathing round completes step 5 like the real one', async () => {
    const t = await tour()
    t.calibrated()
    for (let i = 0; i < 4; i++) t.timeout(i)
    expect(t.hints.at(-1)).toBe(demo.steps[4].unseen)
    t.bus.emit('move:completed', { moveId: 'breathe', verified: false })
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[5].text)
  })

  it('uses the real reaction when the mood shows: no previews', async () => {
    const t = await tour()
    t.calibrated()
    t.state('focused')
    t.next()
    t.state('good')
    t.next()
    t.bus.emit('move:completed', { moveId: 'neck-stretch', verified: true })
    t.next()
    t.state('tense')
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[4].text)
    t.bus.emit('move:completed', { moveId: 'breathe', verified: true })
    t.next()
    t.state('crashing')
    t.read()
    t.returned()
    t.next()
    t.state('low')
    t.read()
    expect(t.music.preview).not.toHaveBeenCalled()
    // Each step's card shows once, with the real reminder's words for a live mood.
    expect(t.cards.preview.mock.calls).toEqual([
      ['neck-stretch', demo.steps[2].card!.text],
      ['breathe', MOVES_CONFIG.messages.breathe.tense],
      ['walk', MOVES_CONFIG.messages.walk.crashing],
      ['step-outside', demo.steps[6].card!.text],
      ['stand-stretch', MOVES_CONFIG.messages['stand-stretch'].low]
    ])
    expect(t.hints.some((h) => h.includes('Preview:'))).toBe(false)
  })

  it('shows the stretch card as soon as step 3 starts', async () => {
    const t = await tour()
    t.calibrated()
    t.timeout(0)
    expect(t.cards.preview).not.toHaveBeenCalled()
    t.timeout(1)
    expect(t.hints.at(-1)).toBe(demo.steps[2].text)
    expect(t.cards.preview).toHaveBeenCalledWith('neck-stretch', demo.steps[2].card!.text)
  })

  it('never previews in a normal session', async () => {
    const t = await tour(true, false)
    t.calibrated()
    vi.advanceTimersByTime(60 * 60_000)
    expect(t.hints).toEqual([])
    expect(t.music.preview).not.toHaveBeenCalled()
    expect(t.cards.preview).not.toHaveBeenCalled()
  })
})

/** The tour wired to the real moves service: every card the user would see. */
describe('demo with the real moves service', () => {
  beforeEach(() => vi.useFakeTimers())

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test harness
  async function run() {
    const bus = createBus()
    const overlay: Partial<AppSettings> = {}
    const privacy = await createPrivacy({
      storage: createStorage(dir),
      bus,
      settingsOverlay: overlay
    })
    await privacy.set({ camera: 'yes', face: 'vitals-and-face' })
    const cfg = { ...MOVES_CONFIG }
    const moves = createMoves({ bus, privacy }, cfg)
    bindDemo({
      bus,
      privacy,
      overlay,
      moves: cfg,
      musicGap: { ...musicConfig.switching },
      sensing: { ...sensingConfig },
      cards: moves
    })
    const views: MoveCardView[] = []
    bus.on('move:card', (v) => views.push(v))
    const nudges: unknown[] = []
    bus.on('move:nudge', (n) => nudges.push(n))
    const s: Session = { ...session(true), status: 'running' }
    bus.emit('session:started', s)
    moves.startSession(s)
    let away = false
    const state = (situation: Situation, a = away): void => {
      away = a
      bus.emit('state:updated', {
        t: Date.now(),
        situation,
        confidence: 1,
        seatedMinutes: 200,
        away,
        trend: 'steady'
      })
    }
    const card = (): MoveCardView => views.at(-1) ?? { kind: 'hidden' }
    const go = (): void => {
      const v = card()
      if (v.kind !== 'nudge') throw new Error(`no card: ${v.kind}`)
      moves.respond(v.nudge.id, 'go')
    }
    /** Each exercise card shown, once per nudge id. */
    const shown = (): MoveId[] => {
      const ids = new Map<string, MoveId>()
      for (const v of views) if (v.kind === 'nudge') ids.set(v.nudge.id, v.nudge.moveId)
      return [...ids.values()]
    }
    bus.emit('state:baseline-ready', { ok: true })
    return { bus, cfg, moves, state, card, go, shown, nudges, views }
  }

  it('all-fallback, untouched: every exercise card exactly once and nothing else', async () => {
    const t = await run()
    t.state('focused')
    vi.advanceTimersByTime(15 * 60_000)
    expect(t.shown()).toEqual(ALL_CARDS)
    expect(t.nudges).toEqual([])
  })

  it('real moods and a real step outside: each card once, no mood, timed or breathing-round card', async () => {
    const t = await run()
    const step = (ms: number): void => {
      vi.advanceTimersByTime(ms)
    }
    t.state('focused')
    step(demo.doneDelayMs)
    t.state('good')
    step(demo.doneDelayMs)
    // 3: stretch
    t.go()
    step(MOVES_CONFIG.moves['neck-stretch'].lengthSec * 1000)
    step(demo.doneDelayMs)
    // 4: stressed for real; moves itself suggests nothing
    t.state('tense')
    step(demo.doneDelayMs)
    // 5: breathe
    t.go()
    step(MOVES_CONFIG.moves.breathe.lengthSec * 1000)
    step(demo.doneDelayMs)
    // 6: very stressed; the walk is the short demo version and never a break
    t.state('crashing')
    t.go()
    expect(t.card()).toMatchObject({ kind: 'move', move: { name: 'Walk (demo version)' } })
    t.state('crashing', true)
    expect(t.card()).toMatchObject({ kind: 'move' })
    t.state('crashing', false)
    step(demo.cardReadMs)
    // 7: step outside for real: away look, then the return check
    expect(t.card()).toMatchObject({ kind: 'nudge', nudge: { moveId: 'step-outside' } })
    t.go()
    step(5_000)
    t.state('tense', true)
    expect(t.card()).toMatchObject({ kind: 'away' })
    step(20_000)
    t.state('tense', false)
    expect(t.card()).toMatchObject({ kind: 'return-check' })
    step((demo.returnCheckSec + MOVES_CONFIG.returnCheck.graceSec) * 1000)
    // Still stressed: a plain welcome back, no breathing round offered.
    expect(t.card()).toEqual({
      kind: 'return-result',
      result: 'still-tense',
      message: demo.stillTense
    })
    step(demo.doneDelayMs)
    // 8: tired
    t.state('low')
    step(demo.cardReadMs)
    expect(t.card()).toMatchObject({ kind: 'nudge', nudge: { moveId: 'stand-stretch' } })
    step(10 * 60_000)
    expect(t.shown()).toEqual(ALL_CARDS)
    expect(t.nudges).toEqual([])
    expect(
      t.views.some((v) => v.kind === 'move' && v.move.id === 'breathe' && v.move.lengthSec === 60)
    ).toBe(false)
  })

  it('restores the normal exercises and suggestions after the demo', async () => {
    const t = await run()
    expect(t.cfg.nudges).toBe(false)
    t.bus.emit('session:status', { ...session(true), status: 'ended' })
    expect(t.cfg.nudges).toBe(true)
    expect(t.cfg.moves).toBe(MOVES_CONFIG.moves)
    expect(t.cfg.returnMessages).toBe(MOVES_CONFIG.returnMessages)
  })
})

it('keeps every bubble short enough to fit the orb bubble without clipping', () => {
  // 120 chars wrap to at most 5 lines in the 204 px bubble; the zone holds 7 (orb.css).
  const MAX = 120
  const demoTexts = (demo.steps as DemoStep[]).flatMap((s) =>
    [s.text, s.fallback, s.unseen, s.already, s.noFace].filter((t): t is string => !!t)
  )
  const normal = [
    `${sensingConfig.lostMessage} ${sessionConfig.carryOnBubble}`,
    `${sensingConfig.networkMessage} ${sessionConfig.carryOnBubble}`,
    sessionConfig.cameraFailedBubble,
    sessionConfig.startAnywayBubble,
    SPOTIFY_HINT,
    SPOTIFY_CLOSED_HINT
  ]
  for (const text of [...demoTexts, ...normal]) expect(text.length, text).toBeLessThanOrEqual(MAX)
})
