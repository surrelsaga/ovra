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
  it('counts a tense hold in minutes (real) and seconds (demo), with progress', () => {
    const tense = [...seconds(60, [60, 14]), ...seconds(600, [70, 18])]
    const real = run(normal, tense).map((w) => w.text)
    expect(real).toContain('Close to your usual')
    expect(real).toContain('Pulse above your usual · 1 of 3 min')
    const fast = run(demo, tense)
    // A short first window (e.g. right after calibration) shows partial demo progress in seconds.
    const short: WindowEval = {
      start: 0,
      t: 20_000,
      signal: 'tense',
      pulseDelta: 0.15,
      pulseOnly: true,
      happyMajority: false,
      negativeMajority: false
    }
    expect(whyLine([short], 'focused', 'continuous', demo)).toEqual({
      text: 'Pulse above your usual · 20 of 30 s',
      progress: 20 / 30,
      moving: true
    })
    // After tense, it counts toward crashing.
    expect(fast.map((w) => w.text)).toContain('Pulse above your usual · 1 of 2 min')
    expect(
      fast.every((w) => w.progress === undefined || (w.progress >= 0 && w.progress <= 1))
    ).toBe(true)
  })

  it('steady is not moving; a breathing change alone is', () => {
    expect(run(normal, seconds(120, [60, 14])).at(-1)).toEqual({
      text: 'Close to your usual',
      moving: false
    })
    expect(run(normal, seconds(120, [60, 11])).at(-1)).toEqual({
      text: 'Breathing slower than usual',
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
      const rest = text.replace(/\d+(\.\d+)? of \d+(\.\d+)? (s|min|check-ins)/g, '')
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
