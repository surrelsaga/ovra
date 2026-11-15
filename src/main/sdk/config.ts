// Owner: Agent A. Tunable sensing numbers.
export const sensingConfig = {
  /** Framing check: the calibration clock starts once the SDK's OK code has held this long (or on Skip). */
  framingHoldMs: 3_000,
  /** Hard cap including the framing check and waiting for steady readings. */
  calibrationMaxMs: 180_000,
  checkinMs: 90_000,
  returnCheckMs: 30_000,
  /** A validation code must hold this long before it's emitted / shown as a hint (codes flap 0 ↔ 17). */
  hintPersistMs: 1_500,
  /** How often sdk:calibration-progress is emitted. */
  progressEveryMs: 1_000,
  /** Max wait for the capture renderer to confirm the stream stopped. */
  stopTimeoutMs: 5_000,
  /**
   * SDK crash recovery (decision 48): one restart per entry, waiting this long first. When they run
   * out, sensing gives up and the session carries on without the camera.
   */
  restartBackoffMs: [1_000, 3_000, 5_000],
  /** A stream that has run this long since its last (re)start earns a fresh set of restarts. */
  restartHealthyMs: 60_000,
  /** SDK error codes that mean Presage couldn't be reached: auth, network, server. */
  networkErrorCodes: [2, 5, 6] as number[],
  networkErrorPattern:
    /network|internet|offline|connect|auth|usage verification|timed? ?out|dns|ssl|certificate|firewall/i,
  /** Main-process SDK log line for a dead pipeline (frames dropped because the SDK is in kError). */
  deadPipelinePattern: /not in a valid state/i,
  reconnectingText: 'Camera reconnecting',
  lostMessage: "The camera reading stopped and didn't come back.",
  networkMessage: "Couldn't reach Presage. Check your internet or VPN.",
  /** Dev/test only: overrides the user's check-in interval (start to start). null = use the user's. */
  checkinIntervalMs: null as number | null
}

export type SensingConfig = typeof sensingConfig

/** Dev harness (`npm run harness:sensing`): short phases so a run per test video stays quick. */
export const harnessConfig = {
  overrides: {
    checkinMs: 20_000,
    checkinIntervalMs: 30_000,
    returnCheckMs: 20_000
  } satisfies Partial<SensingConfig>,
  checkins: 2,
  /** Hard stop for the whole run. */
  deadlineMs: 5 * 60_000
}
