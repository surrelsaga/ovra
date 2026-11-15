import { DEFAULT_SETTINGS, type MetricsSnapshot, type PrivacyService } from '@shared/types'
import { createBus } from '../bus'
import { hasFace } from './classifier'
import { createStateEngine } from '.'

const pulse = { value: 60, confidence: 90, stable: true }
const face = { present: true, center: { x: 0.5, y: 0.5 }, size: 0.4 }

function setup(
  faceEnabled = true,
  awayNoFaceSec = 20
): {
  bus: ReturnType<typeof createBus>
  engine: ReturnType<typeof createStateEngine>
  feed: (snapshot?: Partial<MetricsSnapshot>) => void
} {
  const bus = createBus()
  const privacy = {
    canUseFace: () => faceEnabled,
    getSettings: () => ({ ...DEFAULT_SETTINGS, thresholdOverrides: { awayNoFaceSec } })
  } as unknown as PrivacyService
  const engine = createStateEngine({ bus, privacy })
  bus.emit('session:started', {
    id: 'presence',
    startedAt: Date.now(),
    status: 'running',
    sensingEnabled: true,
    config: {
      activity: 'focus',
      lengthMin: 45,
      cameraMode: 'continuous',
      checkinIntervalMin: 5,
      music: false
    }
  })
  bus.emit('sdk:checkin-started', { phase: 'continuous' })
  return { bus, engine, feed: (s = {}) => bus.emit('sdk:metrics', { t: Date.now(), ...s }) }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => vi.useRealTimers())

it.each([0, 3, 4, 7, 12, 13, 14, 15, 16, 17])(
  'raw framing code %i proves presence without pulse or landmarks (no cap without face consent, or for code 7)',
  (code) => {
    for (const faceEnabled of [true, false]) {
      if (faceEnabled && code !== 7) continue
      const { bus, engine, feed } = setup(faceEnabled)
      // Displayed hints may still say no face when the raw stream already recovered.
      bus.emit('sdk:validation', { t: Date.now(), code: 1, hint: '' })
      for (let sec = 0; sec < 60; sec++) {
        feed({ validationCode: code, face: { present: true } })
        vi.advanceTimersByTime(1000)
        expect(engine.current().away).toBe(false)
      }
      expect(engine.current().seatedMinutes).toBeCloseTo(1)
      engine.dispose()
    }
  }
)

it.each([0, 3, 4, 12, 13, 14, 15, 16, 17])(
  'with face consent, box-less code %i holds presence only 20 s past the last face box',
  (code) => {
    const { engine, feed } = setup(true)
    feed({ validationCode: 0, face })
    for (let sec = 1; sec <= 45; sec++) {
      vi.advanceTimersByTime(1000)
      feed({ validationCode: code, face: { present: true } })
      // Evidence stops after 20 s, away 20 s after that.
      expect(engine.current().away).toBe(sec >= 40)
    }
    engine.dispose()
  }
)

it('does not accept a bare SDK face object or a lighting/readiness code as evidence', () => {
  for (const validationCode of [undefined, 5, 6, 10, 11, 99])
    expect(hasFace({ t: Date.now(), validationCode, face: { present: true } }, true)).toBe(false)
  expect(hasFace({ t: Date.now(), validationCode: 1, pulse, face }, true)).toBe(false)
  expect(hasFace({ t: Date.now(), validationCode: 2, face }, true)).toBe(false)
  expect(hasFace({ t: Date.now(), validationCode: 2, pulse, face }, true)).toBe(true)
})

it.each([20, 15])(
  'raw no-face overrides pulse/landmarks and goes away after %i seconds',
  (timeout) => {
    const { engine, feed } = setup(true, timeout)
    feed({ validationCode: 7 })
    for (let sec = 0; sec < timeout; sec++) {
      vi.advanceTimersByTime(1000)
      expect(engine.current().away).toBe(sec === timeout - 1)
      feed({ validationCode: 1, pulse, face })
    }
    engine.dispose()
  }
)

it.each(['no frames', 'timestamps stalled', 'timestamps backwards', 'empty objects'])(
  'goes away on %s even with framing hints',
  (missing) => {
    const { bus, engine, feed } = setup()
    const t = Date.now()
    feed({ validationCode: 7 })
    for (let sec = 0; sec < 20; sec++) {
      vi.advanceTimersByTime(1000)
      bus.emit('sdk:validation', { t: Date.now(), code: 15, hint: '' })
      if (missing === 'timestamps stalled') feed({ t, validationCode: 7, pulse, face })
      if (missing === 'timestamps backwards')
        feed({ t: t - sec - 1, validationCode: 7, pulse, face })
      if (missing === 'empty objects') feed({ face: { present: true } })
      expect(engine.current().away).toBe(sec === 19)
    }
    engine.dispose()
  }
)

it('wakes on framing codes after three distinct seconds and retains absence timing through return phases', () => {
  const { bus, engine, feed } = setup(false)
  vi.advanceTimersByTime(20_000)
  expect(engine.current().away).toBe(true)
  for (let sec = 0; sec < 3; sec++) {
    feed({ validationCode: 7 })
    expect(engine.current().away).toBe(sec !== 2)
    vi.advanceTimersByTime(1000)
  }
  const lastFace = engine.diagnostics().lastFace
  bus.emit('sdk:checkin-started', { phase: 'return-check' })
  expect(engine.diagnostics().lastFace).toBe(lastFace)
  vi.advanceTimersByTime(10_000)
  bus.emit('sdk:checkin-ended', { phase: 'return-check' })
  bus.emit('sdk:checkin-started', { phase: 'continuous' })
  expect(engine.diagnostics().lastFace).toBe(lastFace)
  vi.advanceTimersByTime(9000)
  expect(engine.current().away).toBe(true)
  engine.dispose()
})

