// Demo mode (decision 28): real sensing and thresholds, shorter waits, next-step hints in the bubble.
// Everything here is in memory and lasts one demo session; settings.json is never touched.
import type { AppSettings, Bus, PrivacyService, Situation } from '@shared/types'
import type { MovesConfig } from '../moves/config'
import type { TargetGap } from '../music/selector'
import type { SensingConfig } from '../sdk/config'
import { sessionConfig, type DemoEvent, type DemoHint } from './config'

const demo = sessionConfig.demo

export interface DemoDeps {
  bus: Bus
  privacy: Pick<PrivacyService, 'getSettings'>
  /** The live config objects the modules read on every use; changed in place. */
  overlay: Partial<AppSettings>
  moves: MovesConfig
  musicGap: TargetGap
  sensing: SensingConfig
}

/** Next hint step after `event`, searching from `next` so a later event skips ahead. */
export function advanceHint(
  next: number,
  event: DemoEvent,
  hints: DemoHint[] = demo.hints
): { next: number; hint: DemoHint } | null {
  const i = hints.findIndex((h, j) => j >= next && h.after.includes(event))
  return i < 0 ? null : { next: i + 1, hint: hints[i] }
}

export function bindDemo(deps: DemoDeps): () => void {
  const { bus, overlay, moves, musicGap, sensing } = deps
  let restore: (() => void) | null = null
  let active = false
  let next = 0
  let situation: Situation | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  function applyPace(): () => void {
    const saved = {
      overlay: { ...overlay },
      moves: { ...moves },
      musicGap: { ...musicGap },
      sensing: { ...sensing }
    }
    overlay.thresholdOverrides = { ...deps.privacy.getSettings().thresholdOverrides, ...demo.state }
    overlay.nudgeMinIntervalMin = demo.nudgeMinIntervalMin
    moves.triggers = { ...moves.triggers, ...demo.triggers }
    moves.returnCheck = { ...moves.returnCheck, durationSec: demo.returnCheckSec }
    Object.assign(musicGap, demo.musicTargetGap)
    Object.assign(sensing, demo.sensing)
    return () => {
      // Keys the overlay didn't have must go, not become undefined (that would hide the stored value).
      delete overlay.thresholdOverrides
      delete overlay.nudgeMinIntervalMin
      Object.assign(overlay, saved.overlay)
      Object.assign(moves, saved.moves)
      Object.assign(musicGap, saved.musicGap)
      Object.assign(sensing, saved.sensing)
    }
  }

  function happened(event: DemoEvent): void {
    if (!active) return
    const step = advanceHint(next, event)
    if (!step) return
    next = step.next
    clearTimeout(timer)
    if (step.hint.text) bus.emit('orb:bubble', { text: step.hint.text, ttlMs: demo.hintTtlMs })
    if (step.hint.timeoutMs) timer = setTimeout(() => happened('timeout'), step.hint.timeoutMs)
  }

  function stop(): void {
    active = false
    clearTimeout(timer)
    restore?.()
    restore = null
  }

  const offs = [
    bus.on('session:started', (s) => {
      stop()
      next = 0
      situation = null
      active = s.config.demo === true
      if (active) restore = applyPace()
    }),
    bus.on('session:status', (s) => {
      if (s.status === 'ended') stop()
    }),
    bus.on('state:baseline-ready', ({ ok }) => ok && happened('calibrated')),
    bus.on('state:updated', (u) => {
      if (u.away || !u.situation || u.situation === situation) return
      const prev = situation
      situation = u.situation
      if (
        (prev === 'tense' || prev === 'crashing') &&
        (u.situation === 'focused' || u.situation === 'good')
      )
        happened('settled')
      happened(u.situation)
    }),
    bus.on('move:completed', ({ moveId }) => moveId === 'breathe' && happened('settled')),
    bus.on('break:returned', () => happened('returned'))
  ]
  return () => {
    stop()
    offs.forEach((off) => off())
  }
}
