/// <reference types="vite/client" />
// Owner: Agent A. Tunable numbers for the capture renderer.
export const captureConfig = {
  /** Dev video source canvas size and frame rate (what the SDK sees). */
  width: 1280,
  height: 720,
  fps: 30,
  maxFramingPad: 0.6,
  /**
   * Live camera drawn at this scale inside the canvas, padded at the bottom like the dev video
   * source (decision 7), so the SDK's chest check (code 7) stops blocking pulse. On by default
   * since the live A/B (decision 48). 1 = off (passes the chosen camera stream directly). Breathing is dropped
   * while shrunk. Dev override: RENDERER_VITE_OVRA_LIVE_SCALE=1 npm run dev:monitor
   */
  liveScale: Number(import.meta.env.RENDERER_VITE_OVRA_LIVE_SCALE || 0.8),
  /** Max MetricsSnapshot sends to main per second (the SDK emits ~28/s). */
  maxSendsPerSec: 4,
  /** Coarse in-memory face box; landmarks never leave capture. */
  faceBoxStep: 0.01,
  /** How long to wait for the SDK to report idle after stop(). */
  idleWaitMs: 2000,
  idlePollMs: 50
} as const
