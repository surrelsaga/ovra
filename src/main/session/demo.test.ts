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
  const dispose = bindDemo({ bus, privacy, overlay, moves, musicGap, sensing })
  const live = (): Record<string, unknown> => ({
    state: resolveConfig(privacy.getSettings().thresholdOverrides),
    nudge: privacy.getSettings().nudgeMinIntervalMin,
    triggers: moves.triggers,
    snooze: moves.snoozeMin,
    returnCheck: moves.returnCheck,
    musicGap: { ...musicGap },
    sensing: { ...sensing }
  })
  return { bus, privacy, live, dispose }
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
    t.timeout(3) // no tense: skip breathing only
    expect(t.hints.at(-1)).toBe(demo.steps[5].text)
    t.timeout(5)
    t.bus.emit('break:returned', { awayMs: 20_000 })
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[7].already)
    t.next()
    expect(t.hints.at(-1)).toBe(demo.steps[8].text)
    expect(t.hints.every((h) => h.startsWith('Demo:'))).toBe(true)
    expect(t.hints.some((h) => h.includes('5/9'))).toBe(false)
  })

  it('times out to an honest fallback, then enters only the next step after 8 s', async () => {
    const t = await tour()
    t.calibrated()
    vi.advanceTimersByTime(90_000 - 1)
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

it('gives the longer exercises time to settle while keeping a no-mood tour within 18 minutes', () => {
  expect(demo.steps[3].text).toContain('about 90 s')
  expect(demo.steps[3].limitMs).toBeGreaterThanOrEqual(90_000 + 75_000)
  expect(demo.steps[5].text).toContain('about 2 min')
  expect(demo.steps[5].text).toContain('frown')
  expect(demo.steps[5].limitMs).toBeGreaterThanOrEqual(120_000 + 75_000)
  const noMoodSteps = demo.steps.filter((s) => !('needs' in s))
  const maxTour =
    demo.sensing.calibrationMaxMs +
    noMoodSteps.reduce((ms, s) => ms + (s.limitMs ?? 0), 0) +
    (noMoodSteps.length - 1) * demo.doneDelayMs
  expect(maxTour).toBeGreaterThanOrEqual(16 * 60_000)
  expect(maxTour).toBeLessThanOrEqual(18 * 60_000)
})

it('emits only a labelled view bubble on a missed mood, never state, history, music or moves', async () => {
  vi.useFakeTimers()
  const t = await tour()
  const emit = vi.spyOn(t.bus, 'emit')
  t.calibrated()
  emit.mockClear()
  vi.advanceTimersByTime(demo.steps[0].limitMs!)
  expect(emit.mock.calls).toEqual([
    [
      'orb:bubble',
      {
        text: demo.steps[0].fallback,
        ttlMs: demo.previewMs,
        previewMood: 'calm'
      }
    ]
  ])
  // The preview must not mark a goal as seen or enable the real Stressed breathing step.
  t.next()
  t.timeout(1)
  t.timeout(2)
  t.timeout(3)
  expect(t.hints.at(-1)).toBe(demo.steps[5].text)
  expect(t.hints.some((h) => h.includes('5/9'))).toBe(false)
  t.dispose()
})
