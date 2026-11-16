// Owner: Agent B. Session defaults and timings.
import type { Activity, CameraMode, Situation } from '@shared/types'

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
  /** After the SDK couldn't be restarted, appended to its plain reason. */
  carryOnBubble: 'The session carries on with the timer, music and break reminders.',
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
      baselineSettleMin: 2,
      tenseHoldMin: 0.75,
      lowHoldMin: 1,
      noReadForgetMin: 1,
      crashingTenseMin: 2,
      awayNoFaceSec: 15
    },
    /** Same calibration bar as real mode; only the max wait is shorter. */
    sensing: { calibrationMaxMs: 90_000, returnCheckMs: 20_000 },
    musicTargetGap: { minTargetChangeMs: 20_000 },
    nudgeMinIntervalMin: 1,
    /** Seated nudges, minutes. */
    triggers: { neckSeatedMin: 3, standSeatedMin: 60, walkSeatedMin: 60 },
    returnCheckSec: 20,
    snoozeMin: 1,
    musicWindDownSec: 120,
    musicSwitchNow: true,
    musicSwitchAfterSongs: { focus: 3, reading: 3, creative: 3, everyday: 3, unwind: 3 },
    hintTtlMs: 25_000,
    previewMs: 3_000,
    doneDelayMs: 8_000,
    /** Sequential tour; early events are remembered, never used to jump forward. */
    steps: [
      {
        text: 'Demo: 1/9 · Work normally for a minute. Look for Steady: a calm blue-white moon.',
        goal: ['focused', 'good'],
        limitMs: 90_000,
        fallback: "Demo: 1/9 · Steady didn't show for you. Preview: this is how Steady looks.",
        preview: 'focused',
        already: "Demo: 1/9 · You've seen Steady already. Next step."
      },
      {
        text: 'Demo: 2/9 · Smile for about 20 s (no big laughs). Look for Good mood: a brighter moon.',
        goal: ['good'],
        limitMs: 75_000,
        fallback:
          "Demo: 2/9 · Good mood didn't show for you. Preview: this is how Good mood looks.",
        preview: 'good',
        already: "Demo: 2/9 · You've seen Good mood already. Next step.",
        noFace: 'Demo: 2/9 · Good mood needs face reading, which is off. Skipping.'
      },
      {
        text: "Demo: 3/9 · A stretch card will pop up. Press Let's go and follow it.",
        goal: ['moved'],
        limitMs: 120_000,
        fallback:
          'Demo: 3/9 · No stretch card yet. Reminders come at most once a minute. Moving on.',
        already: "Demo: 3/9 · You've done a stretch already. Next step."
      },
      {
        text: 'Demo: 4/9 · Jog in place or do squats for about 90 s, then sit still and look for Stressed (amber).',
        goal: ['tense', 'crashing'],
        limitMs: 180_000,
        fallback: "Demo: 4/9 · Stressed didn't show for you. Preview: this is how Stressed looks.",
        preview: 'tense',
        already: "Demo: 4/9 · You've seen Stressed already. Next step."
      },
      {
        text: "Demo: 5/9 · Press Let's go on the breathing card. Breathe with the moon.",
        goal: ['settled'],
        limitMs: 150_000,
        needs: 'tense',
        fallback:
          'Demo: 5/9 · Still settling. Ovra goes back to Steady once your heart rate drops.',
        already: "Demo: 5/9 · You've settled already. Next step."
      },
      {
        text: 'Demo: 6/9 · Jog in place or do squats for about 2 min, then sit still and frown. Look for Very stressed (red).',
        goal: ['crashing'],
        limitMs: 195_000,
        fallback:
          "Demo: 6/9 · Very stressed didn't show for you. Preview: this is how Very stressed looks.",
        preview: 'crashing',
        already: "Demo: 6/9 · You've seen Very stressed already. Next step."
      },
      {
        text: 'Demo: 7/9 · Step out of view for 20 s, then come back. Look for the dimmed moon.',
        goal: ['returned'],
        limitMs: 120_000,
        fallback: "Demo: 7/9 · Ovra didn't see you leave. Away needs 15 s out of view. Moving on.",
        already: "Demo: 7/9 · You've been away and back already. Next step."
      },
      {
        text: 'Demo: 8/9 · Lean back and breathe slowly for 2 min. Tired may not appear.',
        goal: ['low'],
        limitMs: 150_000,
        fallback: "Demo: 8/9 · Tired didn't show for you. Preview: this is how Tired looks.",
        preview: 'low',
        already: "Demo: 8/9 · You've seen Tired already: dim moon, Pick me up music."
      },
      { text: "Demo: 9/9 · That's the tour. Press End to see your summary.", goal: [] }
    ] satisfies DemoStep[]
  }
}

export type DemoEvent =
  | 'calibrated'
  | 'focused'
  | 'good'
  | 'moved'
  | 'tense'
  | 'settled'
  | 'crashing'
  | 'returned'
  | 'low'

export interface DemoStep {
  text: string
  goal: DemoEvent[]
  limitMs?: number
  fallback?: string
  already?: string
  needs?: DemoEvent
  noFace?: string
  preview?: Situation
}
