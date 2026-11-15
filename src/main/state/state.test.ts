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
import { sessionConfig } from '../session/config'
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

  it('needs 30 distinct seconds of steady pulse, with the reason in plain words', () => {
    expect(buildBaseline(stream(0, 29, { pulse: 62 }), cfg, 1)).toEqual({
      reason: 'I only got 29 of 30 s of steady heart rate.'
    })
    expect('baseline' in buildBaseline(stream(0, 30, { pulse: 62 }), cfg, 1)).toBe(true)
    // Four readings a second for 10 s is still 10 s, not 40 readings.
    const burst = stream(0, 10, { pulse: 62 }).flatMap((s) =>
      [0, 250, 500, 750].map((ms) => ({ ...s, t: s.t + ms }))
    )
    expect(buildBaseline(burst, cfg, 1)).toEqual({
      reason: 'I only got 10 of 30 s of steady heart rate.'
    })
    const unstable = stream(0, 60, {}).map((s) => ({ ...s, pulse: r(62, false) }))
    expect('reason' in buildBaseline(unstable, cfg, 1)).toBe(true)
  })

  it('demo mode uses the same bars as real mode', () => {
    const demo = resolveConfig(sessionConfig.demo.state)
    for (const k of [
      'baselineMinPulseSec',
      'windowMinPulseSec',
      'goodMinFaceSec',
      'tensePulsePct',
      'tenseBackedPulsePct',
      'tenseRmssdDropPct',
      'tenseRmssdVetoPct',
      'lowPulsePct',
      'focusedPulsePct'
    ] as const)
      expect(demo[k], k).toBe(cfg[k])
  })
})

