import { createBus } from '../bus'
import {
  DEFAULT_SETTINGS,
  type Baseline,
  type CameraMode,
  type Expression,
  type FaceSnapshot,
  type MetricsSnapshot,
  type PrivacyService,
  type Situation,
  type StateUpdate
} from '@shared/types'
import { buildBaseline, classify, evaluateWindow, type WindowEval } from './classifier'
import { resolveConfig, stateConfig as cfg } from './config'
import { createStateEngine } from '.'

const MIN = 60_000
const r = (
  value: number,
  stable = true
): { value: number; confidence: number; stable: boolean } => ({
  value,
  confidence: 90,
  stable
})

interface Opts {
  pulse?: number
  breathing?: number
  rmssd?: number
  face?: Partial<FaceSnapshot>
  /** Blinks per minute (needs face). */
  blinkPerMin?: number
  expression?: Expression
}

/** One snapshot per second for `sec` seconds starting at `t0`. */
function stream(t0: number, sec: number, o: Opts): MetricsSnapshot[] {
  const out: MetricsSnapshot[] = []
  const blinkEvery = o.blinkPerMin ? Math.round(60 / o.blinkPerMin) : 0
  for (let i = 0; i < sec; i++) {
    const s: MetricsSnapshot = { t: t0 + i * 1000 }
    if (o.pulse !== undefined) s.pulse = r(o.pulse)
    if (o.breathing !== undefined) s.breathing = r(o.breathing)
    if (o.rmssd !== undefined)
      s.hrv = { rmssd: o.rmssd, meanNn: 900, sdnn: 50, baevsky: 0.3, confidence: 90, stable: true }
    if (o.face || o.blinkPerMin || o.expression) {
      s.face = {
        present: true,
        blinking: blinkEvery ? i % blinkEvery === 0 : false,
        ...(o.expression ? { expressions: { [o.expression]: 80, neutral: 10 } } : {}),
        ...o.face
      }
    }
    out.push(s)
  }
  return out
}

const full: Baseline = {
  pulse: 60,
  breathing: 14,
  rmssd: 90,
  baevsky: 0.3,
  samples: 90,
  builtAt: 0
}
const pulseOnly: Baseline = { pulse: 60, samples: 90, builtAt: 0 }

/** Runs windows through evaluate + classify like the engine does; returns each situation. */
function run(
  baseline: Baseline,
  windows: { at: number; sec?: number; o: Opts }[],
  mode: CameraMode = 'checkins'
): { situation: Situation | null; confidence: number }[] {
  const history: WindowEval[] = []
  let prev: Situation | null = null
  return windows.map(({ at, sec = 90, o }) => {
    const ev = evaluateWindow(stream(at, sec, o), baseline, cfg)
    if (ev) history.push(ev)
    const c = classify(history, mode, prev, cfg)
    prev = c.situation
    return c
  })
}
/** Check-ins every 5 min. */
const checkins = (...os: Opts[]): { at: number; o: Opts }[] =>
  os.map((o, i) => ({ at: i * 5 * MIN, o }))
const last = <T>(xs: T[]): T => xs[xs.length - 1]

describe('baseline', () => {
  it('builds medians, with breathing/HRV/blink optional', () => {
    const res = buildBaseline(stream(0, 60, { pulse: 62 }), cfg, 1)
    expect(res).toEqual({
      baseline: {
        pulse: 62,
        breathing: undefined,
        rmssd: undefined,
        baevsky: undefined,
        blinkRate: undefined,
        samples: 60,
        builtAt: 1
      }
    })
    const all = buildBaseline(
      stream(0, 60, { pulse: 62, breathing: 14, rmssd: 90, blinkPerMin: 15 }),
      cfg,
      1
    )
    expect(all).toMatchObject({ baseline: { pulse: 62, breathing: 14, rmssd: 90, baevsky: 0.3 } })
    expect('baseline' in all && all.baseline.blinkRate).toBeGreaterThan(10)
  })

  it('fails with a reason when there are too few stable pulse readings', () => {
    const res = buildBaseline(stream(0, 4, { pulse: 62 }), cfg, 1)
    expect(res).toEqual({ reason: expect.stringContaining('too few steady pulse readings') })
    const unstable = stream(0, 60, {}).map((s) => ({ ...s, pulse: r(62, false) }))
    expect('reason' in buildBaseline(unstable, cfg, 1)).toBe(true)
  })
})

