// Owner: Agent D. Move library, nudge triggers and verification thresholds. All starting values; tune here.
import type { Move, MoveCheck, MoveId } from '@shared/types'

export const MOVES: Record<MoveId, Move> = {
  breathe: {
    id: 'breathe',
    name: 'Breathe along',
    lengthSec: 90,
    leavesDesk: false,
    steps: [
      {
        id: 'settle',
        title: 'Settle in',
        howTo: 'Sit back, drop your shoulders, rest your hands.',
        durationSec: 10,
        animation: 'sit',
        check: 'none'
      },
      {
        id: 'breathe',
        title: 'Breathe with the orb',
        howTo: 'Breathe in as the orb grows, out as it shrinks.',
        durationSec: 80,
        animation: 'breathe',
        check: 'breathing-slows'
      }
    ]
  },
  'neck-stretch': {
    id: 'neck-stretch',
    name: 'Neck and shoulder stretch',
    lengthSec: 90,
    leavesDesk: false,
    steps: [
      {
        id: 'tilt-left',
        title: 'Tilt left',
        howTo: 'Ease your left ear toward your left shoulder.',
        durationSec: 25,
        animation: 'neck-left',
        check: 'head-tilt-left'
      },
      {
        id: 'tilt-right',
        title: 'Tilt right',
        howTo: 'Now your right ear toward your right shoulder.',
        durationSec: 25,
        animation: 'neck-right',
        check: 'head-tilt-right'
      },
      {
        id: 'shoulder-rolls',
        title: 'Shoulder rolls',
        howTo: 'Roll both shoulders slowly back, five times.',
        durationSec: 25,
        animation: 'shoulder-roll',
        check: 'none'
      },
      {
        id: 'look-up',
        title: 'Look up',
        howTo: 'Lift your chin gently, then back to centre.',
        durationSec: 15,
        animation: 'look-up',
        check: 'none'
      }
    ]
  },
  'stand-stretch': {
    id: 'stand-stretch',
    name: 'Stand and stretch',
    lengthSec: 120,
    leavesDesk: false,
    steps: [
      {
        id: 'stand',
        title: 'Stand up',
        howTo: 'Push your chair back and stand tall.',
        durationSec: 15,
        animation: 'stand-up',
        check: 'stand-up'
      },
      {
        id: 'reach',
        title: 'Reach up',
        howTo: 'Arms overhead, stretch tall, breathe slowly.',
        durationSec: 35,
        animation: 'reach-up',
        check: 'none'
      },
      {
        id: 'side-bend',
        title: 'Side bend',
        howTo: 'Lean over to one side, then the other.',
        durationSec: 40,
        animation: 'side-bend',
        check: 'none'
      },
      {
        id: 'fold',
        title: 'Soft fold',
        howTo: 'Bend your knees and let your arms hang loose.',
        durationSec: 30,
        animation: 'fold',
        check: 'none'
      }
    ]
  },
  walk: {
    id: 'walk',
    name: 'Walk and get water',
    lengthSec: 300,
    leavesDesk: true,
    steps: [
      {
        id: 'get-up',
        title: 'Get up',
        howTo: 'Stand up and give your legs a shake.',
        durationSec: 10,
        animation: 'stand-up',
        check: 'none'
      },
      {
        id: 'walk',
        title: 'Take a short walk',
        howTo: 'Walk a slow lap and refill your water. About 5 min.',
        durationSec: 290,
        animation: 'walk',
        check: 'away-and-back'
      }
    ]
  },
  'step-outside': {
    id: 'step-outside',
    name: 'Step outside',
    lengthSec: 600,
    leavesDesk: true,
    steps: [
      {
        id: 'get-up',
        title: 'Get up',
        howTo: 'Stand up and stretch your arms.',
        durationSec: 10,
        animation: 'stand-up',
        check: 'none'
      },
      {
        id: 'outside',
        title: 'Get some fresh air',
        howTo: 'Step outside and look far away for a while. About 10 min.',
        durationSec: 590,
        animation: 'outside',
        check: 'away-and-back'
      }
    ]
  }
}

/** The 1 min breathing round offered after a return check that still looks tense. */
export const BREATHE_ROUND: Move = {
  ...MOVES.breathe,
  lengthSec: 60,
  steps: [{ ...MOVES.breathe.steps[1], durationSec: 60 }]
}

export type NudgeReason = 'tense' | 'crashing' | 'low' | 'seated'

export const MOVES_CONFIG = {
  moves: MOVES,
  breatheRound: BREATHE_ROUND,
  /** Nudge triggers (PLAN.md §7). Minutes. */
  triggers: {
    /** Tense for less than this counts as "early" → Breathe along. */
    earlyTenseMaxMin: 5,
    neckSeatedMin: 45,
    standSeatedMin: 60,
    walkSeatedMin: 90,
    /** Tense or crashing for this long → Step outside. */
    stepOutsideTenseMin: 15
  },
  /** "5 more min". */
  snoozeMin: 5,
  /** Countdown tick. */
  tickMs: 1000,
  /** Completing one of these resets the timed (no-sensing) seated clock. */
  resetsSeatedTime: ['stand-stretch', 'walk', 'step-outside'] as MoveId[],
  verify: {
    /** Head roll beyond this (degrees) counts as a tilt. Spike: ±40–50° on a tilt, ±3° at rest. */
    tiltDeg: 20,
    /** Samples beyond the threshold before we say we saw it. */
    tiltSamples: 3,
    /** Breathing rate must drop by this fraction from the start of the move. */
    breathingDrop: 0.1,
    /** Readings averaged at each end of the trend. */
    breathingWindow: 3,
    /** Face centre moving up by this (fraction of frame height) counts as standing. */
    standRise: 0.12,
    /** Face size changing by this fraction counts as standing (stepping back or leaning in). */
    standSizeChange: 0.3
  },
  returnCheck: {
    durationSec: 30,
    /** Wait this long after the return check ends for the state engine's update. */
    settleMs: 2000,
    /** Decide anyway this long after the check should have ended (continuous mode, or no event). */
    graceSec: 10
  },
  /** How long the return result stays on the card. */
  resultHideSec: 20,
  messages: {
    breathe: {
      tense: 'You seem tense. Want to breathe along for a minute?'
    },
    'neck-stretch': {
      tense: 'You seem a bit tense. Want to loosen your neck and shoulders?',
      seated: "You've been sitting a while. Want a quick neck stretch?"
    },
    'stand-stretch': {
      low: 'Energy seems low. Want to stand and stretch?',
      seated: "You've been sitting about an hour. Time to stand and stretch?"
    },
    walk: {
      crashing: 'Things seem intense. A short walk might help.',
      seated: "You've been sitting a long time. Walk and grab some water?"
    },
    'step-outside': {
      tense: "You've seemed tense for a while. Want to step outside for a bit?",
      crashing: "You've seemed tense for a while. Want to step outside for a bit?"
    }
  } satisfies Record<MoveId, Partial<Record<NudgeReason, string>>>,
  feedback: {
    'breathing-slows': 'Your breathing is slowing down',
    'head-tilt-left': 'I can see the tilt',
    'head-tilt-right': 'I can see the tilt',
    'stand-up': 'I can see you standing',
    'away-and-back': 'Welcome back'
  } satisfies Partial<Record<MoveCheck, string>>,
  returnMessages: {
    calmer: "You're calmer than before.",
    settled: "Welcome back. You're looking settled.",
    stillTense: 'Still a bit tense. Want a 1 min breathing round?',
    unknown: 'Welcome back.'
  }
}

export type MovesConfig = typeof MOVES_CONFIG
