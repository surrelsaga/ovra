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
  type TargetWord,
  type Session,
  type PrivacyService,
  type SessionStatus
} from '@shared/types'
import { situationLines, targetLines, windowsConfig as cfg } from './config'
import { bindFramingHint } from './framing'
import { SPOTIFY_CLOSED_HINT, SPOTIFY_HINT } from '../music/config'

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
  snapshot(send: <C extends IpcPushChannel>(channel: C, payload: IpcPush[C]) => void): void
  dispose(): void
}

/**
 * 0 = exhaled, 1 = inhaled. Wall-clock phase (inhale in the first half of `now % period`),
 * the same phase the move card uses, so orb and card stay in sync.
 */
export function breathAt(now: number, periodMs: number = cfg.breathPeriodMs): number {
  return (1 - Math.cos((2 * Math.PI * (now % periodMs)) / periodMs)) / 2
}

export function bindForwarding(
  bus: Bus,
  shell: ShellControl,
  privacy?: Pick<PrivacyService, 'getSettings' | 'setSettings'>,
  why?: () => OrbView['why']
): Forwarder {
  let view: OrbView = { mood: 'calm', listening: false, paused: false, away: false }
  const latest = new Map<IpcPushChannel, IpcPush[IpcPushChannel]>()
  const send = <C extends IpcPushChannel>(channel: C, payload: IpcPush[C]): void => {
    latest.set(channel, payload)
    shell.push(channel, payload)
  }
  let situation: Situation | null = null
  let targetWord: TargetWord | null = null
  let status: SessionStatus | null = null
  let session: Session | null = null
  let nextCheckAt: number | undefined
  let teachCount = privacy?.getSettings().cameraTeachCount ?? cfg.cameraTeachLimit
  let teachOff = false
  let teachingUntil = 0
  let bubbleTimer: ReturnType<typeof setTimeout> | undefined
  let breathTimer: ReturnType<typeof setInterval> | undefined
  let whyTimer: ReturnType<typeof setInterval> | undefined
  /** Advice waiting for a free bubble; interrupted demo hints may be shown again. */
  let pendingHint:
    | {
        text: string
        ttlMs: number
        action?: OrbView['bubbleAction']
        previewMood?: OrbView['previewMood']
      }
    | undefined
  let shownTtlMs = 0
  let pendingSpotify: string | undefined

  const update = (patch: Partial<OrbView>): void => {
    view = { ...view, ...patch }
    send('push:orb', view)
  }

  const isHint = (text: string | undefined): text is string =>
    !!text?.startsWith(cfg.demoHintPrefix)
  const isSpotifyHint = (text: string | undefined): boolean =>
    text === SPOTIFY_HINT || text === SPOTIFY_CLOSED_HINT

  const showSpotifyHint = (): boolean => {
    if (
      !pendingSpotify ||
      (status !== 'running' && !(status === 'calibrating' && view.listening)) ||
      view.bubble
    )
      return false
    const text = pendingSpotify
    pendingSpotify = undefined
    say(text)
    return true
  }

  const say = (
    text: string,
    ttlMs: number = cfg.bubbleTtlMs,
    teaching = false,
    action?: OrbView['bubbleAction'],
    previewMood?: OrbView['previewMood']
  ): void => {
    if (!teaching && Date.now() < teachingUntil) {
      if (isHint(text) || action) pendingHint = { text, ttlMs, action, previewMood }
      return
    }
    if (teaching) teachingUntil = Date.now() + ttlMs
    if (isHint(view.bubble) && !isHint(text) && !pendingHint?.action)
      pendingHint = {
        text: view.bubble,
        ttlMs: shownTtlMs,
        action: view.bubbleAction,
        previewMood: view.previewMood
      }
    clearTimeout(bubbleTimer)
    shownTtlMs = ttlMs
    update({ bubble: text, bubbleAction: action, previewMood: view.demo ? previewMood : undefined })
    bubbleTimer = setTimeout(() => {
      update({ bubble: undefined, bubbleAction: undefined, previewMood: undefined })
      if (showSpotifyHint()) return
      const hint = pendingHint
      pendingHint = undefined
      if (hint) say(hint.text, hint.ttlMs, false, hint.action, hint.previewMood)
    }, ttlMs)
  }

  const refreshWhy = (): void => {
    const next = why?.()
    if (JSON.stringify(next) !== JSON.stringify(view.why)) update({ why: next })
  }

  const nextCheck = (): number | undefined =>
    session?.sensingEnabled &&
    session.config.cameraMode === 'checkins' &&
    status === 'running' &&
    !view.paused &&
    !view.away
      ? nextCheckAt
      : undefined

  const intervalMs = (): number => (session?.config.checkinIntervalMin ?? 0) * 60_000

  const cameraOff = (): void => {
    const wasOn = view.listening
    update({ listening: false, calibration: undefined, nextCheckAt: nextCheck() })
    if (wasOn && teachOff) {
      say('Camera off.', cfg.bubbleTtlMs, true)
      teachOff = false
    }
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
    clearInterval(whyTimer)
    whyTimer = undefined
    pendingHint = undefined
    pendingSpotify = undefined
    situation = null
    targetWord = null
    teachingUntil = 0
    nextCheckAt = undefined
    view = { mood: 'calm', listening: view.listening, paused: false, away: false }
    send('push:orb', view)
    // Blocked by the window layer while the camera is still on; retried on sdk:checkin-ended.
    shell.hideOrb()
    shell.showMain()
  }

  const offs = [
    bus.on('session:started', (s) => {
      send('push:session', s)
      pendingHint = undefined
      update({ demo: s.config.demo || undefined, previewMood: undefined })
      clearInterval(whyTimer)
      if (why) whyTimer = setInterval(refreshWhy, cfg.whyTickMs)
    }),
    bus.on('session:status', (s) => {
      send('push:session', s)
      const prev = status
      status = s.status
      session = s
      if (s.status === 'running' && (prev === 'calibrating' || prev === 'on-break')) {
        nextCheckAt = Date.now() + intervalMs()
      }
      if (!view.listening && (view.nextCheckAt !== undefined || nextCheck() !== undefined)) {
        update({ nextCheckAt: nextCheck() })
      }
      if (s.status === 'running' && prev !== 'running' && prev !== 'on-break') shell.showOrb()
      if (s.status === 'running') showSpotifyHint()
      if (s.status === 'ended' && prev !== 'ended') endSession()
    }),
    bus.on('session:tick', (t) => send('push:session-tick', t)),
    bus.on('session:ended', (summary) => {
      send('push:session-summary', summary)
      if (status !== 'ended') {
        status = 'ended'
        endSession()
      }
    }),
    bus.on('sdk:calibration-progress', (p) => {
      send('push:calibration', p)
      if (view.calibration !== undefined) update({ calibration: p.progress })
    }),
    bus.on('state:updated', (s) => {
      send('push:state', s)
      refreshWhy()
      if (!s.situation) return
      const changed = s.situation !== situation
      situation = s.situation
      if (changed) {
        update({ mood: ORB_MOOD[s.situation] })
        say(situationLines[s.situation])
      }
    }),
    bus.on('music:status', (m) => {
      send('push:music', m)
      if (m.available) {
        pendingSpotify = undefined
        if (isSpotifyHint(view.bubble)) {
          clearTimeout(bubbleTimer)
          update({ bubble: undefined, bubbleAction: undefined, previewMood: undefined })
          const hint = pendingHint
          pendingHint = undefined
          if (hint) say(hint.text, hint.ttlMs, false, hint.action, hint.previewMood)
        }
      }
      targetWord = m.target ? TARGET_WORD[m.target] : null
      if (m.nowPlaying && !m.nowPlaying.isAd) {
        update({
          nowPlaying: { name: m.nowPlaying.name, artist: m.nowPlaying.artist, word: targetWord }
        })
      } else if (view.nowPlaying) update({ nowPlaying: undefined })
    }),
    bus.on('music:track-changed', (t) => {
      if (t.isAd) return update({ nowPlaying: undefined })
      update({ nowPlaying: { name: t.name, artist: t.artist, word: targetWord } })
    }),
    bus.on('music:target-changed', (t) => {
      targetWord = t.word
      if (view.nowPlaying) update({ nowPlaying: { ...view.nowPlaying, word: t.word } })
      say(t.reason || targetLines[t.word])
    }),
    bus.on('move:card', (card) => {
      send('push:move-card', card)
      shell.setMoveCard(card)
      if (card.kind !== 'move') stopBreath()
    }),
    bus.on('move:step', (e) => (e.step.animation === 'breathe' ? startBreath() : stopBreath())),
    bus.on('move:completed', stopBreath),
    bus.on('move:skipped', stopBreath),
    bus.on('sdk:checkin-started', ({ phase }) => {
      const turningOn = !view.listening
      if (phase === 'checkin') nextCheckAt = Date.now() + intervalMs()
      update({
        listening: true,
        calibration: phase === 'calibration' ? 0 : undefined,
        nextCheckAt: undefined
      })
      if (turningOn) {
        teachOff = teachCount < cfg.cameraTeachLimit
        if (!teachOff && Date.now() < teachingUntil) {
          clearTimeout(bubbleTimer)
          teachingUntil = 0
          update({ bubble: undefined, bubbleAction: undefined, previewMood: undefined })
        }
        if (teachOff) {
          teachCount++
          void privacy
            ?.setSettings({ cameraTeachCount: teachCount })
            .catch(() => console.warn('windows: could not save camera teaching count'))
          say('Camera on. See the little light circling me?', cfg.bubbleTtlMs, true)
        }
      }
      shell.showOrb()
      if (status === 'calibrating') shell.showMain()
      showSpotifyHint()
    }),
    bus.on('sdk:checkin-ended', ({ phase }) => {
      if (phase === 'calibration' || phase === 'return-check')
        nextCheckAt = Date.now() + intervalMs()
      cameraOff()
      if (status === 'ended') shell.hideOrb()
    }),
    bus.on('break:away', (b) => update({ away: true, awaySince: b.since, nextCheckAt: undefined })),
    bus.on('break:returned', () => update({ away: false, awaySince: undefined })),
    // Pausing stops the camera, so the satellite goes too. A later check-in start still shows it.
    bus.on('privacy:camera-paused', () => {
      update({ paused: true })
      cameraOff()
    }),
    bus.on('privacy:camera-resumed', () => {
      update({ paused: false })
      update({ nextCheckAt: nextCheck() })
    }),
    bus.on('privacy:changed', (p) => send('push:privacy', p)),
    bus.on('orb:bubble', (b) => {
      // Wait for the orb and camera teaching so the only Spotify notice isn't lost.
      if (isSpotifyHint(b.text)) {
        pendingSpotify = b.text
        showSpotifyHint()
        return
      }
      // A demo hint never interrupts another bubble; it waits for it to clear.
      if ((isHint(b.text) || b.action) && view.bubble)
        pendingHint = {
          text: b.text,
          ttlMs: b.ttlMs ?? cfg.bubbleTtlMs,
          action: b.action,
          previewMood: view.demo ? b.previewMood : undefined
        }
      else say(b.text, b.ttlMs, false, b.action, b.previewMood)
    })
  ]
  const stopFraming = bindFramingHint(bus)

  return {
    orb: () => view,
    snapshot: (send) => {
      for (const [channel, payload] of latest) send(channel, payload)
      send('push:orb', view)
    },
    dispose: () => {
      stopFraming()
      offs.forEach((off) => off())
      clearTimeout(bubbleTimer)
      clearInterval(breathTimer)
      clearInterval(whyTimer)
    }
  }
}
