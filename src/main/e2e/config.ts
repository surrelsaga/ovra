import { MOVES_CONFIG, type MovesConfig } from '../moves/config'

export const e2eConfig = {
  calibrationMs: 60_000,
  awayCalibrationMs: 100_000,
  checkinMs: 20_000,
  checkinIntervalMs: 25_000,
  returnCheckMs: 20_000,
  deadlineMs: 7 * 60_000,
  eventTimeoutMs: 150_000,
  pollMs: 100,
  idleObservationMs: 1_000,
  sessionLengthMin: 6,
  nudgeIntervalMin: 0.1,
  thresholds: {
    baselineMinPulseSpanSec: 3,
    baselineMinPulseReadings: 3,
    seatedGapSec: 5,
    awayNoFaceSec: 8,
    continuousUpdateSec: 3,
    continuousWindowSec: 20
  }
}

export const e2eMoves: MovesConfig = {
  ...MOVES_CONFIG,
  moves: Object.fromEntries(
    Object.entries(MOVES_CONFIG.moves).map(([id, move]) => [
      id,
      {
        ...move,
        lengthSec: move.steps.length,
        steps: move.steps.map((step) => ({ ...step, durationSec: 1 }))
      }
    ])
  ) as MovesConfig['moves'],
  triggers: {
    ...MOVES_CONFIG.triggers,
    neckSeatedMin: 0.05,
    standSeatedMin: 10,
    walkSeatedMin: 20
  },
  returnCheck: { durationSec: e2eConfig.returnCheckMs / 1000, graceSec: 5, settleMs: 300 },
  resultHideSec: 1
}
