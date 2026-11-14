import type { Bus, ValidationEvent } from '@shared/types'
import { createValidationSmoother } from '../sdk/hint'
import { windowsConfig } from './config'

/** Only advice from a sustained SDK code; never infer framing from missing vitals. */
export function bindFramingHint(bus: Bus): () => void {
  const cfg = windowsConfig.framing
  const smoother = createValidationSmoother(cfg.persistMs)
  let running = false
  let listening = false
  let paused = false
  let latest: ValidationEvent | null = null
  let since = 0
  let lastHint: number | null = null
  let timer: ReturnType<typeof setInterval> | undefined

  const reset = (): void => {
    smoother.reset()
    clearInterval(timer)
    timer = undefined
  }
  const watch = (): void => {
    reset()
    if (!running || !listening || paused || !latest || !cfg.codes.includes(latest.code)) return
    since = Date.now()
    smoother.push(latest, since)
    timer = setInterval(() => {
      const now = Date.now()
      if (now - since <= cfg.persistMs || (lastHint !== null && now - lastHint < cfg.cooldownMs))
        return
      const event = smoother.poll(now)
      if (!event?.hint.trim()) return
      lastHint = now
      bus.emit('orb:bubble', {
        text: event.hint,
        action: 'show-camera',
        ttlMs: cfg.bubbleTtlMs
      })
      reset()
    }, cfg.pollMs)
  }
  const offs = [
    bus.on('session:started', () => {
      lastHint = null
      latest = null
      paused = false
      running = false
      reset()
    }),
    bus.on('session:status', (session) => {
      const next = session.status === 'running' && session.sensingEnabled
      if (running === next) return
      running = next
      watch()
    }),
    bus.on('session:ended', () => {
      running = false
      latest = null
      reset()
    }),
    bus.on('sdk:checkin-started', () => {
      listening = true
      watch()
    }),
    bus.on('sdk:checkin-ended', () => {
      listening = false
      latest = null
      reset()
    }),
    bus.on('sdk:validation', (event) => {
      if (event.code === latest?.code) return
      latest = event
      watch()
    }),
    bus.on('privacy:camera-paused', () => {
      paused = true
      latest = null
      reset()
    }),
    bus.on('privacy:camera-resumed', () => {
      paused = false
      watch()
    }),
    bus.on('privacy:changed', (privacy) => {
      if (privacy.camera === 'yes') return
      latest = null
      reset()
    })
  ]
  return () => {
    reset()
    offs.forEach((off) => off())
  }
}
