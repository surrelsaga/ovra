import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  type CameraMode,
  type PrivacyService,
  type SensingPhase,
  type Session,
  type SimScenario,
  type StateUpdate
} from '@shared/types'
import { createBus } from '../bus'
import { createStateEngine } from '../state'
import { createSimulatedSensing } from './sensing'
import { simConfig } from './config'

const T = simConfig.fast.timing

function fakePrivacy(opts: { camera?: boolean; face?: boolean } = {}): PrivacyService {
  const camera = opts.camera ?? true
  const settings = { ...DEFAULT_SETTINGS, thresholdOverrides: { ...simConfig.fast.thresholds } }
  return {
    canUseCamera: () => camera,
    canUseFace: () => opts.face ?? true,
    assertCameraConsent: () => {
      if (!camera) throw new Error('Camera consent required')
    },
    getSettings: () => settings
  } as unknown as PrivacyService
}

interface Rig {
  bus: ReturnType<typeof createBus>
  privacy: PrivacyService
  sim: ReturnType<typeof createSimulatedSensing>
  log: string[]
  metrics: () => number
}

function setup(opts: { camera?: boolean; face?: boolean } = {}): Rig {
  const bus = createBus()
  const privacy = fakePrivacy(opts)
  const sim = createSimulatedSensing(bus, privacy, () => T)
  const log: string[] = []
  bus.on('sdk:checkin-started', ({ phase }) => log.push(`start:${phase}`))
  bus.on('sdk:checkin-ended', ({ phase }) => log.push(`end:${phase}`))
  bus.on('privacy:camera-paused', () => log.push('paused'))
  bus.on('privacy:camera-resumed', () => log.push('resumed'))
  let metrics = 0
  bus.on('sdk:metrics', () => metrics++)
  return { bus, privacy, sim, log, metrics: () => metrics }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('simulated sensing contract', () => {
  it('asserts camera consent before any phase and still emits ended', async () => {
    const { sim, log, metrics } = setup({ camera: false })
    await expect(sim.startCalibration()).rejects.toThrow(/consent/)
    await expect(sim.startReturnCheck()).rejects.toThrow(/consent/)
    await expect(sim.startContinuous()).rejects.toThrow(/consent/)
    expect(() => sim.startCheckins(5)).toThrow(/consent/)
    expect(log).toEqual(['end:calibration', 'end:return-check', 'end:continuous'])
    vi.advanceTimersByTime(60_000)
    expect(metrics()).toBe(0)
  })

  it('runs a timed calibration with progress and metrics, then ends', async () => {
    const { bus, sim, log, metrics } = setup()
    const progress: number[] = []
    bus.on('sdk:calibration-progress', (p) => progress.push(p.progress))
    await sim.startCalibration()
    expect(sim.phase()).toBe('calibration')
    vi.advanceTimersByTime(T.calibrationMs)
    expect(sim.phase()).toBe('idle')
    expect(log).toEqual(['start:calibration', 'end:calibration'])
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(1)
    expect(metrics()).toBeGreaterThan(T.calibrationMs / simConfig.sampleMs - 2)
    const n = metrics()
    vi.advanceTimersByTime(10_000)
    expect(metrics()).toBe(n) // camera off: nothing between phases
  })

  it('schedules check-ins at the interval and blocks every start while paused', async () => {
    const { sim, log } = setup()
    sim.startCheckins(5)
    expect(sim.phase()).toBe('idle') // like the real one: first check-in after one interval
    vi.advanceTimersByTime(T.checkinIntervalMs)
    expect(sim.phase()).toBe('checkin')
    await sim.pause()
    expect(log).toEqual(['start:checkin', 'end:checkin', 'paused'])
    log.length = 0
    vi.advanceTimersByTime(T.checkinIntervalMs * 3)
    await sim.startCalibration()
    await sim.startReturnCheck()
    await sim.startContinuous()
    expect(sim.phase()).toBe('idle')
    expect(log.some((e) => e.startsWith('start:'))).toBe(false)
    expect(log).toEqual(['end:calibration', 'end:return-check', 'end:continuous'])
    log.length = 0
    await sim.resume()
    expect(log[0]).toBe('resumed')
  })

  it('always emits ended when a phase is cut short', async () => {
    const { sim, log } = setup()
    await sim.startCalibration()
    await sim.startReturnCheck() // replaces calibration
    await sim.stop()
    expect(log).toEqual([
      'start:calibration',
      'end:calibration',
      'start:return-check',
      'end:return-check'
    ])
    await sim.startContinuous()
    await sim.pause()
    expect(log.slice(-3)).toEqual(['start:continuous', 'end:continuous', 'paused'])
  })

  it('stop clears the schedule', async () => {
    const { sim, log } = setup()
    sim.startCheckins(5)
    await sim.stop()
    vi.advanceTimersByTime(T.checkinIntervalMs * 3)
    expect(log).toEqual([])
  })

  it('hands a timed phase over to continuous and resumes continuous after a pause', async () => {
    const { sim, log } = setup()
    await sim.startReturnCheck()
    await sim.startContinuous() // a phase is running: continuous waits for it
    vi.advanceTimersByTime(T.returnCheckMs)
    expect(sim.phase()).toBe('continuous')
    await sim.pause()
    await sim.resume()
    expect(sim.phase()).toBe('continuous')
    expect(log.filter((e) => e === 'start:continuous')).toHaveLength(2)
  })

  it('drops face fields without face consent', async () => {
    const { bus, sim } = setup({ face: false })
    const faces: unknown[] = []
    bus.on('sdk:metrics', (m) => faces.push(m.face))
    await sim.startCalibration()
    expect(faces.length).toBeGreaterThan(0)
    expect(faces.every((f) => f === undefined)).toBe(true)
  })

  it('tilt action reaches the head roll for about 8 s', async () => {
    const { bus, sim } = setup()
    const rolls: number[] = []
    bus.on('sdk:metrics', (m) => rolls.push(m.face!.headRollDeg!))
    await sim.startContinuous()
    sim.action('tilt-left')
    vi.advanceTimersByTime(simConfig.actions.durationMs - 500)
    expect(rolls.slice(-3).every((r) => r <= -25)).toBe(true)
    vi.advanceTimersByTime(1_000)
    expect(Math.abs(rolls.at(-1)!)).toBeLessThan(5)
  })
})

/** Calibrate (always calm), then run the scenario through the REAL state engine. */
async function situationFor(scenario: SimScenario, mode: CameraMode): Promise<StateUpdate> {
  const { bus, privacy, sim } = setup()
  const state = createStateEngine({ bus, privacy })
  let last: StateUpdate | undefined
  bus.on('state:updated', (s) => (last = s))
  bus.emit('session:started', { config: { cameraMode: mode } } as Session)
  sim.setScenario(scenario) // calibration still sees calm
  await sim.startCalibration()
  vi.advanceTimersByTime(T.calibrationMs)
  expect(last?.situation).toBe('focused')
  if (mode === 'checkins') {
    sim.startCheckins(5)
    vi.advanceTimersByTime(T.checkinIntervalMs + T.checkinMs)
  } else {
    await sim.startContinuous()
    vi.advanceTimersByTime(30_000)
  }
  await sim.stop()
  state.dispose()
  return last!
}

describe('scenarios through the real state engine (fast mode)', () => {
  it.each([
    ['calm', 'focused'],
    ['tense', 'tense'],
    ['crashing', 'crashing'],
    ['low', 'low'],
    ['good', 'good']
  ] as const)('%s → %s (check-ins and continuous)', async (scenario, expected) => {
    for (const mode of ['checkins', 'continuous'] as const) {
      const s = await situationFor(scenario, mode)
      expect([mode, s.situation, s.away]).toEqual([mode, expected, false])
    }
  })

  it('away → away=true in continuous mode', async () => {
    const s = await situationFor('away', 'continuous')
    expect(s.away).toBe(true)
  })

  it('every phase sees calm during calibration', async () => {
    const seen: SensingPhase[] = []
    const { bus, sim } = setup()
    bus.on('sdk:metrics', (m) => {
      if (m.pulse && Math.abs(m.pulse.value / simConfig.baseline.pulse - 1) > 0.02)
        seen.push(sim.phase())
    })
    sim.setScenario('crashing')
    await sim.startCalibration()
    vi.advanceTimersByTime(T.calibrationMs)
    expect(seen).toEqual([])
  })
})
