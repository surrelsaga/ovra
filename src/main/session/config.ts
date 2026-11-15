// Owner: Agent B. Session defaults and timings.
import type { Activity, CameraMode } from '@shared/types'

export const sessionConfig = {
  tickMs: 1000,
  maxLengthMin: 12 * 60,
  defaultActivity: 'focus' as Activity,
  defaultCameraMode: 'checkins' as CameraMode,
  /** Default session length per activity, in minutes. */
  activityLengthMin: {
    focus: 60,
    reading: 60,
    creative: 60,
    everyday: 45,
    unwind: 45
  } satisfies Record<Activity, number>,
  bubbleTtlMs: 8000,
  /** "Start anyway" after a failed calibration: the baseline builds from in-session steady pulse. */
  startAnywayBubble: "I'll get to know you as we go. Until then, music follows what you're doing.",
  cameraFailedBubble:
    "The camera didn't start, so this session runs on the timer, music and regular breaks.",
  /**
   * Demo mode (decision 28): the same sensing and thresholds, shorter waits. Applied in memory for a
   * demo session only, never written to settings.json, and put back when the session ends.
   */
  demo: {
    /** State engine keys (timing only; every threshold stays the user's). */
    state: {
      continuousWindowSec: 30,
      continuousUpdateSec: 10,
      baselineRefineMin: 2,
      tenseHoldMin: 0.5,
      lowHoldMin: 0.5,
      crashingTenseMin: 2,
      awayNoFaceSec: 15
    },
    /** Same calibration bar as real mode; only the max wait is shorter. */
    sensing: { calibrationMaxMs: 90_000, returnCheckMs: 20_000 },
    musicTargetGap: { minTargetChangeMs: 20_000 },
    nudgeMinIntervalMin: 1,
    /** Seated nudges, minutes. */
    triggers: { neckSeatedMin: 3, standSeatedMin: 4, walkSeatedMin: 5 },
    returnCheckSec: 20,
    hintTtlMs: 15_000,
    /**
     * Next-step hints in the orb bubble. Each shows once one of `after` really happened; a later
     * event skips ahead. Events: calibrated, focused, good, tense, settled (back to focused/good
     * after tense, or Breathe along done), crashing, returned, low, timeout (`timeoutMs` after the
     * previous hint).
     */
    hints: [
      { after: ['calibrated'], text: 'Demo: work normally for a minute.' },
      { after: ['focused'], text: 'Demo: smile or laugh at something funny.' },
      { after: ['good'], text: 'Demo: try 40 s of squats off camera, then sit down.' },
      // The breathe-along nudge appears by itself.
      { after: ['tense'] },
      { after: ['settled'], text: 'Demo: push harder for about 2 minutes to see crashing out.' },
      { after: ['crashing'], text: 'Demo: step away from the camera for 20 s, then come back.' },
      {
        after: ['returned'],
        text: 'Demo: breathe slowly, about 6 a minute, and blink often. This one may not trigger.',
        timeoutMs: 120_000
      },
      { after: ['low', 'timeout'], text: 'Demo: let the session wind down to see your summary.' }
    ] as DemoHint[]
  }
}

export type DemoEvent =
  | 'calibrated'
  | 'focused'
  | 'good'
  | 'tense'
  | 'settled'
  | 'crashing'
  | 'returned'
  | 'low'
  | 'timeout'

export interface DemoHint {
  after: DemoEvent[]
  text?: string
  /** Fire `timeout` this long after this hint. */
  timeoutMs?: number
}