describe('classifier', () => {
  it.each([
    { pulse: 67.2, signal: 'unclear', backed: false }, // +12%, pulse only
    { pulse: 67.2, rmssd: 72, signal: 'tense', backed: true }, // +12%, RMSSD -20%
    { pulse: 69.6, signal: 'tense', backed: false }, // +16%, pulse only
    { pulse: 67.2, breathing: 20, signal: 'unclear', backed: false },
    { pulse: 69, signal: 'tense', backed: false }, // exact +15% bar
    { pulse: 66, rmssd: 76.5, signal: 'tense', backed: true } // exact backed bars
  ])('uses the correct tense bar for $pulse pulse and $rmssd RMSSD', (o) => {
    expect(evaluateWindow(stream(0, 30, o), full, cfg)).toMatchObject({
      signal: o.signal,
      backed: o.backed
    })
    expect(last(run(full, checkins(o, o))).situation).toBe(
      o.signal === 'tense' ? 'tense' : 'focused'
    )
  })

  it.each([
    { pulse: 68, nearTense: true }, // below the pulse-only +15% bar, within 3%
    { pulse: 66.6, nearTense: false },
    { pulse: 64.5, rmssd: 72, nearTense: true }, // below the backed +10% bar, within 3%
    { pulse: 63.6, rmssd: 72, nearTense: false },
    { pulse: 68, rmssd: 104, nearTense: false } // HRV veto still resets
  ])('uses the active bar for the near-miss band: %o', (o) => {
    expect(evaluateWindow(stream(0, 30, o), full, cfg).nearTense).toBe(o.nearTense)
  })

  it('focused near baseline, full confidence with secondary vitals', () => {
    const res = run(full, checkins({ pulse: 62, breathing: 14.5, rmssd: 88 }))
    expect(res[0]).toMatchObject({ situation: 'focused', confidence: cfg.confidenceFull })
  })

  it('tense needs 2 check-ins of pulse up; an RMSSD drop backs it to full confidence', () => {
    const tense = { pulse: 68, rmssd: 70 }
    const res = run(full, checkins({ pulse: 60, rmssd: 90 }, tense, tense))
    expect(res.map((x) => x.situation)).toEqual(['focused', 'focused', 'tense'])
    expect(last(res).confidence).toBe(cfg.confidenceFull)
  })

  it('pulse alone makes tense, even with normal HRV and breathing present', () => {
    const alone = { pulse: 70 }
    expect(last(run(full, checkins(alone, alone)))).toMatchObject({
      situation: 'tense',
      confidence: cfg.confidencePulseOnly
    })
    const normal = { pulse: 70, breathing: 14, rmssd: 90 }
    expect(last(run(full, checkins(normal, normal)))).toMatchObject({
      situation: 'tense',
      confidence: cfg.confidencePulseOnly
    })
  })

  it('faster breathing (+15%) only adds confidence to tense', () => {
    const tense = { pulse: 70, breathing: 16.2 }
    expect(last(run(full, checkins(tense, tense)))).toMatchObject({
      situation: 'tense',
      confidence: cfg.confidenceFull
    })
  })

  it('RMSSD up 15% or more vetoes tense', () => {
    const relaxed = { pulse: 70, rmssd: 104 }
    expect(run(full, checkins(relaxed, relaxed, relaxed)).map((x) => x.situation)).toEqual([
      'focused',
      'focused',
      'focused'
    ])
    // Just under the veto: tense.
    const almost = { pulse: 70, rmssd: 103 }
    expect(last(run(full, checkins(almost, almost))).situation).toBe('tense')
  })

  it('breathing alone changes nothing', () => {
    for (const breathing of [8, 11, 18, 24]) {
      const o = { pulse: 60, rmssd: 90, breathing }
      expect(run(full, checkins(o, o, o))).toEqual(
        Array(3).fill(expect.objectContaining({ situation: 'focused' }))
      )
    }
  })

  it('tense on a pulse-only stream, with lower confidence', () => {
    const res = run(pulseOnly, checkins({ pulse: 70 }, { pulse: 70 }))
    expect(last(res)).toMatchObject({ situation: 'tense', confidence: cfg.confidencePulseOnly })
  })

  it('continuous mode needs 3+ min of tense', () => {
    const windows = Array.from({ length: 8 }, (_, i) => ({
      at: i * 30_000,
      sec: 30,
      o: { pulse: 70 }
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

  it('low from pulse down; breathing ignored', () => {
    expect(run(full, checkins({ pulse: 54, breathing: 11 }))[0].situation).toBe('low')
    expect(run(full, checkins({ pulse: 54, breathing: 18 }))[0].situation).toBe('low')
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

  it('good needs 10 s of face frames with expressions; without them it is focused', () => {
    const w = (exprSec: number): MetricsSnapshot[] =>
      stream(0, 90, { pulse: 61 }).map((s, i) =>
        i < exprSec ? { ...s, face: { present: true, expressions: { happy: 80 } } } : s
      )
    const c = (snaps: MetricsSnapshot[]): Situation | null =>
      classify([evaluateWindow(snaps, full, cfg)], 'checkins', null, cfg).situation
    expect(c(w(9))).toBe('focused')
    expect(c(w(10))).toBe('good')
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

  it('ignores breathing for a window with talking (it can no longer back tense)', () => {
    const o = { pulse: 70, breathing: 20 }
    expect(last(run(full, checkins(o, o))).confidence).toBe(cfg.confidenceFull)
    const talking = { ...o, face: { talking: true } }
    expect(last(run(full, checkins(talking, talking)))).toMatchObject({
      situation: 'tense',
      confidence: cfg.confidencePulseOnly
    })
  })

  it('a window under 10 s of steady pulse is no read', () => {
    const unstable = stream(0, 90, {}).map((s) => ({ ...s, pulse: r(90, false) }))
    expect(evaluateWindow(unstable, full, cfg).signal).toBe('noread')
    expect(evaluateWindow(stream(0, 9, { pulse: 70 }), full, cfg).signal).toBe('noread')
    expect(evaluateWindow(stream(0, 10, { pulse: 70 }), full, cfg).signal).toBe('tense')
    expect(evaluateWindow([], full, cfg, 5).signal).toBe('noread')
  })

  it('a no-read window between two tense check-ins pauses the hold, not resets it', () => {
    const tense = { pulse: 70 }
    const res = run(pulseOnly, [
      { at: 0, o: tense },
      { at: 5 * MIN, sec: 5, o: tense }, // no read
      { at: 10 * MIN, o: tense }
    ])
    expect(res.map((x) => x.situation)).toEqual(['focused', 'focused', 'tense'])
    // A clear miss in the same place resets.
    const reset = run(pulseOnly, checkins(tense, { pulse: 60 }, tense))
    expect(last(reset).situation).toBe('focused')
  })

  it('no-read windows add no hold time in continuous mode and keep the situation', () => {
    const c = { ...cfg, tenseHoldMin: 2 }
    // A full minute where only the first 5 s had a steady pulse.
    const w = (i: number, pulse: number, steadySec = 60): WindowEval =>
      evaluateWindow(
        stream(i * MIN, 60, { pulse }).map((s, j) =>
          j < steadySec ? s : { ...s, pulse: r(pulse, false) }
        ),
        pulseOnly,
        c
      )
    const history = [w(0, 70), w(1, 70, 5), w(2, 70)]
    // Two qualifying minutes, but the no-read minute in between doesn't count.
    expect(classify(history, 'continuous', 'focused', c).situation).toBe('focused')
    history.push(w(3, 70))
    expect(classify(history, 'continuous', 'focused', c).situation).toBe('tense')
    const before = classify(history, 'continuous', 'tense', c)
    history.push(w(4, 70, 3))
    expect(classify(history, 'continuous', 'tense', c)).toEqual(before)
  })

  it.each([
    { high: 70, near: 68, clear: 60, expected: 'tense' },
    { high: 54, near: 55.8, clear: 60, expected: 'low' }
  ])(
    'pauses $expected holds near the threshold, resets on a clear miss',
    ({ high, near, clear, expected }) => {
      const c = { ...cfg, tenseHoldMin: 2, lowHoldMin: 2 }
      const history = [high, near, high, high].map((pulse, i) =>
        evaluateWindow(stream(i * MIN, 60, { pulse }), pulseOnly, c)!
      )
      expect(classify(history.slice(0, 2), 'continuous', 'focused', c).situation).toBe('focused')
      // Near window did not add a minute: another qualifying window is still needed.
      expect(classify(history.slice(0, 3), 'continuous', 'focused', c).situation).toBe('focused')
      expect(classify(history, 'continuous', 'focused', c).situation).toBe(expected)
      history[1] = evaluateWindow(stream(MIN, 60, { pulse: clear }), pulseOnly, c)!
      expect(classify(history, 'continuous', 'focused', c).situation).toBe('focused')
    }
  )

  it('near windows preserve check-in counts without counting as qualifying check-ins', () => {
    const history = [70, 68, 70].map((pulse, i) =>
      evaluateWindow(stream(i * 5 * MIN, 90, { pulse }), pulseOnly, cfg)!
    )
    expect(classify(history.slice(0, 2), 'checkins', 'focused', cfg).situation).toBe('focused')
    expect(classify(history, 'checkins', 'focused', cfg).situation).toBe('tense')
  })

  it('does not pause a tense hold when secondary vitals clearly contradict it', () => {
    const history = [
      { pulse: 68, rmssd: 70 },
      { pulse: 65.4, rmssd: 104 },
      { pulse: 68, rmssd: 70 }
    ].map((o, i) => evaluateWindow(stream(i * 5 * MIN, 90, o), full, cfg)!)
    expect(classify(history, 'checkins', 'focused', cfg).situation).toBe('focused')
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

describe.each([
  { name: 'normal', c: resolveConfig(), forgetMin: 3 },
  { name: 'demo', c: resolveConfig(sessionConfig.demo.state), forgetMin: 1 }
])('no-read forgetting ($name)', ({ c, forgetMin }) => {
  const window = (signal: WindowEval['signal'], start: number, t: number): WindowEval => ({
    start,
    t,
    signal,
    pulseDelta: signal === 'low' ? -0.1 : 0.16,
    backed: false,
    happyMajority: false,
    negativeMajority: false
  })

  it.each(['tense', 'crashing', 'low'] as const)(
    'forgets %s at the trailing no-read span and stays unknown until a real read',
    (mood) => {
      expect(c.noReadForgetMin).toBe(forgetMin)
      const holdMin =
        mood === 'low' ? c.lowHoldMin : mood === 'crashing' ? c.crashingTenseMin : c.tenseHoldMin
      const read = window(mood === 'low' ? 'low' : 'tense', 0, holdMin * MIN)
      expect(classify([read], 'continuous', null, c).situation).toBe(mood)
      // A long gap since the read must not count toward the no-read span.
      const start = read.t + 20 * MIN
      const history = [read, window('noread', start, start + 10_000)]
      expect(classify(history, 'continuous', mood, c).situation).toBe(mood)
      history.push(window('noread', start + 10_000, start + forgetMin * MIN - 1))
      expect(classify(history, 'continuous', mood, c).situation).toBe(mood)
      history.push(window('noread', start + 20_000, start + forgetMin * MIN))
      const forgotten = classify(history, 'continuous', mood, c)
      expect(forgotten).toEqual({ situation: null, confidence: 0, trend: 'steady' })
      history.push(window('noread', start + 30_000, start + (forgetMin + 1) * MIN))
      expect(classify(history, 'continuous', forgotten.situation, c)).toEqual(forgotten)
      history.push(window('steady', start + (forgetMin + 1) * MIN, start + (forgetMin + 2) * MIN))
      expect(classify(history, 'continuous', null, c).situation).toBe('focused')
    }
  )

  it.each(['focused', 'good'] as const)('keeps %s across prolonged no reads', (mood) => {
    const read = { ...window('steady', 0, MIN), happyMajority: mood === 'good' }
    const history = [read, window('noread', MIN, 20 * MIN)]
    expect(classify(history, 'continuous', mood, c).situation).toBe(mood)
    expect(classify(history, 'checkins', mood, c).situation).toBe(mood)
  })

  it('restarts the no-read span after an intervening real window', () => {
    const history = [
      window('low', 0, c.lowHoldMin * MIN),
      window('noread', 10 * MIN, (10 + forgetMin) * MIN - 1),
      window('unclear', 20 * MIN, 21 * MIN),
      window('noread', 30 * MIN, 30 * MIN + 10_000)
    ]
    expect(classify(history, 'continuous', 'low', c).situation).toBe('low')
  })
})

it('does not forget on one failed check-in after a long camera-off gap, but does on two', () => {
  const read = evaluateWindow(stream(0, 90, { pulse: 54 }), pulseOnly, cfg)
  const history = [read, evaluateWindow(stream(20 * MIN, 90, {}), pulseOnly, cfg)]
  expect(classify(history, 'checkins', 'low', cfg).situation).toBe('low')
  history.push(evaluateWindow(stream(25 * MIN, 90, {}), pulseOnly, cfg))
  expect(classify(history, 'checkins', 'low', cfg).situation).toBeNull()
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
    canUseFace: () => false,
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
        activity: 'focus',
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
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

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

  it('after a failed calibration, builds the baseline from the first 30 s of in-session steady pulse', () => {
    const { engine, ready, updates, phase, wait } = setup()
    phase('calibration', 20, { pulse: 60 })
    expect(ready).toEqual([{ ok: false, reason: 'I only got 20 of 30 s of steady heart rate.' }])
    expect(last(updates).situation).toBeNull()
    // Start anyway: getting to know you until 30 s of steady pulse came in.
    wait(MIN)
    phase('checkin', 20, { pulse: 60 })
    expect(last(updates).situation).toBeNull()
    expect(engine.why()).toEqual({ text: 'Getting to know you', moving: false })
    wait(MIN)
    phase('checkin', 20, { pulse: 60 })
    expect(ready.at(-1)).toEqual({ ok: true })
    expect(last(updates).situation).toBe('focused')
    expect(engine.diagnostics().baselineFailure).toBeNull()
  })

  it('refines pulse from equally weighted calibration and calm-window medians', () => {
    const { engine, phase, wait } = setup()
    phase('calibration', 30, { pulse: 60 })
    phase('checkin', 90, { pulse: 64 }) // median of 60 and 64 is 62, regardless of window length
    wait(10 * MIN)
    phase('checkin', 30, { pulse: 70 }) // +12.9% against 62; +16.7% against original 60
    expect(engine.lastWindow()?.line).toContain('signal=unclear')
    phase('checkin', 30, { pulse: 71.5 }) // +15.3% against 62; +11.7% against 64
    expect(engine.lastWindow()?.line).toContain('signal=tense')
  })

  it.each([
    { o: { pulse: 74 }, probe: 70, signal: 'tense' },
    { o: { pulse: 54 }, probe: 68, signal: 'unclear' },
    { o: { pulse: 57 }, probe: 68, signal: 'unclear' }, // near low, still steady
    { o: { pulse: 68 }, probe: 70, signal: 'tense' }, // near pulse-only tense
    { o: { pulse: 64.5, rmssd: 72 }, probe: 70, signal: 'tense' }, // near backed tense, still steady
    { o: { pulse: 66 }, probe: 70, signal: 'tense' }, // unclear, not calm
    { o: {}, probe: 70, signal: 'tense' } // no read
  ])('never refines from a non-calm window: $o', ({ o, probe, signal }) => {
    const { engine, phase, wait } = setup()
    phase('calibration', 30, { pulse: 60, rmssd: 90 })
    phase('checkin', 30, o)
    wait(10 * MIN)
    phase('checkin', 30, { pulse: probe })
    expect(engine.lastWindow()?.line).toContain(`signal=${signal}`)
  })

  it('never lets a tense stretch become usual before the tense hold completes', () => {
    const { engine, phase, wait, updates } = setup()
    phase('calibration', 30, { pulse: 60 })
    phase('checkin', 30, { pulse: 74 })
    expect(last(updates).situation).toBe('focused') // tense signal, not yet a held situation
    phase('checkin', 30, { pulse: 64 }) // baseline becomes 62, not 64
    wait(10 * MIN)
    phase('checkin', 30, { pulse: 71.5 })
    expect(engine.lastWindow()?.line).toContain('signal=tense')
  })

  it.each([10, sessionConfig.demo.state.baselineRefineMin])(
    'stops pulse refinement exactly %s min after baseline creation',
    (minutes) => {
      overrides = { baselineRefineMin: minutes }
      const { engine, phase, wait } = setup()
      phase('calibration', 30, { pulse: 60 })
      wait(minutes * MIN - 30_000)
      phase('checkin', 30, { pulse: 64 }) // ends exactly at the deadline: no learning
      phase('checkin', 30, { pulse: 70 })
      expect(engine.lastWindow()?.line).toContain('signal=tense')
    }
  )

  it('refines pulse in continuous windows too', () => {
    const { bus, engine, phase, wait } = setup('continuous')
    phase('calibration', 30, { pulse: 60 })
    bus.emit('sdk:checkin-started', { phase: 'continuous' })
    const feed = (sec: number, pulse: number): void => {
      for (let i = 0; i < sec; i++) {
        bus.emit('sdk:metrics', { t: Date.now(), pulse: r(pulse) })
        wait(1000)
      }
    }
    feed(60, 64) // two calm windows: median of 60, 64, 64 is 64
    wait(10 * MIN)
    feed(60, 73.5) // +14.8% against 64, below the pulse-only bar
    expect(engine.lastWindow()?.line).toContain('signal=unclear')
    engine.dispose()
  })

  it('drops pulse refinement samples when the engine resets', () => {
    const { engine, phase, wait } = setup()
    phase('calibration', 30, { pulse: 60 })
    phase('checkin', 30, { pulse: 64 })
    engine.reset()
    phase('calibration', 30, { pulse: 60 })
    wait(10 * MIN)
    phase('checkin', 30, { pulse: 70 })
    expect(engine.lastWindow()?.line).toContain('signal=tense')
  })

  it('keeps the refined pulse fixed after the deadline', () => {
    const { engine, phase, wait } = setup()
    phase('calibration', 30, { pulse: 60 })
    phase('checkin', 30, { pulse: 64 }) // refined to 62
    wait(10 * MIN)
    phase('checkin', 30, { pulse: 66 }) // calm, but too late to learn
    phase('checkin', 30, { pulse: 71.5 })
    expect(engine.lastWindow()?.line).toContain('signal=tense')
  })

  it('starts the refinement clock when a late Start anyway baseline exists', () => {
    const { engine, phase, wait } = setup()
    phase('calibration', 10, { pulse: 60 })
    wait(11 * MIN)
    phase('checkin', 30, { pulse: 60 }) // baseline starts here, not at session start
    phase('checkin', 30, { pulse: 64 })
    wait(10 * MIN)
    phase('checkin', 30, { pulse: 70 })
    expect(engine.lastWindow()?.line).toContain('signal=unclear')
  })

  it('fills missing breathing/HRV from the first 60 s of steady values in focused windows', () => {
    const tenseWithHrv = (): Situation | null => {
      for (let i = 0; i < 2; i++) {
        wait(3.5 * MIN)
        t.phase('checkin', 90, { pulse: 70, rmssd: 70 })
      }
      return last(t.updates).situation
    }
    let t = setup()
    let wait = t.wait
    t.phase('calibration', 90, { pulse: 60 }) // no HRV during calibration
    expect(tenseWithHrv()).toBe('tense')
    expect(last(t.updates).confidence).toBe(cfg.confidencePulseOnly)

    t = setup()
    wait = t.wait
    t.phase('calibration', 90, { pulse: 60 })
    wait(3.5 * MIN)
    t.phase('checkin', 90, { pulse: 60, rmssd: 90 }) // focused: RMSSD baseline filled in
    expect(tenseWithHrv()).toBe('tense')
    expect(last(t.updates).confidence).toBe(cfg.confidenceFull)
  })

  it('a no-read check-in keeps the situation and says so', () => {
    const { engine, updates, phase, wait } = setup()
    phase('calibration', 90, { pulse: 60 })
    for (let i = 0; i < 2; i++) {
      wait(3.5 * MIN)
      phase('checkin', 90, { pulse: 70 })
    }
    expect(last(updates).situation).toBe('tense')
    wait(3.5 * MIN)
    phase('checkin', 90, { face: { present: true } }) // no pulse at all
    expect(last(updates)).toMatchObject({ situation: 'tense', confidence: cfg.confidencePulseOnly })
    expect(engine.why()).toEqual({
      text: "Couldn't see you clearly · no change",
      moving: false
    })
    expect(engine.lastWindow()?.line).toContain('signal=noread')
  })

  it('continuous: a no-read window keeps the situation and pauses the hold', () => {
    overrides = { tenseHoldMin: 2.5 }
    const { bus, engine, updates, phase } = setup('continuous')
    vi.spyOn(privacy, 'canUseFace').mockReturnValue(true)
    phase('calibration', 90, { pulse: 60, face: seatedFace })
    bus.emit('sdk:checkin-started', { phase: 'continuous' })
    const feed = (sec: number, pulse?: number): void => {
      for (let i = 0; i < sec; i++) {
        bus.emit('sdk:metrics', {
          t: Date.now(),
          face: seatedFace,
          ...(pulse ? { pulse: r(pulse) } : {})
        })
        vi.advanceTimersByTime(1000)
      }
    }
    feed(90, 70) // 3 windows: about 1.5 of 2 min of hold
    console.log('DBG', updates.map((u) => u.situation).join(','), engine.lastWindow()?.line)
    feed(60)
    console.log('DBG2', engine.lastWindow()?.line) // seen but no pulse (code 7, motion): no-read windows, hold paused
    expect(last(updates).situation).toBe('focused')
    expect(engine.why()).toEqual({
      text: "Couldn't see you clearly · no change",
      moving: false
    })
    feed(30, 70)
    expect(last(updates).situation).toBe('focused')
    feed(30, 70)
    expect(last(updates).situation).toBe('tense')
    engine.dispose()
  })

  it('diagnostic reads leave calibration, classifier and away outputs identical', () => {
    const runObserved = (
      observe: boolean
    ): { updates: StateUpdate[]; ready: { ok: boolean; reason?: string }[] } => {
      vi.setSystemTime(1_000_000)
      const t = setup('continuous')
      if (observe) t.bus.on('sdk:metrics', () => t.engine.diagnostics())
      t.phase('calibration', 90, { pulse: 60 })
      expect(t.engine.diagnostics()).toMatchObject({
        pulseCount: 90,
        pulseSpanSec: 89,
        baseline: true
      })
      t.bus.emit('sdk:checkin-started', { phase: 'continuous' })
      t.bus.emit('sdk:metrics', { t: Date.now(), pulse: r(60) })
      t.wait(30_000)
      t.bus.emit('sdk:metrics', { t: Date.now(), pulse: r(60) })
      const result = { updates: t.updates, ready: t.ready }
      t.engine.dispose()
      return result
    }
    expect(runObserved(true)).toEqual(runObserved(false))
  })

  it('why line: away countdown in seconds, nothing once away or before a baseline', () => {
    const { bus, engine, phase, wait } = setup('continuous')
    expect(engine.why()).toBeUndefined()
    phase('calibration', 90, { pulse: 60 })
    bus.emit('sdk:checkin-started', { phase: 'continuous' })
    for (let i = 0; i < 40; i++) {
      wait(1000)
      bus.emit('sdk:metrics', { t: Date.now(), pulse: r(60) })
    }
    expect(engine.why()).toEqual({ text: 'Heart rate like when you started', moving: false })
    expect(engine.lastWindow()?.line).toBe(
      'signal=steady rule="near usual" situation=focused why="Heart rate like when you started"'
    )
    wait(8000)
    expect(engine.why()).toMatchObject({ text: "Couldn't see you · away in 12 s", moving: true })
    wait(13_000)
    expect(engine.current().away).toBe(true)
    expect(engine.why()).toBeUndefined()
    engine.dispose()
  })

  it('uses threshold overrides from settings', () => {
    overrides = { tensePulsePct: 0.3 }
    const { updates, phase, wait } = setup()
    phase('calibration', 90, { pulse: 60 })
    for (let i = 0; i < 3; i++) {
      wait(3.5 * MIN)
      phase('checkin', 90, { pulse: 70 })
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

  const seatedFace = { present: true, center: { x: 0.5, y: 0.5 }, size: 0.4 }

  it('stays seated for 10 min with sparse pulse and short landmark gaps', () => {
    const { bus, engine } = setup('continuous')
    vi.spyOn(privacy, 'canUseFace').mockReturnValue(true)
    bus.emit('sdk:checkin-started', { phase: 'continuous' })
    for (let sec = 0; sec < 600; sec++) {
      bus.emit('sdk:metrics', {
        t: Date.now(),
        ...(sec % 3 === 0 ? { pulse: r(60) } : {}),
        face: sec % 10 < 3 ? seatedFace : { present: true }
      })
      vi.advanceTimersByTime(1000)
      expect(engine.current().away).toBe(false)
    }
    expect(engine.current().seatedMinutes).toBeCloseTo(10)
    engine.dispose()
  })

  it('stays present on plausible landmarks alone with brief gaps', () => {
    const { bus, engine } = setup('continuous')
    vi.spyOn(privacy, 'canUseFace').mockReturnValue(true)
    bus.emit('sdk:checkin-started', { phase: 'continuous' })
    for (let sec = 0; sec < 90; sec++) {
      if (sec % 5 === 0) bus.emit('sdk:metrics', { t: Date.now(), face: seatedFace })
      vi.advanceTimersByTime(1000)
      expect(engine.current().away).toBe(false)
    }
    engine.dispose()
  })

  it.each(['ghost face', 'no payloads', 'unstable pulse', 'breathing only', 'validation 1'])(
    'goes away at 20 s without evidence (%s) and wakes immediately on steady pulse',
    (missing) => {
      const { bus, engine } = setup('continuous')
      vi.spyOn(privacy, 'canUseFace').mockReturnValue(true)
      bus.emit('sdk:checkin-started', { phase: 'continuous' })
      bus.emit('sdk:metrics', { t: Date.now(), face: seatedFace })
      if (missing === 'validation 1')
        bus.emit('sdk:validation', { t: Date.now(), code: 1, hint: '' })
      for (let tick = 0; tick < 80; tick++) {
        if (missing !== 'no payloads')
          bus.emit('sdk:metrics', {
            t: Date.now(),
            face: missing === 'validation 1' ? seatedFace : { present: true },
            ...(missing === 'unstable pulse' ? { pulse: r(60, false) } : {}),
            ...(missing === 'validation 1' ? { pulse: r(60) } : {}),
            ...(missing === 'breathing only' ? { breathing: r(14) } : {})
          })
        vi.advanceTimersByTime(250)
        expect(engine.current().away).toBe(tick === 79)
      }
      bus.emit('sdk:validation', { t: Date.now(), code: 0, hint: '' })
      bus.emit('sdk:metrics', { t: Date.now(), pulse: r(60) })
      expect(engine.current().away).toBe(false)
      engine.dispose()
    }
  )

  it.each([
    { center: { x: 0.5, y: 0.5 }, size: 0.1 },
    { center: { x: 0.5, y: 0.5 }, size: 0.9 },
    { center: { x: 0.05, y: 0.5 }, size: 0.4 },
    { center: { x: 0.9, y: 0.5 }, size: 0.4 },
    { center: { x: 0.5, y: 0.5 }, size: 0.15 },
    { center: { x: NaN, y: 0.5 }, size: 0.4 }
  ])('rejects small, offset or implausible faces relative to calibration: %o', (box) => {
    const { bus, engine, phase } = setup('continuous')
    vi.spyOn(privacy, 'canUseFace').mockReturnValue(true)
    phase('calibration', 30, { pulse: 60, face: seatedFace })
    bus.emit('sdk:checkin-started', { phase: 'continuous' })
    for (let sec = 0; sec < 30; sec++) {
      bus.emit('sdk:metrics', { t: Date.now(), face: { present: true, ...box } })
      vi.advanceTimersByTime(1000)
    }
    expect(engine.current().away).toBe(true)
    expect(engine.diagnostics().lastFace).toBeNull()
    engine.dispose()
  })

  it('wakes only after evidence in 3 of the last 4 distinct one-second buckets', () => {
    const { bus, engine } = setup('continuous')
    vi.spyOn(privacy, 'canUseFace').mockReturnValue(true)
    bus.emit('sdk:checkin-started', { phase: 'continuous' })
    vi.advanceTimersByTime(20_000)
    const face = (): void => bus.emit('sdk:metrics', { t: Date.now(), face: seatedFace })
    for (let i = 0; i < 20; i++) face()
    vi.advanceTimersByTime(1000)
    face()
    expect(engine.current().away).toBe(true)
    vi.advanceTimersByTime(4000) // old buckets must expire
    face()
    vi.advanceTimersByTime(1000)
    face()
    expect(engine.current().away).toBe(true)
    vi.advanceTimersByTime(2000) // one missing second is allowed
    face()
    expect(engine.current().away).toBe(false)
    engine.dispose()
  })

  it('code 2 blocks landmark evidence but allows steady pulse, code 1 blocks both', () => {
    const { bus, engine } = setup('continuous')
    vi.spyOn(privacy, 'canUseFace').mockReturnValue(true)
    bus.emit('sdk:checkin-started', { phase: 'continuous' })
    bus.emit('sdk:validation', { t: Date.now(), code: 2, hint: 'Multiple faces' })
    for (let sec = 0; sec < 25; sec++) {
      bus.emit('sdk:metrics', { t: Date.now(), face: seatedFace })
      vi.advanceTimersByTime(1000)
    }
    expect(engine.current().away).toBe(true)
    bus.emit('sdk:metrics', { t: Date.now(), pulse: r(60), face: seatedFace })
    expect(engine.current().away).toBe(false)
    bus.emit('sdk:validation', { t: Date.now(), code: 1, hint: 'No face' })
    const lastFace = engine.diagnostics().lastFace
    vi.advanceTimersByTime(1000)
    bus.emit('sdk:metrics', { t: Date.now(), pulse: r(60), face: seatedFace })
    expect(engine.diagnostics().lastFace).toBe(lastFace)
    engine.dispose()
  })

  it('vitals-only ignores landmarks and camera-off or paused time never triggers away', () => {
    const { bus, engine, phase } = setup()
    phase('calibration', 30, { pulse: 60 })
    vi.advanceTimersByTime(60_000)
    expect(engine.current().away).toBe(false)
    bus.emit('sdk:checkin-started', { phase: 'continuous' })
    for (let sec = 0; sec < 20; sec++) {
      bus.emit('sdk:metrics', { t: Date.now(), face: seatedFace })
      vi.advanceTimersByTime(1000)
    }
    expect(engine.current().away).toBe(true)
    bus.emit('sdk:metrics', { t: Date.now(), pulse: r(60) })
    bus.emit('privacy:camera-paused', {})
    vi.advanceTimersByTime(60_000)
    expect(engine.current().away).toBe(false)
    bus.emit('privacy:camera-resumed', {})
    vi.advanceTimersByTime(19_000) // a short stand/stretch is not away
    expect(engine.current().away).toBe(false)
    bus.emit('sdk:metrics', { t: Date.now(), pulse: r(60) })
    expect(engine.current().away).toBe(false)
    engine.dispose()
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
