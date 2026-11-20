/** Dev diagnostics cadence and window geometry; never used for sensing decisions. */
export const monitorConfig = {
  updateMs: 1000,
  rollingMs: 10_000,
  logEveryMs: 5000,
  /** Main-thread stall watch (Job 32): heartbeat, and how long without one counts as frozen. */
  heartbeatMs: 500,
  stallMs: 3000,
  width: 780,
  height: 760,
  minWidth: 680,
  minHeight: 580
} as const
