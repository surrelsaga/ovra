// Owner: Agent B. Session defaults and timings.
import type { Activity, CameraMode, MoveId, Situation } from '@shared/types'
import { MOVES_CONFIG } from '../moves/config'

const say = MOVES_CONFIG.messages

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
    /**
     * Seated nudges, minutes. Off in demo: step 3 shows the stretch card, so a timed one would repeat it.
     * One-suggestion-per-mood-episode is off too, so demo behaves as before (decision 70).
     */
    triggers: { neckSeatedMin: 999, standSeatedMin: 999, walkSeatedMin: 999, moodEpisodeEndMin: 0 },
    returnCheckSec: 20,
    snoozeMin: 1,
    musicWindDownSec: 120,
    musicSwitchNow: true,
    musicSwitchAfterSongs: { focus: 3, reading: 3, creative: 3, everyday: 3, unwind: 3 },
    hintTtlMs: 25_000,
    /** Missed-mood preview: orb look and its labelled bubble. */
    previewMs: 6_000,
    /** Missed-mood preview: music steers to that mood's target this long, then back. */
    previewMusicMs: 30_000,
    doneDelayMs: 5_000,
    /** Sequential tour; early events are remembered, never used to jump forward. */
    steps: [
      {
        text: 'Demo: 1/9 · Work normally. Steady or its preview shows within about 30 s: a calm blue-white moon.',
        goal: ['focused', 'good'],
        limitMs: 30_000,
        fallback:
          "Demo: 1/9 · Steady didn't show for you. Preview: when you're steady, the moon is calm blue-white and music suits your activity.",
        preview: 'focused',
        already: "Demo: 1/9 · You've seen Steady already. Next step."
      },
      {
        text: 'Demo: 2/9 · Smile for about 20 s (no big laughs). Good mood or its preview shows within about 40 s: a brighter moon.',
        goal: ['good'],
        limitMs: 40_000,
        fallback:
          "Demo: 2/9 · Good mood didn't show for you. Preview: in a good mood, the moon brightens and music plays Keep it going.",
        preview: 'good',
        already: "Demo: 2/9 · You've seen Good mood already. Next step.",
        noFace: 'Demo: 2/9 · Good mood needs face reading, which is off. Skipping.'
      },
      {
        text: "Demo: 3/9 · After a while sitting, Ovra suggests a stretch. Press Let's go on the card and tilt your head with it (about 1½ min).",
        goal: ['moved'],
        limitMs: 100_000,
        card: {
          move: 'neck-stretch',
          text: 'After a while sitting, Ovra suggests this. Want a quick neck stretch?'
        },
        fallback: 'Demo: 3/9 · Moving on. Ovra suggests stretches after a while sitting.',
        already: "Demo: 3/9 · You've done a stretch already. Next step."
      },
      {
        text: 'Demo: 4/9 · Jog in place or do squats for about 40 s, then sit still. Stressed (amber) or its preview shows within about a minute.',
        goal: ['tense', 'crashing'],
        limitMs: 60_000,
        fallback:
          "Demo: 4/9 · Stressed didn't show for you. Preview: when you're stressed, the moon turns amber and music plays Calm down.",
        preview: 'tense',
        already: "Demo: 4/9 · You've seen Stressed already. Next step."
      },
      {
        text: "Demo: 5/9 · Press Let's go on the breathing card. Breathe with the moon (about 1½ min).",
        goal: ['settled'],
        limitMs: 100_000,
        needs: 'tense',
        unseen:
          "Demo: 5/9 · Preview: when you're stressed, Ovra suggests Breathe along. Press Let's go on the card to try it (about 1½ min).",
        card: {
          move: 'breathe',
          text: "Preview: when you're stressed, Ovra suggests this. Want to breathe along for a minute?",
          seen: say.breathe.tense
        },
        fallback:
          'Demo: 5/9 · Moving on. After stress, Ovra goes back to Steady once your heart rate drops.',
        already: "Demo: 5/9 · You've settled already. Next step."
      },
      {
        text: 'Demo: 6/9 · Jog or do squats again for about 40 s, then sit still and frown. Very stressed (red) or its preview shows within about a minute.',
        goal: ['crashing'],
        limitMs: 60_000,
        fallback:
          "Demo: 6/9 · Very stressed didn't show for you. Preview: when you're very stressed, the moon turns red, music fades to Quiet and Ovra suggests a walk.",
        preview: 'crashing',
        card: {
          move: 'walk',
          text: "Preview: when you're very stressed, Ovra suggests this. A short walk might help.",
          seen: say.walk.crashing
        },
        already: "Demo: 6/9 · You've seen Very stressed already. Next step."
      },
      {
        text: 'Demo: 7/9 · Step out of view for 20 s, then come back. Away or its preview shows within about 40 s.',
        goal: ['returned'],
        limitMs: 40_000,
        fallback:
          "Demo: 7/9 · Ovra didn't see you leave. Preview: when you step away, Ovra says it couldn't see you, the moon goes dark and music pauses until you're back.",
        preview: 'away',
        already: "Demo: 7/9 · You've been away and back already. Next step."
      },
      {
        text: 'Demo: 8/9 · Lean back and breathe slowly. Tired (dim moon) or its preview shows within about 45 s.',
        goal: ['low'],
        limitMs: 45_000,
        fallback:
          "Demo: 8/9 · Tired didn't show for you. Preview: when you're tired, the moon dims, music plays Pick me up and Ovra suggests a stretch.",
        preview: 'low',
        card: {
          move: 'stand-stretch',
          text: "Preview: when you're tired, Ovra suggests this. Want to stand and stretch?",
          seen: say['stand-stretch'].low
        },
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
  /** Without this mood seen, the step shows `unseen` and offers `card` as a preview. */
  needs?: DemoEvent
  unseen?: string
  noFace?: string
  /** Fallback previews this mood (orb look, music) or the away look, and `card` if set. */
  preview?: Situation | 'away'
  /**
   * Offered at the step start (no `preview`), else with the preview. `seen` is the real reminder's
   * words, used when the mood did show, so the card still appears over a waiting reminder.
   */
  card?: { move: MoveId; text: string; seen?: string }
}