describe('classifier', () => {
  it('focused near baseline, full confidence with secondary vitals', () => {
    const res = run(full, checkins({ pulse: 62, breathing: 14.5, rmssd: 88 }))
    expect(res[0]).toMatchObject({ situation: 'focused', confidence: cfg.confidenceFull })
  })

  it('tense needs 2 check-ins of pulse up AND RMSSD down', () => {
    const tense = { pulse: 68, rmssd: 70 }
    const res = run(full, checkins({ pulse: 60, rmssd: 90 }, tense, tense))
    expect(res.map((x) => x.situation)).toEqual(['focused', 'focused', 'tense'])
  })

  it('tense from pulse + faster breathing', () => {
    const tense = { pulse: 68, breathing: 18 }
    expect(last(run(full, checkins(tense, tense))).situation).toBe('tense')
  })

  it('pulse up alone is not tense when RMSSD/breathing are present and normal', () => {
    const o = { pulse: 68, breathing: 14, rmssd: 90 }
    expect(last(run(full, checkins(o, o, o))).situation).toBe('focused')
  })

  it('tense on a pulse-only stream, with lower confidence', () => {
    const res = run(pulseOnly, checkins({ pulse: 68 }, { pulse: 68 }))
    expect(last(res)).toMatchObject({ situation: 'tense', confidence: cfg.confidencePulseOnly })
  })

  it('continuous mode needs 3+ min of tense', () => {
    const windows = Array.from({ length: 8 }, (_, i) => ({
      at: i * 30_000,
      sec: 30,
      o: { pulse: 68 }
    }))
    const res = run(pulseOnly, windows, 'continuous').map((x) => x.situation)
    expect(res.indexOf('tense')).toBe(6) // first window starts at 0, the 7th ends at 3:30
    expect(res.slice(0, 6).every((s) => s === 'focused')).toBe(true)
  })

  it('crashing after 10+ min of tense', () => {
    const t = { pulse: 68, rmssd: 70 }
    const res = run(full, checkins(t, t, t)).map((x) => x.situation)
    expect(res).toEqual(['focused', 'tense', 'crashing'])
  })

  it('crashing from pulse +20% with negative face, once tense is held', () => {
    const t = { pulse: 74, rmssd: 70, expression: 'angry' as const }
    expect(run(full, checkins(t, t)).map((x) => x.situation)).toEqual(['focused', 'crashing'])
  })

  it('low from pulse down AND slow breathing', () => {
    expect(run(full, checkins({ pulse: 54, breathing: 11 }))[0].situation).toBe('low')
    // breathing present and normal: not low
    expect(run(full, checkins({ pulse: 54, breathing: 14 }))[0].situation).toBe('focused')
  })

  it('low on a pulse-only stream, with lower confidence', () => {
    expect(run(pulseOnly, checkins({ pulse: 54 }))[0]).toMatchObject({
      situation: 'low',
      confidence: cfg.confidencePulseOnly
    })
  })

  it('high blink rate supports a softer pulse drop', () => {
    const base = { ...pulseOnly, blinkRate: 10 }
    expect(run(base, checkins({ pulse: 57, blinkPerMin: 30 }))[0].situation).toBe('low')
    expect(run(base, checkins({ pulse: 57, blinkPerMin: 10 }))[0].situation).toBe('focused')
  })

  it('good when focused and happy is the top expression', () => {
    expect(run(full, checkins({ pulse: 61, rmssd: 90, expression: 'happy' }))[0].situation).toBe(
      'good'
    )
  })

  it('face alone never triggers a situation', () => {
    const base = { ...full, blinkRate: 10 }
    for (const o of [
      { pulse: 60, rmssd: 90, expression: 'angry' as const },
      { pulse: 60, rmssd: 90, expression: 'sad' as const, blinkPerMin: 40 },
      { pulse: 60, rmssd: 90, blinkPerMin: 40 }
    ]) {
      expect(run(base, checkins(o, o, o)).map((x) => x.situation)).toEqual([
        'focused',
        'focused',
        'focused'
      ])
    }
  })

  it('one spike reading does not flip the situation', () => {
    const w = stream(0, 90, { pulse: 60, rmssd: 90 })
    w[45] = { ...w[45], pulse: r(140), hrv: { ...w[45].hrv!, rmssd: 20 } }
    const ev = evaluateWindow(w, full, cfg)!
    expect(ev.signal).toBe('steady')
    // and one odd window keeps the previous situation
    const res = run(full, checkins({ pulse: 60 }, { pulse: 70, rmssd: 60 }, { pulse: 60 }))
    expect(res.map((x) => x.situation)).toEqual(['focused', 'focused', 'focused'])
    expect(res[1].confidence).toBeLessThan(cfg.confidenceFull)
  })

  it('ignores breathing for a window with talking', () => {
    const o = { pulse: 68, rmssd: 90, breathing: 20 }
    expect(last(run(full, checkins(o, o))).situation).toBe('tense')
    const talking = { ...o, face: { talking: true } }
    expect(last(run(full, checkins(talking, talking))).situation).toBe('focused')
  })

  it('ignores unstable readings', () => {
    const w = stream(0, 90, {}).map((s) => ({ ...s, pulse: r(90, false) }))
    expect(evaluateWindow(w, full, cfg)).toBeNull()
  })

  it('reports trend from pulse change', () => {
    const res = run(pulseOnly, checkins({ pulse: 60 }, { pulse: 63 }))
    const history = [60, 63].map((p, i) =>
      evaluateWindow(stream(i * 5 * MIN, 90, { pulse: p }), pulseOnly, cfg)!
    )
    expect(classify(history, 'checkins', 'focused', cfg).trend).toBe('rising')
    expect(classify(history.reverse(), 'checkins', 'focused', cfg).trend).toBe('falling')
    expect(res[1].situation).toBe('focused')
  })
})

