// Owner: Agent B. Session defaults and timings.
import type { Activity, CameraMode } from '@shared/types'

export const sessionConfig = {
  tickMs: 1000,
  maxLengthMin: 12 * 60,
  defaultActivity: 'deep-work' as Activity,
  defaultCameraMode: 'checkins' as CameraMode,
  /** Default session length per activity, in minutes. */
  activityLengthMin: {
    'deep-work': 60,
    debugging: 60,
    writing: 60,
    admin: 45,
    downtime: 45
  } satisfies Record<Activity, number>,
  bubbleTtlMs: 8000,
  baselineFailedBubble:
    "I couldn't get a steady read while getting to know you, so this session runs on the timer, music and regular breaks.",
  cameraFailedBubble:
    "The camera didn't start, so this session runs on the timer, music and regular breaks."
}
