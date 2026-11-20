import type { Baseline, MetricsSnapshot, Situation } from '@shared/types'
import { sessionConfig } from '../session/config'
import { classify, evaluateWindow, type WindowEval } from './classifier'
import { resolveConfig, type StateConfig } from './config'
import { describeWindow, whyLine } from './why'

const baseline: Baseline = { pulse: 60, breathing: 14, samples: 30, builtAt: 0 }

/** Continuous run over per-second (pulse, breathing) values; returns every why line. */
function run(
  cfg: StateConfig,
  values: [number, number?][]
): { text: string; moving: boolean; progress?: number }[] {
  const snaps: MetricsSnapshot[] = values.map(([p, b], i) => ({
    t: i * 1000,
    pulse: { value: p, confidence: 90, stable: true },
    ...(b !== undefined && { breathing: { value: b, confidence: 90, stable: true } })
  }))
  const history: WindowEval[] = []
  let situation: Situation | null = 'focused'
  const out: { text: string; moving: boolean; progress?: number }[] = []
  for (
    let t = cfg.continuousUpdateSec * 1000;
    t < snaps.length * 1000;
    t += cfg.continuousUpdateSec * 1000
  ) {
    const ev = evaluateWindow(
      snaps.filter((s) => s.t <= t && s.t >= t - cfg.continuousWindowSec * 1000),
      baseline,
      cfg
    )
    if (ev) history.push(ev)
    situation = classify(history, 'continuous', situation, cfg).situation
    const why = whyLine(history, situation, 'continuous', cfg)
    if (why) out.push(why)
  }
  return out
}

const seconds = (n: number, v: [number, number?]): [number, number?][] => Array(n).fill(v)
const normal = resolveConfig()
const demo = resolveConfig({ ...sessionConfig.demo.state })