it('explicit return clears automatic away before later return listeners and gives a fresh grace period', () => {
  const { bus, engine } = setup()
  vi.advanceTimersByTime(20_000)
  expect(engine.current().away).toBe(true)
  const returned = vi.fn(() => expect(engine.current().away).toBe(false))
  bus.on('break:returned', returned)
  bus.emit('break:returned', { awayMs: 20_000 })
  expect(returned).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(19_000)
  expect(engine.current().away).toBe(false)
  vi.advanceTimersByTime(1000)
  expect(engine.current().away).toBe(true)
  engine.dispose()
})

it('treats an SDK restart like a pause: no away, "Camera reconnecting", fresh away clock after', () => {
  const { bus, engine, feed } = setup()
  feed({ validationCode: 0, pulse })
  bus.emit('sdk:reconnecting', { active: true, message: 'The camera reading stopped.' })
  vi.advanceTimersByTime(60_000)
  expect(engine.current().away).toBe(false)
  expect(engine.why()).toEqual({ text: 'Camera reconnecting', moving: true })
  bus.emit('sdk:reconnecting', { active: false })
  expect(engine.why()?.text).not.toBe('Camera reconnecting')
  vi.advanceTimersByTime(19_000)
  expect(engine.current().away).toBe(false)
  vi.advanceTimersByTime(2_000)
  expect(engine.current().away).toBe(true)
  engine.dispose()
})

describe('empty chair vs seated but unmeasurable (Job 10)', () => {
  const seat = { present: true, center: { x: 0.52, y: 0.4 }, size: 0.32 }
  const calibrate = (
    bus: ReturnType<typeof createBus>,
    feed: (s?: Partial<MetricsSnapshot>) => void
  ): void => {
    bus.emit('sdk:checkin-ended', { phase: 'continuous' })
    bus.emit('sdk:checkin-started', { phase: 'calibration' })
    for (let sec = 0; sec < 35; sec++) {
      feed({ validationCode: 0, pulse, face: seat })
      vi.advanceTimersByTime(1000)
    }
    bus.emit('sdk:checkin-ended', { phase: 'calibration' })
    bus.emit('sdk:checkin-started', { phase: 'continuous' })
  }

  it.each([20, 15])(
    'a ghost face off the seat with steady pulse and code 0 goes away after %i s',
    (timeout) => {
      const { bus, engine, feed } = setup(true, timeout)
      calibrate(bus, feed)
      feed({ validationCode: 0, pulse, face: seat })
      for (let sec = 1; sec <= timeout + 5; sec++) {
        vi.advanceTimersByTime(1000)
        // Something face-like elsewhere in the room: the SDK reads a pulse from it.
        feed({
          validationCode: 0,
          pulse,
          face: { present: true, center: { x: 0.85, y: 0.3 }, size: 0.14 }
        })
        expect(engine.current().away).toBe(sec >= timeout)
      }
      engine.dispose()
    }
  )

  it.each([20, 15])(
    'box-less ghost frames (codes 15/17, empty face objects, steady pulse) go away within 20 + %i s',
    (timeout) => {
      const { bus, engine, feed } = setup(true, timeout)
      calibrate(bus, feed)
      feed({ validationCode: 0, pulse, face: seat })
      for (let sec = 1; sec <= 20 + timeout + 5; sec++) {
        vi.advanceTimersByTime(1000)
        feed({
          validationCode: sec % 2 ? 15 : 17,
          face: { present: true },
          ...(sec % 3 ? {} : { pulse })
        })
        expect(engine.current().away).toBe(sec >= 20 + timeout)
      }
      engine.dispose()
    }
  )

  it('seated with code 7, no landmarks and no pulse stays present for 10 minutes', () => {
    const { bus, engine, feed } = setup(true)
    calibrate(bus, feed)
    for (let sec = 0; sec < 600; sec++) {
      feed({ validationCode: 7, face: { present: true } })
      vi.advanceTimersByTime(1000)
      expect(engine.current().away).toBe(false)
    }
    engine.dispose()
  })

  it('returning to the seat wakes as before; box-less ghost frames never do', () => {
    const { bus, engine, feed } = setup(true)
    calibrate(bus, feed)
    for (let sec = 0; sec < 60; sec++) {
      feed({ validationCode: 15, face: { present: true }, pulse })
      vi.advanceTimersByTime(1000)
    }
    expect(engine.current().away).toBe(true)
    // Steady pulse from a face at the seat wakes at once.
    feed({ validationCode: 0, pulse, face: seat })
    expect(engine.current().away).toBe(false)
    vi.advanceTimersByTime(45_000)
    expect(engine.current().away).toBe(true)
    // A face box at the seat for 3 of 4 seconds wakes too.
    for (let sec = 0; sec < 3; sec++) {
      expect(engine.current().away).toBe(true)
      feed({ validationCode: 16, face: seat })
      vi.advanceTimersByTime(1000)
    }
    expect(engine.current().away).toBe(false)
    engine.dispose()
  })

  it('SDK reconnecting is neither away nor present; box-less frames after it age out again', () => {
    const { bus, engine, feed } = setup(true)
    calibrate(bus, feed)
    feed({ validationCode: 0, pulse, face: seat })
    bus.emit('sdk:reconnecting', { active: true, message: 'The camera reading stopped.' })
    vi.advanceTimersByTime(60_000)
    expect(engine.current().away).toBe(false)
    bus.emit('sdk:reconnecting', { active: false })
    for (let sec = 1; sec <= 45; sec++) {
      vi.advanceTimersByTime(1000)
      feed({ validationCode: 17, face: { present: true }, pulse })
      expect(engine.current().away).toBe(sec >= 40)
    }
    engine.dispose()
  })
})