describe('config overrides', () => {
  it('applies known numeric keys only', () => {
    const c = resolveConfig({ tensePulsePct: 0.3, bogus: 1, awayNoFaceSec: NaN })
    expect(c.tensePulsePct).toBe(0.3)
    expect(c.awayNoFaceSec).toBe(cfg.awayNoFaceSec)
    expect('bogus' in c).toBe(false)
  })
})

describe('state engine', () => {
  let overrides: Record<string, number>
  const privacy = {
    getSettings: () => ({ ...DEFAULT_SETTINGS, thresholdOverrides: overrides })
  } as unknown as PrivacyService

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test harness, inferred
  function setup(mode: CameraMode = 'checkins') {
    const bus = createBus()
    const engine = createStateEngine({ bus, privacy })
    const updates: StateUpdate[] = []
    const ready: { ok: boolean; reason?: string }[] = []
    bus.on('state:updated', (u) => updates.push(u))
    bus.on('state:baseline-ready', (p) => ready.push(p))
    bus.emit('session:started', {
      id: 's',
      startedAt: Date.now(),
      status: 'calibrating',
      sensingEnabled: true,
      config: {
        activity: 'deep-work',
        lengthMin: 60,
        cameraMode: mode,
        checkinIntervalMin: 5,
        music: false
      }
    })
    engine.reset()
    /** Runs a camera phase at the current fake time, one snapshot per second. */
    const phase = (p: 'calibration' | 'checkin' | 'return-check', sec: number, o: Opts): void => {
      bus.emit('sdk:checkin-started', { phase: p })
      for (const s of stream(Date.now(), sec, o)) {
        vi.setSystemTime(s.t)
        if (o.pulse !== undefined || o.face) bus.emit('sdk:metrics', s)
      }
      vi.advanceTimersByTime(1000)
      bus.emit('sdk:checkin-ended', { phase: p })
    }
    const wait = (ms: number): void => {
      vi.advanceTimersByTime(ms)
    }
    return { bus, engine, updates, ready, phase, wait }
  }

  beforeEach(() => {
    overrides = {}
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })
  afterEach(() => vi.useRealTimers())

  it('builds a baseline, then classifies each check-in', () => {
    const { ready, updates, phase, wait } = setup()
    phase('calibration', 90, { pulse: 60, rmssd: 90 })
    expect(ready).toEqual([{ ok: true }])
    expect(last(updates).situation).toBe('focused')
    for (let i = 0; i < 2; i++) {
      wait(3.5 * MIN)
      phase('checkin', 90, { pulse: 68, rmssd: 70 })
    }
    expect(updates.map((u) => u.situation)).toEqual(['focused', 'focused', 'tense'])
  })

  it('reports baseline failure and stays without a situation', () => {
    const { ready, updates, phase, wait } = setup()
    phase('calibration', 90, { face: { present: true } })
    expect(ready).toEqual([{ ok: false, reason: expect.stringContaining('too few') }])
    wait(MIN)
    phase('checkin', 90, { pulse: 68 })
    expect(last(updates).situation).toBeNull()
  })

  it('uses threshold overrides from settings', () => {
    overrides = { tensePulsePct: 0.3 }
    const { updates, phase, wait } = setup()
    phase('calibration', 90, { pulse: 60 })
    for (let i = 0; i < 3; i++) {
      wait(3.5 * MIN)
      phase('checkin', 90, { pulse: 68 })
    }
    expect(last(updates).situation).toBe('focused')
  })

  it('seated time spans check-ins; a check-in with no face is a gap', () => {
    const { engine, phase, wait } = setup()
    phase('calibration', 90, { pulse: 60 })
    wait(3.5 * MIN)
    phase('checkin', 90, { pulse: 60 })
    expect(engine.current().seatedMinutes).toBeGreaterThanOrEqual(6.5)
    wait(3.5 * MIN)
    phase('checkin', 90, {})
    expect(engine.current().seatedMinutes).toBe(0)
    wait(3.5 * MIN)
    phase('checkin', 90, { pulse: 60 })
    expect(engine.current().seatedMinutes).toBeCloseTo(1.5, 0)
  })

  it('manual breaks set away; dispose drops the baseline', () => {
    const { bus, engine, updates, phase, wait } = setup()
    phase('calibration', 90, { pulse: 60 })
    bus.emit('break:away', { since: Date.now(), manual: true })
    expect(last(updates)).toMatchObject({ away: true, seatedMinutes: 0 })
    wait(MIN)
    bus.emit('break:returned', { awayMs: MIN })
    expect(last(updates).away).toBe(false)
    engine.dispose()
    phase('checkin', 90, { pulse: 60 })
    expect(engine.current().situation).toBeNull()
  })

  it('continuous: periodic updates, away after 20 s without face, seated reset after 60 s', () => {
    const { bus, engine, updates, phase } = setup('continuous')
    phase('calibration', 90, { pulse: 60 })
    bus.emit('sdk:checkin-started', { phase: 'continuous' })
    const feed = (sec: number): void => {
      for (let i = 0; i < sec; i++) {
        bus.emit('sdk:metrics', { t: Date.now(), pulse: r(60) })
        vi.advanceTimersByTime(1000)
      }
    }
    const before = updates.length
    feed(120)
    expect(updates.length - before).toBe(4) // every 30 s
    const seated = engine.current().seatedMinutes
    expect(seated).toBeGreaterThan(3)

    // Leave for 30 s: away after 20 s, seated time continues on return (gap < 60 s)
    vi.advanceTimersByTime(18_000)
    expect(engine.current().away).toBe(false)
    vi.advanceTimersByTime(2_000)
    expect(engine.current().away).toBe(true)
    vi.advanceTimersByTime(9_000)
    feed(1)
    expect(engine.current().away).toBe(false)
    expect(engine.current().seatedMinutes).toBeGreaterThan(seated)

    // Leave for 70 s: seated time restarts
    vi.advanceTimersByTime(70_000)
    feed(1)
    expect(engine.current().seatedMinutes).toBeLessThan(0.1)

    // Face present = false counts as no face
    for (let i = 0; i < 25; i++) {
      bus.emit('sdk:metrics', { t: Date.now(), face: { present: false } })
      vi.advanceTimersByTime(1000)
    }
    expect(engine.current().away).toBe(true)
  })
})
