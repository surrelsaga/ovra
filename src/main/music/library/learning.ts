// Owner: Agent C (music). Learning from the body: small adjustments on top of base scores.
import type { LearnedAdjustments, Situation } from '@shared/types'
import { musicConfig } from '../config'

export interface PlayObservation {
  /** Situation when the song started. */
  before: Situation | null
  /** Situations reported while it played. */
  during: Situation[]
  listenedMs: number
  /** The app switched away from it (not a user skip). */
  endedByApp: boolean
}

export interface PlayOutcome {
  settle: boolean
  steady: boolean
  quickSkip: boolean
}

export function judgePlay(o: PlayObservation): PlayOutcome {
  const wasTense = o.before === 'tense' || o.before === 'crashing'
  return {
    settle: wasTense && o.during.includes('focused'),
    steady: o.before === 'focused' && o.during.length > 0 && o.during.every((s) => s === 'focused'),
    quickSkip: !o.endedByApp && o.listenedMs < musicConfig.learning.quickSkipMs
  }
}

export function applyOutcome(
  prev: LearnedAdjustments | undefined,
  o: PlayOutcome,
  now: number
): LearnedAdjustments {
  const c = musicConfig.learning
  const l = prev ?? {
    energyDelta: 0,
    confidenceDelta: 0,
    settleVotes: 0,
    steadyVotes: 0,
    quickSkips: 0,
    plays: 0,
    updatedAt: now
  }
  return {
    energyDelta: o.settle
      ? Math.max(c.minEnergyDelta, l.energyDelta - c.energyStep)
      : l.energyDelta,
    confidenceDelta: o.quickSkip
      ? Math.max(c.minConfidenceDelta, l.confidenceDelta - c.confidenceStep)
      : l.confidenceDelta,
    settleVotes: l.settleVotes + (o.settle ? 1 : 0),
    steadyVotes: l.steadyVotes + (o.steady ? 1 : 0),
    quickSkips: l.quickSkips + (o.quickSkip ? 1 : 0),
    plays: l.plays + 1,
    updatedAt: now
  }
}
