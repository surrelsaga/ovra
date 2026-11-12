// Owner: Agent A. Tunable sensing numbers.
export const sensingConfig = {
  calibrationMs: 90_000,
  checkinMs: 90_000,
  returnCheckMs: 30_000,
  /** A validation code must hold this long before it's emitted / shown as a hint (codes flap 0 ↔ 17). */
  hintPersistMs: 1_500,
  /** How often sdk:calibration-progress is emitted. */
  progressEveryMs: 1_000,
  /** Max wait for the capture renderer to confirm the stream stopped. */
  stopTimeoutMs: 5_000,
  /** Dev/test only: overrides the user's check-in interval (start to start). null = use the user's. */
  checkinIntervalMs: null as number | null
}

export type SensingConfig = typeof sensingConfig

/** Dev harness (`npm run harness:sensing`): short phases so a run per test video stays quick. */
export const harnessConfig = {
  overrides: {
    calibrationMs: 45_000,
    checkinMs: 20_000,
    checkinIntervalMs: 30_000,
    returnCheckMs: 20_000
  } satisfies Partial<SensingConfig>,
  checkins: 2,
  /** Hard stop for the whole run. */
  deadlineMs: 5 * 60_000
}
