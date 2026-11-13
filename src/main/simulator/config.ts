// Dev simulator: tunable numbers. Dev builds only. Nothing here changes shipped defaults.
import type { Expression, SimScenario } from '@shared/types'
import { MOVES_CONFIG, type MovesConfig } from '../moves/config'
import { sensingConfig } from '../sdk/config'
import { e2eConfig } from '../e2e/config'

export interface SimTiming {
  calibrationMs: number
  checkinMs: number
  /** Start to start. Null = the session's chosen interval. */
  checkinIntervalMs: number | null
  returnCheckMs: number
}

export interface ScenarioProfile {
  /** Multipliers on the calm baseline. */
  pulse: number
  breathing: number
  rmssd: number
  /** One blink every N samples. */
  blinkEvery: number
  expressions: Partial<Record<Expression, number>>
}

const calm: ScenarioProfile = {
  pulse: 1,
  breathing: 1,
  rmssd: 1,
  blinkEvery: 13,
  expressions: { neutral: 80, happy: 10 }
}

export const simConfig = {
  /** ~3 snapshots a second while a phase runs. */
  sampleMs: 300,
  /** Calm baseline values. Never stored; synthetic only. */
  baseline: { pulse: 68, breathing: 14, rmssd: 60, baevsky: 120 },
  /** Wobble on every reading, fraction of the value. */
  noise: 0.01,
  profiles: {
    calm,
    tense: { ...calm, pulse: 1.15, rmssd: 0.75, expressions: { neutral: 70, angry: 15 } },
    crashing: { ...calm, pulse: 1.25, rmssd: 0.75, expressions: { angry: 70, neutral: 20 } },
    low: {
      ...calm,
      pulse: 0.88,
      breathing: 0.8,
      blinkEvery: 5,
      expressions: { neutral: 75, sad: 15 }
    },
    good: { ...calm, expressions: { happy: 75, neutral: 20 } }
  } satisfies Record<Exclude<SimScenario, 'away'>, ScenarioProfile>,
  face: { center: { x: 0.5, y: 0.52 }, size: 0.3 },
  actions: {
    durationMs: 8_000,
    tiltDeg: 30,
    standCenterY: 0.32,
    standSize: 0.22,
    /** Breathing ends this far below where it started, ramped over the action. */
    breathingDrop: 0.3
  },

  fast: {
    timing: {
      calibrationMs: 10_000,
      checkinMs: 15_000,
      checkinIntervalMs: 30_000,
      returnCheckMs: 10_000
    } satisfies SimTiming,
    nudgeMinIntervalMin: 0.5,
    /** Merged over the user's own overrides while fast mode is on. */
    thresholds: {
      ...e2eConfig.thresholds,
      blinkMinWindowSec: 5,
      tenseHoldCheckins: 1,
      tenseHoldMin: 0.25,
      lowHoldCheckins: 1,
      lowHoldMin: 0.25,
      crashingTenseMin: 3
    },
    triggers: {
      ...MOVES_CONFIG.triggers,
      earlyTenseMaxMin: 1,
      neckSeatedMin: 3,
      standSeatedMin: 6,
      walkSeatedMin: 10,
      stepOutsideTenseMin: 4
    },
    maxStepSec: 15,
    resultHideSec: 10
  },
  normalTiming: {
    calibrationMs: sensingConfig.calibrationMs,
    checkinMs: sensingConfig.checkinMs,
    checkinIntervalMs: null,
    returnCheckMs: sensingConfig.returnCheckMs
  } satisfies SimTiming,

  /**
   * Set as devVideoSource while simulating so the calibration screen never opens the live camera
   * for its preview (it loads this missing file instead and says the preview isn't available).
   */
  noCameraVideo: '/ovra-simulator-no-camera'
}

const shorten = <T extends { durationSec: number }>(steps: T[]): T[] =>
  steps.map((s) => ({ ...s, durationSec: Math.min(s.durationSec, simConfig.fast.maxStepSec) }))
const shortMove = <M extends MovesConfig['breatheRound']>(m: M): M => {
  const steps = shorten(m.steps)
  return { ...m, steps, lengthSec: steps.reduce((sum, s) => sum + s.durationSec, 0) }
}

/** Moves config for fast mode: short steps, seated triggers and return check. */
export const fastMovesConfig: MovesConfig = {
  ...MOVES_CONFIG,
  moves: Object.fromEntries(
    Object.entries(MOVES_CONFIG.moves).map(([id, m]) => [id, shortMove(m)])
  ) as MovesConfig['moves'],
  breatheRound: shortMove(MOVES_CONFIG.breatheRound),
  triggers: simConfig.fast.triggers,
  returnCheck: {
    ...MOVES_CONFIG.returnCheck,
    durationSec: simConfig.fast.timing.returnCheckMs / 1000,
    graceSec: 3,
    settleMs: 300
  },
  resultHideSec: simConfig.fast.resultHideSec
}
