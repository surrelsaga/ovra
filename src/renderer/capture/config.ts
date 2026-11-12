// Owner: Agent A. Tunable numbers for the capture renderer.
export const captureConfig = {
  /** Dev video source canvas size and frame rate (what the SDK sees). */
  width: 1280,
  height: 720,
  fps: 30,
  /** Max MetricsSnapshot sends to main per second (the SDK emits ~28/s). */
  maxSendsPerSec: 4,
  /** How long to wait for the SDK to report idle after stop(). */
  idleWaitMs: 2000
} as const
