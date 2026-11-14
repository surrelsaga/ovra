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
import { advanceHint, bindDemo } from './demo'

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
async function setup() {
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
  bindDemo({ bus, privacy, overlay, moves, musicGap, sensing })
  const live = (): Record<string, unknown> => ({
    state: resolveConfig(privacy.getSettings().thresholdOverrides),
    nudge: privacy.getSettings().nudgeMinIntervalMin,
    triggers: moves.triggers,
    returnCheck: moves.returnCheck,
    musicGap: { ...musicGap },
    sensing: { ...sensing }
  })
  return { bus, privacy, live }
}

describe('demo pace', () => {
  it('shortens only waits, keeps thresholds, writes nothing and restores everything', async () => {
    const { bus, privacy, live } = await setup()
    const normal = live()

    bus.emit('session:started', session(true))
    const c = live().state as StateConfig
    for (const key of Object.keys(stateConfig) as (keyof StateConfig)[]) {
      const want = key in demo.state ? demo.state[key as keyof typeof demo.state] : stateConfig[key]
      expect(c[key], key).toBe(want)
    }
    expect(live().sensing).toMatchObject(demo.sensing)
    expect(live().musicGap).toMatchObject({ minTargetChangeMs: 20_000 })
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
    expect(MOVES_CONFIG.triggers.neckSeatedMin).toBe(45)
    expect(musicConfig.switching.minTargetChangeMs).toBe(3 * 60_000)
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
})

describe('demo hints', () => {
  it('advances only on real events, in order, and skips ahead', () => {
    expect(advanceHint(0, 'focused')?.hint.text).toBe('Demo: smile or laugh at something funny.')
    expect(advanceHint(0, 'calibrated')).toMatchObject({ next: 1 })
    // Crashing early jumps past tense and breathe along.
    expect(advanceHint(2, 'crashing')?.hint.text).toMatch(/step away/)
    // Nothing behind the current step re-fires.
    expect(advanceHint(5, 'focused')).toBeNull()
  })

  it('shows each hint after its state happens, then the low step times out after ~2 min', async () => {
    vi.useFakeTimers()
    const { bus } = await setup()
    const hints: string[] = []
    bus.on('orb:bubble', (b) => hints.push(b.text))
    const state = (situation: Situation, away = false): void =>
      bus.emit('state:updated', {
        t: 0,
        situation,
        confidence: 1,
        seatedMinutes: 0,
        away,
        trend: 'steady'
      })

    bus.emit('state:baseline-ready', { ok: true })
    expect(hints).toEqual([]) // not a demo session
    bus.emit('session:started', session(true))
    bus.emit('state:baseline-ready', { ok: true })
    state('focused')
    state('focused') // repeats don't advance
    state('good')
    state('tense')
    expect(hints).toHaveLength(3)
    state('focused') // back from tense
    state('crashing')
    bus.emit('break:returned', { awayMs: 20_000 })
    expect(hints.slice(3)).toEqual([
      'Demo: push harder for about 2 minutes to see crashing out.',
      'Demo: step away from the camera for 20 s, then come back.',
      'Demo: breathe slowly, about 6 a minute, and blink often. This one may not trigger.'
    ])
    vi.advanceTimersByTime(120_000)
    expect(hints.at(-1)).toBe('Demo: let the session wind down to see your summary.')
    expect(hints.every((h) => h.startsWith('Demo:'))).toBe(true)

    bus.emit('session:status', { ...session(true), status: 'ended' })
    state('low')
    expect(hints).toHaveLength(7)
  })
})
