// Owner: Agent E. The seven consent questions (PLAN.md §10) and their rules. Used by onboarding and Privacy.
import type { PrivacySettings } from '@shared/types'

export type ConsentKey = Exclude<keyof PrivacySettings, 'answeredAt'>

export interface ConsentQuestion {
  key: ConsentKey
  legend: string
  description: string
  /** No default: the user has to pick. */
  required?: boolean
  /** Only asked when the camera answer is "yes". */
  needsCamera?: boolean
  options: { value: PrivacySettings[ConsentKey]; label: string; hint?: string }[]
}

export const CONSENT_QUESTIONS: ConsentQuestion[] = [
  {
    key: 'camera',
    legend: 'Can Ovra use your camera during sessions you start?',
    description:
      'Only inside a session you start, and the moon shows a ring whenever the camera is on. The app never saves or uploads video.',
    required: true,
    options: [
      {
        value: 'yes',
        label: 'Yes',
        hint: 'Reads pulse (and more if you allow it) to fit music and breaks to you'
      },
      {
        value: 'not-now',
        label: 'Not now',
        hint: 'You still get the timer, music and timed move nudges'
      }
    ]
  },
  {
    key: 'cameraMode',
    legend: 'How often can it look?',
    description: 'Check-ins turn the camera fully off in between, so the camera light goes off.',
    needsCamera: true,
    options: [
      {
        value: 'checkins',
        label: 'Check-ins every few minutes',
        hint: 'About 90 seconds every 5 minutes'
      },
      { value: 'continuous', label: 'The whole session', hint: 'Better break and away detection' }
    ]
  },
  {
    key: 'face',
    legend: 'Can it read your face too?',
    description:
      'Face signals only support what your vitals say. They never decide anything alone.',
    required: true,
    needsCamera: true,
    options: [
      {
        value: 'vitals-and-face',
        label: 'Vitals and face',
        hint: 'Blinks, talking and expressions help read your mood'
      },
      { value: 'vitals-only', label: 'Vitals only', hint: 'Face analysis is never requested' }
    ]
  },
  {
    key: 'music',
    legend: 'Where’s your music?',
    description:
      'Ovra controls the Spotify app on this Mac. No Spotify login needed, free accounts work.',
    options: [
      { value: 'spotify', label: 'Spotify desktop app' },
      { value: 'none', label: 'No music' }
    ]
  },
  {
    key: 'aiScoring',
    legend: 'Can an AI help score your songs?',
    description: 'Sends song titles, artists and public tags only. Never your vitals or mood.',
    options: [
      { value: true, label: 'Yes', hint: 'Songs get sorted faster' },
      {
        value: false,
        label: 'No',
        hint: 'Songs are sorted from public tags, then learned as they play'
      }
    ]
  },
  {
    key: 'telemetry',
    legend: 'Share anonymous diagnostics with Presage?',
    description:
      'Presage makes the sensing SDK. Per Presage, diagnostics hold no frames, no measured values and no user or device IDs.',
    options: [
      { value: true, label: 'Share' },
      { value: false, label: 'Don’t share' }
    ]
  },
  {
    key: 'autoDelete',
    legend: 'Auto-delete old session history?',
    description: 'Song scores and settings stay until you clear them.',
    options: [
      { value: 30, label: '30 days' },
      { value: 90, label: '90 days' },
      { value: 'never', label: 'Never' }
    ]
  }
]

export function isAsked(q: ConsentQuestion, answers: PrivacySettings): boolean {
  return !q.needsCamera || answers.camera === 'yes'
}

/** Must-answer questions that are still unanswered. */
export function missingAnswers(answers: PrivacySettings): ConsentKey[] {
  return CONSENT_QUESTIONS.filter(
    (q) => q.required && isAsked(q, answers) && answers[q.key] === null
  ).map((q) => q.key)
}