describe('why line', () => {
  it('describes unknown checks without calling a short dropout a forgotten mood', () => {
    const read = evaluateWindow(
      Array.from({ length: 30 }, (_, i) => ({
        t: i * 1000,
        pulse: { value: 70, confidence: 90, stable: true }
      })),
      baseline,
      normal
    )
    expect(classify([read], 'continuous', null, normal).situation).toBeNull()
    expect(whyLine([read], null, 'continuous', normal)?.text).toBe(
      'Heart rate higher than when you started · 0 of 3 min'
    )
    const noRead = { ...read, signal: 'noread' as const, start: 30_000, t: 60_000 }
    expect(whyLine([read, noRead], null, 'continuous', normal)?.text).toBe(
      "Couldn't see you clearly · no change"
    )
  })

  it('counts a tense hold in minutes (real) and seconds (demo), with progress', () => {
    const tense = [...seconds(60, [60, 14]), ...seconds(600, [70, 18])]
    const real = run(normal, tense).map((w) => w.text)
    expect(real).toContain('Heart rate like when you started')
    expect(real).toContain('Heart rate higher than when you started · 1 of 3 min')
    const fast = run(demo, tense)
    // A short first window (e.g. right after calibration) shows partial demo progress in seconds.
    const short: WindowEval = {
      start: 0,
      t: 20_000,
      signal: 'tense',
      pulseDelta: 0.15,
      backed: false,
      happyMajority: false,
      negativeMajority: false
    }
    expect(whyLine([short], 'focused', 'continuous', demo)).toEqual({
      text: 'Heart rate higher than when you started · 20 of 45 s',
      progress: 20 / 45,
      moving: true
    })
    // After tense, it counts toward crashing.
    expect(fast.map((w) => w.text)).toContain(
      'Heart rate higher than when you started · 1 of 2 min'
    )
    expect(
      fast.every((w) => w.progress === undefined || (w.progress >= 0 && w.progress <= 1))
    ).toBe(true)
  })

  it('steady is not moving, and a breathing change alone is nothing', () => {
    for (const b of [14, 11, 20])
      expect(run(normal, seconds(120, [60, b])).at(-1)).toEqual({
        text: 'Heart rate like when you started',
        moving: false
      })
  })

  it('a no-read window says so, even mid-hold', () => {
    const w = (signal: WindowEval['signal'], t: number): WindowEval => ({
      start: t - 30_000,
      t,
      signal,
      pulseDelta: signal === 'tense' ? 0.15 : 0,
      backed: false,
      happyMajority: false,
      negativeMajority: false
    })
    const history = [w('tense', 30_000), w('noread', 60_000)]
    for (const situation of ['focused', 'tense', 'low'] as Situation[])
      expect(whyLine(history, situation, 'continuous', normal)).toEqual({
        text: "Couldn't see you clearly · no change",
        moving: false
      })
    expect(describeWindow(history[1])).toBe(
      'signal=noread rule="under the steady-pulse bar, holds paused"'
    )
    // Before any reading (Start anyway), nothing was lost yet.
    expect(whyLine([w('noread', 30_000)], null, 'continuous', normal)?.text).toBe(
      "Couldn't see you clearly · no change"
    )
    // The hold resumes where it was.
    expect(whyLine([...history, w('tense', 90_000)], 'focused', 'continuous', normal)?.text).toBe(
      'Heart rate higher than when you started · 1 of 3 min'
    )
  })

  it.each([normal, demo])('explains a forgotten mood until the next real window', (cfg) => {
    const read: WindowEval = {
      start: 0,
      t: cfg.lowHoldMin * 60_000,
      signal: 'low',
      pulseDelta: -0.1,
      backed: false,
      happyMajority: false,
      negativeMajority: false
    }
    const history = [read]
    let situation = classify(history, 'continuous', null, cfg).situation
    expect(situation).toBe('low')
    for (const extra of [0, 10_000, 120_000]) {
      history.push({
        ...read,
        signal: 'noread',
        start: read.t,
        t: read.t + cfg.noReadForgetMin * 60_000 + extra
      })
      situation = classify(history, 'continuous', situation, cfg).situation
      expect(whyLine(history, situation, 'continuous', cfg)).toEqual({
        text: 'Lost track of you for a bit · checking again',
        moving: false
      })
    }
    history.push({ ...read, signal: 'steady', start: 10 * 60_000, t: 11 * 60_000 })
    situation = classify(history, 'continuous', situation, cfg).situation
    expect(whyLine(history, situation, 'continuous', cfg)?.text).toBe(
      'Heart rate like when you started'
    )
  })

  it.each([normal, demo])('starts the why-line count again after forgetting', (cfg) => {
    const read: WindowEval = {
      start: 0,
      t: cfg.tenseHoldMin * 60_000,
      signal: 'tense',
      pulseDelta: 0.16,
      backed: false,
      happyMajority: false,
      negativeMajority: false
    }
    const gap = {
      ...read,
      signal: 'noread' as const,
      start: read.t,
      t: read.t + cfg.noReadForgetMin * 60_000
    }
    const history = [read, gap, { ...read, start: gap.t, t: gap.t + 10_000 }]
    const situation = classify(history, 'checkins', null, cfg).situation
    expect(situation).toBeNull()
    expect(whyLine(history, situation, 'checkins', cfg)).toEqual({
      text: 'Heart rate higher than when you started · 1 of 2 checks',
      progress: 0.5,
      moving: true
    })
  })

  it('never shows a number that could be a vital: only seconds, minutes and step counts', () => {
    const lines = [
      ...run(normal, [
        ...seconds(60, [60, 14]),
        ...seconds(900, [75, 20]),
        ...seconds(300, [62, 14])
      ]),
      ...run(demo, [...seconds(60, [60, 14]), ...seconds(300, [52, 11]), ...seconds(120, [66])]),
      ...run(demo, seconds(200, [64, 14]))
    ].map((w) => w.text)
    expect(lines.length).toBeGreaterThan(20)
    for (const text of lines) {
      const rest = text.replace(/\d+(\.\d+)? of \d+(\.\d+)? (s|min|checks)/g, '')
      expect(rest, text).not.toMatch(/\d/)
    }
  })

  it('monitor line names the signal and rule without values', () => {
    const ev = evaluateWindow(
      seconds(30, [70]).map(([p], i) => ({
        t: i * 1000,
        pulse: { value: p, confidence: 90, stable: true }
      })),
      baseline,
      normal
    )!
    expect(describeWindow(ev)).toBe('signal=tense rule="pulse up, pulse only"')
  })
})
