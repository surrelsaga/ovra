// Owner: Agent D (moves). Move library, nudge rules, verification, break and return flow.
import type {
  Bus,
  MetricsSnapshot,
  Move,
  MoveCardView,
  MoveId,
  MovesService,
  Nudge,
  NudgeResponse,
  PrivacyService,
  Session,
  Situation,
  StateUpdate
} from '@shared/types'
import { handle } from '../ipc'
import { MOVES_CONFIG, type MovesConfig } from './config'
import {
  canNudge,
  facePos,
  isBreathingSlowing,
  isStoodUp,
  isTilt,
  pickMove,
  returnResult,
  type FacePos,
  type NudgeInput
} from './logic'

export interface MovesDeps {
  bus: Bus
  privacy: PrivacyService
}

const MIN = 60_000

interface ActiveMove {
  move: Move
  stepIndex: number
  remainingSec: number
  feedback?: string
  stepVerified: boolean
  anyVerified: boolean
  breathingRates: number[]
  tiltSamples: number
  /** Where the face sat before standing up. */
  seatedFace: FacePos | null
}

interface Break {
  since: number
  manual: boolean
  /** The camera saw the user leave (continuous mode). */
  sawAway: boolean
}

/** `cfg` is for the dev harness (shortened durations); the app uses the defaults. */
export function createMoves(deps: MovesDeps, cfg: MovesConfig = MOVES_CONFIG): MovesService {
  const { bus, privacy } = deps

  let session: Session | null = null
  let sensing = false
  let view: MoveCardView = { kind: 'hidden' }
  let nudge: Nudge | null = null
  let lastNudgeAt: number | null = null
  let active: ActiveMove | null = null
  let brk: Break | null = null
  let latestState: StateUpdate | null = null
  let tenseSince: number | null = null
  /** Situation when the break started, for "calmer than before". */
  let beforeBreak: Situation | null = null
  /** Timed (no-sensing) seated clock. */
  let seatedSince = 0
  /** Last seated face position, the reference for the stand-up check. */
  let lastFace: FacePos | null = null
  let nudgeCount = 0

  let ticker: ReturnType<typeof setInterval> | null = null
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let returnCheck: { returnedAt: number; done: boolean } | null = null

  const later = (ms: number, fn: () => void): void => {
    const id = setTimeout(() => {
      timers.delete(id)
      fn()
    }, ms)
    timers.add(id)
  }
  const stopTicker = (): void => {
    if (ticker) clearInterval(ticker)
    ticker = null
  }
  const clearAll = (): void => {
    stopTicker()
    for (const id of timers) clearTimeout(id)
    timers.clear()
  }

  const show = (v: MoveCardView): void => {
    view = v
    bus.emit('move:card', v)
  }
  const showMove = (): void => {
    if (!active) return
    const { move, stepIndex, remainingSec, feedback } = active
    show({ kind: 'move', move, stepIndex, remainingSec, feedback })
  }
  const idle = (): boolean => view.kind === 'hidden'

  // --- Nudges ----------------------------------------------------------------

  const showNudge = (moveId: MoveId, message: string): void => {
    nudge = { id: `nudge-${++nudgeCount}`, moveId, message, t: Date.now() }
    lastNudgeAt = nudge.t
    bus.emit('move:nudge', nudge)
    show({ kind: 'nudge', nudge })
  }

  const maybeNudge = (input: NudgeInput): void => {
    if (!session || !idle()) return
    if (!canNudge(Date.now(), lastNudgeAt, privacy.getSettings().nudgeMinIntervalMin)) return
    const pick = pickMove(input, cfg)
    if (pick) showNudge(pick.moveId, pick.message)
  }

  // --- Guided move -----------------------------------------------------------

  const enterStep = (index: number): void => {
    if (!active) return
    if (index >= active.move.steps.length) return finishMove()
    const step = active.move.steps[index]
    Object.assign(active, {
      stepIndex: index,
      remainingSec: step.durationSec,
      feedback: undefined,
      stepVerified: false,
      tiltSamples: 0
    })
    if (step.check === 'stand-up') active.seatedFace = lastFace
    emitStep()
    stopTicker()
    // Away steps wait for "Okay, going" (or the camera seeing the user leave); no countdown.
    if (step.check === 'away-and-back') return
    ticker = setInterval(() => {
      if (!active) return stopTicker()
      active.remainingSec -= 1
      if (active.remainingSec <= 0) return enterStep(active.stepIndex + 1)
      emitStep()
    }, cfg.tickMs)
  }

  const emitStep = (): void => {
    if (!active) return
    const { move, stepIndex, remainingSec } = active
    bus.emit('move:step', { moveId: move.id, stepIndex, step: move.steps[stepIndex], remainingSec })
    showMove()
  }

  const startMove = (move: Move): void => {
    clearAll()
    nudge = null
    active = {
      move,
      stepIndex: 0,
      remainingSec: 0,
      stepVerified: false,
      anyVerified: false,
      breathingRates: [],
      tiltSamples: 0,
      seatedFace: null
    }
    bus.emit('move:started', { moveId: move.id })
    enterStep(0)
  }

  /** Ends the active move. Leaves the card alone (the caller decides what shows next). */
  const completeMove = (verified: boolean): void => {
    if (!active) return
    stopTicker()
    const { id } = active.move
    active = null
    bus.emit('move:completed', { moveId: id, verified })
    if (cfg.resetsSeatedTime.includes(id)) seatedSince = Date.now()
  }

  const finishMove = (): void => {
    completeMove(active?.anyVerified ?? false)
    show({ kind: 'hidden' })
  }

  const verifyStep = (): void => {
    if (!active || active.stepVerified) return
    const step = active.move.steps[active.stepIndex]
    const message = (cfg.feedback as Record<string, string | undefined>)[step.check]
    active.stepVerified = true
    active.anyVerified = true
    if (!message) return
    active.feedback = message
    bus.emit('move:feedback', { moveId: active.move.id, stepId: step.id, message })
    showMove()
  }

  const onMetrics = (m: MetricsSnapshot): void => {
    const face = privacy.canUseFace() ? m.face : undefined
    if (!active) {
      lastFace = facePos(face) ?? lastFace
      return
    }
    const step = active.move.steps[active.stepIndex]
    const v = cfg.verify
    if (step.check === 'breathing-slows' && m.breathing?.stable) {
      active.breathingRates.push(m.breathing.value)
      if (isBreathingSlowing(active.breathingRates, v.breathingDrop, v.breathingWindow))
        verifyStep()
    } else if (step.check === 'head-tilt-left' || step.check === 'head-tilt-right') {
      if (face?.headRollDeg !== undefined && isTilt(step.check, face.headRollDeg, v.tiltDeg)) {
        active.tiltSamples += 1
        if (active.tiltSamples >= v.tiltSamples) verifyStep()
      }
    } else if (step.check === 'stand-up' && face) {
      if (!active.seatedFace) active.seatedFace = facePos(face)
      else if (isStoodUp(active.seatedFace, face, v)) verifyStep()
    }
  }

  // --- Breaks and the return check -------------------------------------------

  const startBreak = (manual: boolean): void => {
    stopTicker()
    nudge = null
    beforeBreak = latestState?.situation ?? null
    brk = { since: Date.now(), manual, sawAway: !manual }
    bus.emit('break:away', { since: brk.since, manual })
    show({ kind: 'away', since: brk.since, manual })
  }

  const endBreak = (): void => {
    if (!brk) return
    const now = Date.now()
    const { since, sawAway } = brk
    brk = null
    bus.emit('break:returned', { awayMs: now - since })
    if (active) completeMove(active.anyVerified || sawAway)
    seatedSince = now
    startReturnCheck(now)
  }

  const startReturnCheck = (returnedAt: number): void => {
    if (!sensing) return finishReturnCheck(returnedAt)
    returnCheck = { returnedAt, done: false }
    const total = cfg.returnCheck.durationSec
    show({ kind: 'return-check', progress: 0 })
    stopTicker()
    ticker = setInterval(() => {
      if (!returnCheck) return stopTicker()
      const progress = Math.min(1, (Date.now() - returnCheck.returnedAt) / (total * 1000))
      show({ kind: 'return-check', progress })
      if (progress >= 1) stopTicker()
    }, cfg.tickMs)
    later((total + cfg.returnCheck.graceSec) * 1000, () => finishReturnCheck(returnedAt))
  }

  const finishReturnCheck = (returnedAt: number): void => {
    if (returnCheck?.done) return
    if (returnCheck) returnCheck.done = true
    stopTicker()
    const fresh = latestState && latestState.t >= returnedAt ? latestState : null
    const r = returnResult(fresh, beforeBreak, cfg)
    bus.emit('break:return-check', r)
    show({ kind: 'return-result', ...r })
    later(cfg.resultHideSec * 1000, () => {
      if (view.kind === 'return-result') show({ kind: 'hidden' })
    })
  }

  // --- Bus -------------------------------------------------------------------

  bus.on('state:updated', (s) => {
    if (!session) return
    const prev = latestState
    latestState = s
    const upset = s.situation === 'tense' || s.situation === 'crashing'
    tenseSince = upset ? (tenseSince ?? s.t) : null

    if (session.config.cameraMode === 'continuous' && s.away !== (prev?.away ?? false)) {
      if (s.away) {
        if (brk) brk.sawAway = true
        // Don't interrupt a move done at the desk (standing up can hide the face for a while).
        else if (!active || active.move.steps[active.stepIndex].check === 'away-and-back')
          startBreak(false)
      } else if (brk && !brk.manual) endBreak()
      return
    }
    if (s.away || !sensing) return
    maybeNudge({
      situation: s.situation,
      seatedMinutes: s.seatedMinutes,
      tenseMinutes: tenseSince === null ? 0 : (s.t - tenseSince) / MIN
    })
  })

  bus.on('session:tick', () => {
    if (!session || sensing) return
    maybeNudge({
      situation: null,
      seatedMinutes: (Date.now() - seatedSince) / MIN,
      tenseMinutes: 0
    })
  })

  bus.on('sdk:metrics', (m) => {
    if (session) onMetrics(m)
  })

  bus.on('sdk:checkin-ended', ({ phase }) => {
    if (phase !== 'return-check' || !returnCheck || returnCheck.done) return
    const { returnedAt } = returnCheck
    later(cfg.returnCheck.settleMs, () => finishReturnCheck(returnedAt))
  })

  // --- Service ---------------------------------------------------------------

  const reset = (): void => {
    clearAll()
    nudge = null
    active = null
    brk = null
    returnCheck = null
    latestState = null
    tenseSince = null
    lastNudgeAt = null
    lastFace = null
  }

  return {
    respond(nudgeId: string, response: NudgeResponse): void {
      if (!nudge || nudge.id !== nudgeId) return
      const { moveId, message } = nudge
      nudge = null
      if (response === 'go') return startMove(cfg.moves[moveId])
      if (response === 'snooze') {
        bus.emit('move:snoozed', { moveId })
        later(cfg.snoozeMin * MIN, () => {
          if (session && idle()) showNudge(moveId, message)
        })
      } else {
        bus.emit('move:skipped', { moveId })
      }
      show({ kind: 'hidden' })
    },
    endMove(): void {
      if (brk) return endBreak()
      if (active) return finishMove()
      clearAll()
      returnCheck = null
      show({ kind: 'hidden' })
    },
    goingAway(): void {
      if (!session || brk) return
      startBreak(true)
    },
    back: endBreak,
    breatheRound(): void {
      if (!session) return
      returnCheck = null
      startMove(cfg.breatheRound)
    },
    startSession(s: Session): void {
      reset()
      session = s
      sensing = s.sensingEnabled && privacy.canUseCamera()
      seatedSince = Date.now()
      show({ kind: 'hidden' })
    },
    stopSession(): void {
      reset()
      session = null
      show({ kind: 'hidden' })
    }
  }
}

/** Registers move:* and break:* IPC handlers. */
export function registerMovesIpc(moves: MovesService): void {
  handle('move:respond', ({ nudgeId, response }) => moves.respond(nudgeId, response))
  handle('move:end', () => moves.endMove())
  handle('break:going', () => moves.goingAway())
  handle('break:back', () => moves.back())
  handle('break:breathe-round', () => moves.breatheRound())
}
