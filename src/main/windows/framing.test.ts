import { createBus } from '../bus'
import type { Session } from '@shared/types'
import { windowsConfig } from './config'
import { bindForwarding } from './forward'

const cfg = windowsConfig.framing
const session = (status: Session['status']): Session => ({
  id: 's1',
  startedAt: 0,
  status,
  sensingEnabled: true,
  config: {
    activity: 'focus',
    lengthMin: 60,
    cameraMode: 'continuous',
    checkinIntervalMin: 5,
    music: false
  }
})

function setup(): { bus: ReturnType<typeof createBus>; hints: unknown[]; dispose: () => void } {
  vi.useFakeTimers()
  const bus = createBus()
  const hints: unknown[] = []
  bus.on('orb:bubble', (hint) => hints.push(hint))
  const forwarder = bindForwarding(bus, {
    push: () => undefined,
    showMain: () => undefined,
    showOrb: () => undefined,
    hideOrb: () => undefined,
    setMoveCard: () => undefined
  })
  bus.emit('session:started', session('running'))
  bus.emit('session:status', session('running'))
  bus.emit('sdk:checkin-started', { phase: 'checkin' })
  return { bus, hints, dispose: () => forwarder.dispose() }
}
const validation = (bus: ReturnType<typeof createBus>, code: number): void =>
  bus.emit('sdk:validation', { t: Date.now(), code, hint: `SDK advice ${code}` })
const persist = (): void => {
  vi.advanceTimersByTime(cfg.persistMs + cfg.pollMs)
}

afterEach(() => vi.useRealTimers())

it.each(cfg.codes)('shows the SDK advice for sustained code %s, once per episode', (code) => {
  const { bus, hints, dispose } = setup()
  validation(bus, code)
  vi.advanceTimersByTime(cfg.persistMs)
  expect(hints).toEqual([])
  vi.advanceTimersByTime(cfg.pollMs)
  expect(hints).toEqual([
    { text: `SDK advice ${code}`, action: 'show-camera', ttlMs: cfg.bubbleTtlMs }
  ])
  validation(bus, code)
  vi.advanceTimersByTime(cfg.cooldownMs * 2)
  expect(hints).toHaveLength(1)
  dispose()
  expect(vi.getTimerCount()).toBe(0)
})

it('restarts the hold when the code changes and excludes other validation codes', () => {
  const { bus, hints, dispose } = setup()
  validation(bus, 7)
  vi.advanceTimersByTime(cfg.persistMs)
  validation(bus, 12)
  vi.advanceTimersByTime(cfg.persistMs)
  expect(hints).toHaveLength(0)
  validation(bus, 1)
  persist()
  expect(hints).toHaveLength(0)
  validation(bus, 7)
  persist()
  expect(hints).toHaveLength(1)
  dispose()
})

it('applies the cooldown across different codes, then allows the still-persistent advice', () => {
  const { bus, hints, dispose } = setup()
  validation(bus, 7)
  persist()
  validation(bus, 12)
  persist()
  expect(hints).toHaveLength(1)
  vi.advanceTimersByTime(cfg.cooldownMs)
  expect(hints).toHaveLength(2)
  dispose()
})

it('does not count calibration, user pause, camera-off gaps or an ended session', () => {
  const { bus, hints, dispose } = setup()
  bus.emit('session:status', session('calibrating'))
  validation(bus, 7)
  persist()
  expect(hints).toHaveLength(0)
  bus.emit('session:status', session('running'))
  vi.advanceTimersByTime(cfg.persistMs)
  bus.emit('privacy:camera-paused', {})
  persist()
  expect(hints).toHaveLength(0)
  bus.emit('privacy:camera-resumed', {})
  validation(bus, 7)
  vi.advanceTimersByTime(cfg.persistMs)
  bus.emit('sdk:checkin-ended', { phase: 'checkin' })
  persist()
  expect(hints).toHaveLength(0)
  bus.emit('sdk:checkin-started', { phase: 'checkin' })
  validation(bus, 7)
  vi.advanceTimersByTime(cfg.persistMs)
  bus.emit('session:status', session('ended'))
  persist()
  expect(hints).toHaveLength(0)
  dispose()
})

it('queues framing advice, never replays an interrupted action, and clears it with the text', () => {
  vi.useFakeTimers()
  const bus = createBus()
  const fw = bindForwarding(bus, {
    push: () => undefined,
    showMain: () => undefined,
    showOrb: () => undefined,
    hideOrb: () => undefined,
    setMoveCard: () => undefined
  })
  bus.emit('orb:bubble', { text: 'Keeping the music steady.' })
  bus.emit('orb:bubble', { text: 'SDK advice', action: 'show-camera', ttlMs: cfg.bubbleTtlMs })
  expect(fw.orb().bubbleAction).toBeUndefined()
  vi.advanceTimersByTime(windowsConfig.bubbleTtlMs)
  expect(fw.orb()).toMatchObject({ bubble: 'SDK advice', bubbleAction: 'show-camera' })
  bus.emit('orb:bubble', { text: 'New song' })
  expect(fw.orb().bubbleAction).toBeUndefined()
  vi.advanceTimersByTime(windowsConfig.bubbleTtlMs)
  expect(fw.orb().bubbleAction).toBeUndefined()
  bus.emit('orb:bubble', { text: 'Later advice', action: 'show-camera', ttlMs: cfg.bubbleTtlMs })
  expect(fw.orb().bubbleAction).toBe('show-camera')
  vi.advanceTimersByTime(cfg.bubbleTtlMs)
  expect(fw.orb().bubbleAction).toBeUndefined()
  expect(fw.orb().bubble).toBeUndefined()
  fw.dispose()
})
