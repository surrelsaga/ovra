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
      'Only inside a session you start. A little light circles the moon whenever the camera is on. The app never saves or uploads video.',
    required: true,
    options: [
      {
        value: 'yes',
        label: 'Yes',
        hint: 'Reads heart rate and breathing to fit music and breaks to you'
      },
      {
        value: 'not-now',
        label: 'Not now',
        hint: 'You still get the timer, music and break reminders'
      }
    ]
  },
  {
    key: 'cameraMode',
    legend: 'How often can it look?',
    description: 'The camera turns fully off between checks, so its light goes off too.',
    needsCamera: true,
    options: [
      {
        value: 'checkins',
        label: 'Every few minutes',
        hint: 'About 90 seconds every 5 minutes'
      },
      {
        value: 'continuous',
        label: 'The whole session',
        hint: 'Notices when you leave and come back'
      }
    ]
  },
  {
    key: 'face',
    legend: 'Can it use your expressions too?',
    description:
      'Smiles, frowns and blinks can help explain your heart rate and breathing. They never decide your mood on their own.',
    required: true,
    needsCamera: true,
    options: [
      {
        value: 'vitals-and-face',
        label: 'Heart rate, breathing and expressions',
        hint: 'Blinks, talking and expressions help read your mood'
      },
      {
        value: 'vitals-only',
        label: 'Heart rate and breathing',
        hint: 'Smiles, frowns and blinks are never read'
      }
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
    legend: 'Can Ovra use Last.fm and AI to sort your songs?',
    description:
      'Looks up public song descriptions on Last.fm, then uses AI to guess song energy and mood. Sends only title, artist and public descriptions; never your heart rate, breathing or mood.',
    options: [
      { value: true, label: 'Yes', hint: 'Songs get sorted faster' },
      {
        value: false,
        label: 'No',
        hint: 'Uses the playlist to guess, then learns as songs play'
      }
    ]
  },
  {
    key: 'telemetry',
    legend: 'Share anonymous app reports with Presage?',
    description:
      'Presage makes the camera software. Presage says these reports contain no pictures, readings, or details that identify you or your computer.',
    options: [
      { value: true, label: 'Share' },
      { value: false, label: 'Don’t share' }
    ]
  },
  {
    key: 'autoDelete',
    legend: 'Auto-delete old session history?',
    description: 'What Ovra learned about songs and your settings stay until you clear them.',
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
