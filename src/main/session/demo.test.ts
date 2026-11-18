import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppSettings, Baseline, MetricsSnapshot, Session, Situation } from '@shared/types'
import { createBus } from '../bus'
import { createStorage } from '../storage'
import { createPrivacy } from '../privacy'
import { MOVES_CONFIG } from '../moves/config'
import { musicConfig } from '../music/config'
import { sensingConfig } from '../sdk/config'
import { classify, evaluateWindow, type WindowEval } from '../state/classifier'
import { resolveConfig, stateConfig, type StateConfig } from '../state/config'
import { sessionConfig } from './config'
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
    expect(live().snooze).toBe(1)
    expect(live().nudge).toBe(1)
    expect(live().triggers).toMatchObject(demo.triggers)
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
  const timeout = (index: number): void => {
    vi.advanceTimersByTime(demo.steps[index].limitMs!)
    expect(hints.at(-1)).toBe(demo.steps[index].fallback)
    next()
  }
  t.bus.emit('session:started', session(demoOn))
  const calibrated = (): void => t.bus.emit('state:baseline-ready', { ok: true })
  return { ...t, hints, state, next, timeout, calibrated }
}

describe('demo steps', () => {
  beforeEach(() => vi.useFakeTimers())

  it('records an early low without jumping ahead, then acknowledges it on step 8', async () => {
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
    t.bus.emit('break:returned', { awayMs: 20_000 })
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[7].already)
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[8].text)
    expect(t.hints.every((h) => h.startsWith('Demo:'))).toBe(true)
  })

  it('times out to an honest fallback, then enters only the next step after 8 s', async () => {
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

  it('acknowledges goals seen while finishing the previous step', async () => {
    const t = await tour()
    t.calibrated()
    t.state('good')
    vi.advanceTimersByTime(demo.doneDelayMs - 1)
    expect(t.hints).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(t.hints.at(-1)).toBe(demo.steps[1].already)
    t.bus.emit('move:completed', { moveId: 'breathe', verified: true })
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[2].already)
    t.state('tense')
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[3].already)
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[4].already)
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
    t.next()
    t.bus.emit('break:returned', { awayMs: 20_000 })
    t.next()
    t.state('low')
    t.next()
    expect(t.hints).toEqual(demo.steps.map((s) => s.text))
    vi.advanceTimersByTime(1_000_000)
    expect(t.hints).toHaveLength(9)
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

it('gives the exercises time to settle while keeping a no-mood tour to about 15 minutes', () => {
  const holdSec = { tense: demo.state.tenseHoldMin * 60, low: demo.state.lowHoldMin * 60 }
  expect(demo.steps[3].text).toContain('about 90 s')
  expect(demo.steps[3].limitMs).toBeGreaterThanOrEqual((90 + holdSec.tense) * 1000)
  expect(demo.steps[4].limitMs).toBeGreaterThan(MOVES_CONFIG.moves.breathe.lengthSec * 1000)
  expect(demo.steps[5].text).toContain('about 2 min')
  expect(demo.steps[5].text).toContain('frown')
  expect(demo.steps[5].limitMs).toBeGreaterThanOrEqual(120_000 + 30_000)
  expect(demo.steps[7].limitMs).toBeGreaterThanOrEqual(
    (demo.state.continuousWindowSec + holdSec.low) * 1000
  )
  expect(demo.steps[2].limitMs).toBeGreaterThan(MOVES_CONFIG.moves['neck-stretch'].lengthSec * 1000)
  // Every step runs now (breathing too), each followed by the pause before the next one.
  const maxTour =
    demo.sensing.calibrationMaxMs +
    demo.steps.reduce((ms, s) => ms + (s.limitMs ?? 0), 0) +
    (demo.steps.length - 1) * demo.doneDelayMs
  expect(maxTour).toBeGreaterThanOrEqual(14 * 60_000)
  expect(maxTour).toBeLessThanOrEqual(15.5 * 60_000)
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
      'dim'
    ])
    for (const b of previews) expect(b.text).toContain('Preview:')
    expect(t.music.preview.mock.calls).toEqual(
      (['focused', 'good', 'tense', 'crashing', 'low'] as const).map((s) => [
        s,
        demo.previewMusicMs
      ])
    )
    expect(t.cards.preview.mock.calls.map(([move]) => move)).toEqual([
      'breathe',
      'walk',
      'stand-stretch'
    ])
    for (const [, text] of t.cards.preview.mock.calls) expect(text).toMatch(/^Preview: /)
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
    t.next()
    t.bus.emit('break:returned', { awayMs: 20_000 })
    t.next()
    t.state('low')
    t.next()
    expect(t.music.preview).not.toHaveBeenCalled()
    expect(t.cards.preview).not.toHaveBeenCalled()
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
