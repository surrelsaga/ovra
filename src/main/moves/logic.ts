// Owner: Agent D. Pure rules: which move to suggest, and how to check a step. No timers, no bus.
import type {
  FaceSnapshot,
  MoveCheck,
  MoveId,
  ReturnCheckResult,
  Situation,
  StateUpdate
} from '@shared/types'
import type { MovesConfig, NudgeReason } from './config'

const MIN = 60_000

export interface NudgeInput {
  situation: Situation | null
  seatedMinutes: number
  /** Minutes the user has been tense or crashing without a break in that run (0 if not). */
  tenseMinutes: number
}

/** PLAN.md §7 triggers, first match wins. Null = nothing to suggest. */
export function pickMove(
  input: NudgeInput,
  cfg: MovesConfig
): { moveId: MoveId; reason: NudgeReason; message: string } | null {
  const t = cfg.triggers
  const { situation: s, seatedMinutes: seated, tenseMinutes } = input
  const upset = s === 'tense' || s === 'crashing'
  const pick = (moveId: MoveId, reason: NudgeReason): ReturnType<typeof pickMove> => {
    const messages: Partial<Record<NudgeReason, string>> = cfg.messages[moveId]
    return { moveId, reason, message: messages[reason] ?? '' }
  }

  if (upset && tenseMinutes >= t.stepOutsideTenseMin) return pick('step-outside', s)
  if (s === 'crashing') return pick('walk', 'crashing')
  if (seated >= t.walkSeatedMin) return pick('walk', 'seated')
  if (s === 'tense' && tenseMinutes < t.earlyTenseMaxMin) return pick('breathe', 'tense')
  if (s === 'low') return pick('stand-stretch', 'low')
  if (seated >= t.standSeatedMin) return pick('stand-stretch', 'seated')
  if (s === 'tense') return pick('neck-stretch', 'tense')
  if (seated >= t.neckSeatedMin) return pick('neck-stretch', 'seated')
  return null
}

/** At most one nudge per interval. */
export function canNudge(now: number, lastNudgeAt: number | null, minIntervalMin: number): boolean {
  return lastNudgeAt === null || now - lastNudgeAt >= minIntervalMin * MIN
}

/** True when this head roll matches the asked tilt. Positive roll = right ear down. */
export function isTilt(check: MoveCheck, rollDeg: number, thresholdDeg: number): boolean {
  if (check === 'head-tilt-right') return rollDeg >= thresholdDeg
  if (check === 'head-tilt-left') return rollDeg <= -thresholdDeg
  return false
}

/** Breathing rate trend over a move: the latest readings are at least `drop` below the first ones. */
export function isBreathingSlowing(rates: number[], drop: number, window: number): boolean {
  if (rates.length < window * 2) return false
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
  const first = mean(rates.slice(0, window))
  const last = mean(rates.slice(-window))
  return first > 0 && (first - last) / first >= drop
}

export interface FacePos {
  y: number
  size: number
}

/** Face position from a snapshot, if it has one. */
export function facePos(face: FaceSnapshot | undefined): FacePos | null {
  if (!face?.present || !face.center || face.size === undefined) return null
  return { y: face.center.y, size: face.size }
}

/** Standing up: the face leaves the frame, rises, or changes size a lot compared to the seated spot. */
export function isStoodUp(
  seated: FacePos,
  face: FaceSnapshot,
  v: { standRise: number; standSizeChange: number }
): boolean {
  const now = facePos(face)
  if (!face.present) return true
  if (!now) return false
  return (
    seated.y - now.y >= v.standRise || Math.abs(now.size / seated.size - 1) >= v.standSizeChange
  )
}

/** Return check verdict from the latest state seen after the user came back (null = no data). */
export function returnResult(
  latest: StateUpdate | null,
  before: Situation | null,
  cfg: MovesConfig
): { result: ReturnCheckResult; message: string } {
  const m = cfg.returnMessages
  const s = latest?.away ? null : latest?.situation
  if (s === 'tense' || s === 'crashing') return { result: 'still-tense', message: m.stillTense }
  if (s === 'focused' || s === 'good') {
    const wasUpset = before === 'tense' || before === 'crashing'
    return { result: 'calmer', message: wasUpset ? m.calmer : m.settled }
  }
  return { result: 'unknown', message: m.unknown }
}
