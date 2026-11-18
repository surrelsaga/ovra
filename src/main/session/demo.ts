// Demo mode (decision 28): real sensing and thresholds, shorter waits, next-step hints in the bubble.
// Everything here is in memory and lasts one demo session; settings.json is never touched.
import {
  ORB_MOOD,
  type AppSettings,
  type Bus,
  type MoveId,
  type PrivacyService,
  type Situation
} from '@shared/types'
import type { MovesConfig } from '../moves/config'
import type { TargetGap } from '../music/selector'
import type { SensingConfig } from '../sdk/config'
import { sessionConfig, type DemoEvent, type DemoStep } from './config'

const demo = sessionConfig.demo

export interface DemoDeps {
  bus: Bus
  privacy: Pick<PrivacyService, 'getSettings' | 'get'>
  /** The live config objects the modules read on every use; changed in place. */
  overlay: Partial<AppSettings>
  moves: MovesConfig
  musicGap: TargetGap
  sensing: SensingConfig
  /** Labelled reaction previews for a missed mood (music steering, exercise card). */
  music?: { preview(situation: Situation, ms: number): void }
  cards?: { preview(moveId: MoveId, message: string): void }
}

export function bindDemo(deps: DemoDeps): () => void {
  const { bus, overlay, moves, musicGap, sensing } = deps
  let restore: (() => void) | null = null
  let active = false
  let index = -1
  let waiting = false
  const seen = new Set<DemoEvent>()
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
    moves.snoozeMin = demo.snoozeMin
    moves.triggers = { ...moves.triggers, ...demo.triggers }
    moves.returnCheck = { ...moves.returnCheck, durationSec: demo.returnCheckSec }
    Object.assign(musicGap, demo.musicTargetGap, {
      windDownSec: demo.musicWindDownSec,
      switchNow: demo.musicSwitchNow,
      switchAfterSongs: demo.musicSwitchAfterSongs
    })
    Object.assign(sensing, demo.sensing)
    return () => {
      // Keys the overlay didn't have must go, not become undefined (that would hide the stored value).
      delete overlay.thresholdOverrides
      delete overlay.nudgeMinIntervalMin
      Object.assign(overlay, saved.overlay)
      Object.assign(moves, saved.moves)
      delete musicGap.windDownSec
      delete musicGap.switchNow
      delete musicGap.switchAfterSongs
      Object.assign(musicGap, saved.musicGap)
      Object.assign(sensing, saved.sensing)
    }
  }

  function say(text: string): void {
    bus.emit('orb:bubble', { text, ttlMs: demo.hintTtlMs })
  }

  function done(): void {
    waiting = false
    clearTimeout(timer)
    timer = setTimeout(enterNext, demo.doneDelayMs)
  }

  function offerCard(step: DemoStep): void {
    if (step.card) deps.cards?.preview(step.card.move, step.card.text)
  }

  function enterNext(): void {
    const steps: DemoStep[] = demo.steps
    const step = steps[++index]
    if (!active || !step) return
    if (step.goal.some((event) => seen.has(event))) {
      say(step.already ?? step.text)
      return done()
    }
    if (step.noFace && deps.privacy.get().face !== 'vitals-and-face') {
      say(step.noFace)
      return done()
    }
    // Its mood never showed: the same exercise, offered as a labelled preview.
    const unseen = !!step.needs && !seen.has(step.needs)
    say(unseen ? step.unseen! : step.text)
    if (unseen) offerCard(step)
    waiting = step.goal.length > 0
    if (step.limitMs)
      timer = setTimeout(() => {
        if (step.preview) {
          bus.emit('orb:bubble', {
            text: step.fallback!,
            ttlMs: demo.previewMs,
            previewMood: ORB_MOOD[step.preview]
          })
          deps.music?.preview(step.preview, demo.previewMusicMs)
          offerCard(step)
        } else say(step.fallback!)
        done()
      }, step.limitMs)
  }

  function happened(event: DemoEvent): void {
    if (!active) return
    seen.add(event)
    if (index < 0) {
      if (event === 'calibrated') enterNext()
      return
    }
    const step: DemoStep | undefined = demo.steps[index]
    if (waiting && step?.goal.includes(event)) done()
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
      index = -1
      waiting = false
      seen.clear()
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
    bus.on('move:completed', ({ moveId }) => {
      happened('moved')
      if (moveId === 'breathe') happened('settled')
    }),
    bus.on('break:returned', () => happened('returned'))
  ]
  return () => {
    stop()
    offs.forEach((off) => off())
  }
}
