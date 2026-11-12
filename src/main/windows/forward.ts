// Owner: Agent E. Bus → renderer forwarding and the orb view. No Electron imports (unit tested).
import {
  ORB_MOOD,
  TARGET_WORD,
  type Bus,
  type IpcPush,
  type IpcPushChannel,
  type MoveCardView,
  type OrbView,
  type Situation,
  type SessionStatus
} from '@shared/types'
import { situationLines, targetLines, windowsConfig as cfg } from './config'

/** What the forwarder needs from the window layer. Faked in tests. */
export interface ShellControl {
  push<C extends IpcPushChannel>(channel: C, payload: IpcPush[C]): void
  showOrb(): void
  hideOrb(): void
  showMain(): void
  setMoveCard(view: MoveCardView): void
}

export interface Forwarder {
  orb(): OrbView
  dispose(): void
}

/**
 * 0 = exhaled, 1 = inhaled. Wall-clock phase (inhale in the first half of `now % period`),
 * the same phase the move card uses, so orb and card stay in sync.
 */
export function breathAt(now: number, periodMs: number = cfg.breathPeriodMs): number {
  return (1 - Math.cos((2 * Math.PI * (now % periodMs)) / periodMs)) / 2
}

export function bindForwarding(bus: Bus, shell: ShellControl): Forwarder {
  let view: OrbView = { mood: 'calm', listening: false, paused: false, away: false }
  let situation: Situation | null = null
  let status: SessionStatus | null = null
  let bubbleTimer: ReturnType<typeof setTimeout> | undefined
  let breathTimer: ReturnType<typeof setInterval> | undefined

  const update = (patch: Partial<OrbView>): void => {
    view = { ...view, ...patch }
    shell.push('push:orb', view)
  }

  const say = (text: string, ttlMs: number = cfg.bubbleTtlMs): void => {
    clearTimeout(bubbleTimer)
    update({ bubble: text })
    bubbleTimer = setTimeout(() => update({ bubble: undefined }), ttlMs)
  }

  const stopBreath = (): void => {
    if (!breathTimer) return
    clearInterval(breathTimer)
    breathTimer = undefined
    update({ breath: undefined })
  }

  const startBreath = (): void => {
    if (breathTimer) return
    update({ breath: breathAt(Date.now()) })
    breathTimer = setInterval(() => update({ breath: breathAt(Date.now()) }), cfg.breathTickMs)
  }

  const endSession = (): void => {
    stopBreath()
    clearTimeout(bubbleTimer)
    situation = null
    view = { mood: 'calm', listening: view.listening, paused: false, away: false }
    shell.push('push:orb', view)
    // Blocked by the window layer while the camera is still on; retried on sdk:checkin-ended.
    shell.hideOrb()
    shell.showMain()
  }

  const offs = [
    bus.on('session:started', (s) => shell.push('push:session', s)),
    bus.on('session:status', (s) => {
      shell.push('push:session', s)
      const prev = status
      status = s.status
      if (s.status === 'running' && prev !== 'running' && prev !== 'on-break') shell.showOrb()
      if (s.status === 'ended' && prev !== 'ended') endSession()
    }),
    bus.on('session:tick', (t) => shell.push('push:session-tick', t)),
    bus.on('session:ended', (summary) => {
      shell.push('push:session-summary', summary)
      if (status !== 'ended') {
        status = 'ended'
        endSession()
      }
    }),
    bus.on('sdk:calibration-progress', (p) => shell.push('push:calibration', p)),
    bus.on('state:updated', (s) => {
      shell.push('push:state', s)
      if (!s.situation) return
      const changed = s.situation !== situation
      situation = s.situation
      if (changed) {
        update({ mood: ORB_MOOD[s.situation] })
        say(situationLines[s.situation])
      }
    }),
    bus.on('music:status', (m) => {
      shell.push('push:music', m)
      if (view.nowPlaying && m.target) {
        update({ nowPlaying: { ...view.nowPlaying, word: TARGET_WORD[m.target] } })
      }
    }),
    bus.on('music:track-changed', (t) => {
      if (t.isAd) return update({ nowPlaying: undefined })
      update({
        nowPlaying: { name: t.name, artist: t.artist, word: view.nowPlaying?.word ?? null }
      })
    }),
    bus.on('music:target-changed', (t) => {
      if (view.nowPlaying) update({ nowPlaying: { ...view.nowPlaying, word: t.word } })
      say(t.reason || targetLines[t.word])
    }),
    bus.on('move:card', (card) => {
      shell.push('push:move-card', card)
      shell.setMoveCard(card)
      if (card.kind !== 'move') stopBreath()
    }),
    bus.on('move:step', (e) => (e.step.animation === 'breathe' ? startBreath() : stopBreath())),
    bus.on('move:completed', stopBreath),
    bus.on('move:skipped', stopBreath),
    bus.on('sdk:checkin-started', () => update({ listening: true })),
    bus.on('sdk:checkin-ended', () => {
      update({ listening: false })
      if (status === 'ended') shell.hideOrb()
    }),
    bus.on('break:away', (b) => update({ away: true, awaySince: b.since })),
    bus.on('break:returned', () => update({ away: false, awaySince: undefined })),
    // Pausing stops the camera, so the ring goes too. A later check-in start still shows it.
    bus.on('privacy:camera-paused', () => update({ paused: true, listening: false })),
    bus.on('privacy:camera-resumed', () => update({ paused: false })),
    bus.on('privacy:changed', (p) => shell.push('push:privacy', p)),
    bus.on('orb:bubble', (b) => say(b.text, b.ttlMs))
  ]

  return {
    orb: () => view,
    dispose: () => {
      offs.forEach((off) => off())
      clearTimeout(bubbleTimer)
      clearInterval(breathTimer)
    }
  }
}
