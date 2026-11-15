import {
  DEFAULT_PRIVACY,
  DEFAULT_SETTINGS,
  type BusEventName,
  type MetricsSnapshot,
  type PrivacyService
} from '@shared/types'
import { createBus } from '../bus'
import { createSensing } from '.'
import { createStateEngine } from '../state'
import { sensingConfig, type SensingConfig } from './config'

// Fake Electron + IPC: the capture "renderer" answers every capture-stop with status idle.
const h = vi.hoisted(() => {
  const handlers: Record<string, (payload: unknown, e: { sender: unknown }) => void> = {}
  const wc = { id: 1, on: vi.fn() }
  const windows: unknown[] = []
  const pushes: { channel: string; payload: unknown }[] = []
  return {
    handlers,
    wc,
    windows,
    pushes,
    autoStop: true,
    loadPage: vi.fn(),
    permissionRequest: null as
      | null
      | ((
          wc: { id: number },
          permission: string,
          cb: (allowed: boolean) => void,
          details: { mediaTypes?: string[] }
        ) => void),
    permissionCheck: null as null | ((wc: { id: number }, permission: string) => boolean)
  }
})

vi.mock('electron', () => ({
  app: { isPackaged: false },
  session: {
    fromPartition: () => ({
      setPermissionRequestHandler: (fn: typeof h.permissionRequest) => {
        h.permissionRequest = fn
      },
      setPermissionCheckHandler: (fn: typeof h.permissionCheck) => {
        h.permissionCheck = fn
      }
    })
  },
  BrowserWindow: vi.fn(function (this: Record<string, unknown>) {
    let destroyed = false
    const listeners: Record<string, (() => void)[]> = {}
    const close = (): void => {
      if (destroyed) return
      destroyed = true
      for (const fn of listeners.closed ?? []) fn()
    }
    this.webContents = h.wc
    this.isDestroyed = () => destroyed
    this.on = this.once = vi.fn((event: string, fn: () => void) => {
      ;(listeners[event] ??= []).push(fn)
    })
    this.close = vi.fn(close)
    this.destroy = vi.fn(close)
    h.windows.push(this)
  })
}))
vi.mock('@smartspectra/node-sdk/main', () => ({ bindSmartSpectraIpc: vi.fn() }))
vi.mock('./native-work', () => ({ nativeWork: { start: vi.fn(), settle: vi.fn(async () => {}) } }))
vi.mock('../paths', () => ({ preloadPath: () => 'preload.js', loadPage: h.loadPage }))
vi.mock('../ipc', () => ({
  onCapture: (channel: string, fn: (payload: unknown, e: { sender: unknown }) => void) => {
    h.handlers[channel] = fn
    return () => {}
  },
  push: (_win: unknown, channel: string, payload: unknown) => {
    h.pushes.push({ channel, payload })
    if (channel === 'push:capture-stop' && h.autoStop)
      h.handlers['capture:status']?.('idle', { sender: h.wc })
  }
}))

function fakePrivacy(consent = true): PrivacyService {
  return {
    assertCameraConsent: () => {
      if (!consent) throw new Error('no camera consent')
    },
    canUseCamera: () => consent,
    canUseFace: () => false,
    get: () => ({ ...DEFAULT_PRIVACY, camera: consent ? 'yes' : null }),
    getSettings: () => ({ ...DEFAULT_SETTINGS, devVideoSource: '/videos/calm.mp4' })
  } as unknown as PrivacyService
}

interface Setup {
  sensing: ReturnType<typeof createSensing>
  events: { name: BusEventName; payload: unknown }[]
  names: () => string[]
  bus: ReturnType<typeof createBus>
  privacy: PrivacyService
}

function setup(
  opts: { consent?: boolean; key?: string | null; config?: Partial<SensingConfig> } = {}
): Setup {
  const bus = createBus()
  const events: { name: BusEventName; payload: unknown }[] = []
  for (const name of [
    'sdk:checkin-started',
    'sdk:checkin-ended',
    'sdk:metrics',
    'sdk:validation',
    'sdk:error',
    'sdk:calibration-progress',
    'privacy:camera-paused',
    'privacy:camera-resumed'
  ] as const)
    bus.on(name, (payload) => events.push({ name, payload }))
  const privacy = fakePrivacy(opts.consent ?? true)
  const sensing = createSensing({
    bus,
    privacy,
    getApiKey: () => (opts.key === undefined ? 'test-key' : opts.key),
    config: {
      checkinMs: 5_000,
      returnCheckMs: 3_000,
      hintPersistMs: 1_000,
      ...opts.config
    }
  })
  const names = (): string[] =>
    events
      .filter((e) => e.name !== 'sdk:calibration-progress')
      .map(
        (e) =>
          `${e.name}${(e.payload as { phase?: string }).phase ? ':' + (e.payload as { phase: string }).phase : ''}`
      )
  return { sensing, events, names, bus, privacy }
}

beforeEach(() => {
  vi.useFakeTimers()
  h.windows.length = 0
  h.pushes.length = 0
  h.autoStop = true
  h.loadPage.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

describe('consent gate', () => {
  it('runs no camera code before consent', async () => {
    const { sensing } = setup({ consent: false })
    await expect(sensing.startCalibration()).rejects.toThrow('no camera consent')
    await expect(sensing.startReturnCheck()).rejects.toThrow()
    await expect(sensing.startContinuous()).rejects.toThrow()
    expect(() => sensing.startCheckins(5)).toThrow()
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(h.windows).toHaveLength(0)
    expect(h.pushes).toHaveLength(0)
    expect(sensing.phase()).toBe('idle')
  })

  it('creates the capture window and starts capture after consent', async () => {
    const { sensing } = setup()
    await sensing.startCalibration()
    expect(h.windows).toHaveLength(1)
    expect(h.pushes[0]).toMatchObject({
      channel: 'push:capture-start',
      payload: {
        phase: 'calibration',
        source: { kind: 'file', path: '/videos/calm.mp4', framingPad: 0.4 },
        face: false,
        telemetry: false
      }
    })
  })
})

describe('missing API key', () => {
  it('emits sdk:error and never starts capture', async () => {
    const { sensing, events } = setup({ key: null })
    await sensing.startCalibration()
    expect(events.find((e) => e.name === 'sdk:error')?.payload).toMatchObject({
      code: 'no-api-key'
    })
    expect(h.windows).toHaveLength(0)
    expect(events.filter((e) => e.name === 'sdk:checkin-ended')).toEqual([
      { name: 'sdk:checkin-ended', payload: { phase: 'calibration' } }
    ])
  })
})

describe('phases and check-in scheduler', () => {
  it('ends a failed window load and allows the next attempt to create a fresh window', async () => {
    const { sensing, names } = setup()
    h.loadPage.mockRejectedValueOnce(new Error('capture page unavailable'))
    await expect(sensing.startReturnCheck()).rejects.toThrow('capture page unavailable')
    expect(names()).toEqual(['sdk:checkin-ended:return-check'])
    await sensing.startCalibration()
    expect(h.windows).toHaveLength(2)
    expect(sensing.phase()).toBe('calibration')
  })

  it('waits for the old capture to stop before starting the latest requested phase', async () => {
    const { sensing, names } = setup()
    await sensing.startContinuous()
    h.autoStop = false
    const returning = sensing.startReturnCheck()
    const calibrating = sensing.startCalibration()
    await vi.advanceTimersByTimeAsync(0)
    expect(sensing.phase()).toBe('return-check')
    expect(names()).toEqual(['sdk:checkin-started:continuous', 'sdk:checkin-started:return-check'])
    h.handlers['capture:status']('idle', { sender: h.wc })
    await Promise.all([returning, calibrating])
    expect(names()).toEqual([
      'sdk:checkin-started:continuous',
      'sdk:checkin-started:return-check',
      'sdk:checkin-ended:return-check',
      'sdk:checkin-started:calibration'
    ])
    expect(sensing.phase()).toBe('calibration')
  })

  it('destroys an unresponsive capture before emitting ended', async () => {
    const { sensing, names } = setup()
    await sensing.startContinuous()
    h.autoStop = false
    const stopping = sensing.pause()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(names()).toEqual(['sdk:checkin-started:continuous'])
    await vi.advanceTimersByTimeAsync(1)
    await stopping
    expect((h.windows[0] as { destroy: () => void }).destroy).toHaveBeenCalled()
    expect(names()).toEqual([
      'sdk:checkin-started:continuous',
      'sdk:error',
      'sdk:checkin-ended:continuous',
      'privacy:camera-paused'
    ])
  })

  it('ends continuous capture if the capture window closes unexpectedly', async () => {
    const { sensing, names } = setup()
    await sensing.startContinuous()
    ;(h.windows[0] as { destroy: () => void }).destroy()
    expect(sensing.phase()).toBe('idle')
    expect(names()).toEqual(['sdk:checkin-started:continuous', 'sdk:checkin-ended:continuous'])
  })

  it('retries a failed renderer start, then ends the phase with a plain reason', async () => {
    const { sensing, names, events } = setup()
    await sensing.startContinuous()
    const fail = (): void =>
      h.handlers['capture:error'](
        { code: 'start-failed', message: 'Video unavailable', retryable: true },
        { sender: h.wc }
      )
    fail()
    for (const wait of sensingConfig.restartBackoffMs) {
      await vi.advanceTimersByTimeAsync(wait)
      fail()
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(sensing.phase()).toBe('idle')
    expect(h.pushes.filter((p) => p.channel === 'push:capture-start')).toHaveLength(4)
    expect(names().filter((n) => n.startsWith('sdk:checkin'))).toEqual([
      'sdk:checkin-started:continuous',
      'sdk:checkin-ended:continuous'
    ])
    expect(events.filter((e) => e.name === 'sdk:error').at(-1)?.payload).toEqual({
      code: 'sdk-lost',
      message: sensingConfig.lostMessage,
      retryable: false
    })
  })

  it('says in the dev log when the dev video source does not exist', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = setup()
    await t.sensing.startCalibration()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"/videos/calm.mp4" doesn\'t exist'))
    warn.mockRestore()
  })

  it('calibration: framing check, then ends after 30 s of steady pulse', async () => {
    const { sensing, events, names } = setup()
    await sensing.startCalibration()
    expect(sensing.phase()).toBe('calibration')
    h.handlers['capture:validation']({ t: Date.now(), code: 0, hint: '' }, { sender: h.wc })
    const progress = (): unknown[] =>
      events.filter((e) => e.name === 'sdk:calibration-progress').map((e) => e.payload)
    for (let i = 0; i < 45 && sensing.phase() === 'calibration'; i++) {
      h.handlers['capture:metrics'](
        { t: Date.now(), pulse: { value: 60, stable: true } },
        { sender: h.wc }
      )
      await vi.advanceTimersByTimeAsync(1000)
      // OK shows after 1 s (hint persist) and must hold 3 s before the clock starts.
      if (i === 2) expect(progress().at(-1)).toEqual({ progress: 0, hint: null, framing: true })
    }
    expect(progress().at(-1)).toEqual({ progress: 1, hint: null, framing: false })
    expect(progress().filter((p) => (p as { framing: boolean }).framing).length).toBeLessThan(6)
    expect(names().filter((n) => n !== 'sdk:metrics')).toEqual([
      'sdk:checkin-started:calibration',
      'sdk:validation',
      'sdk:checkin-ended:calibration'
    ])
    expect(sensing.phase()).toBe('idle')
  })

  it('runs a check-in every interval and fully stops the stream in between', async () => {
    const { sensing, names } = setup()
    sensing.startCheckins(3)
    await vi.advanceTimersByTimeAsync(3 * 60_000 - 1)
    expect(sensing.phase()).toBe('idle')
    await vi.advanceTimersByTimeAsync(1)
    expect(sensing.phase()).toBe('checkin')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(sensing.phase()).toBe('idle')
    expect(h.pushes.map((p) => p.channel)).toEqual(['push:capture-start', 'push:capture-stop'])
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(names()).toEqual([
      'sdk:checkin-started:checkin',
      'sdk:checkin-ended:checkin',
      'sdk:checkin-started:checkin',
      'sdk:checkin-ended:checkin'
    ])
    await sensing.stop()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(names()).toHaveLength(4)
  })

  it('return check keeps one continuous SDK stream through both phase changes', async () => {
    const { sensing, names } = setup()
    await sensing.startContinuous()
    await sensing.startReturnCheck()
    expect(sensing.phase()).toBe('return-check')
    await vi.advanceTimersByTimeAsync(1_000)
    await sensing.startReturnCheck() // duplicate requests do not restart or extend the check
    await vi.advanceTimersByTimeAsync(2_000)
    expect(sensing.phase()).toBe('continuous')
    expect(names()).toEqual([
      'sdk:checkin-started:continuous',
      'sdk:checkin-started:return-check',
      'sdk:checkin-ended:return-check',
      'sdk:checkin-started:continuous'
    ])
    expect(h.pushes.map((p) => p.channel)).toEqual(['push:capture-start'])
  })

  it('cancels a logical return check when paused without restarting capture later', async () => {
    const { sensing, names } = setup()
    await sensing.startContinuous()
    await sensing.startReturnCheck()
    await sensing.pause()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(sensing.phase()).toBe('idle')
    expect(names()).toEqual([
      'sdk:checkin-started:continuous',
      'sdk:checkin-started:return-check',
      'sdk:checkin-ended:return-check',
      'privacy:camera-paused'
    ])
    expect(h.pushes.map((p) => p.channel)).toEqual(['push:capture-start', 'push:capture-stop'])
  })

  it('pause stops the camera and skips check-ins until resumed', async () => {
    const { sensing, names } = setup()
    await sensing.startContinuous()
    await sensing.pause()
    expect(sensing.phase()).toBe('idle')
    await sensing.startReturnCheck() // can't run while paused, but still reports ended
    await sensing.resume()
    expect(sensing.phase()).toBe('continuous')
    expect(names()).toEqual([
      'sdk:checkin-started:continuous',
      'sdk:checkin-ended:continuous',
      'privacy:camera-paused',
      'sdk:checkin-ended:return-check',
      'privacy:camera-resumed',
      'sdk:checkin-started:continuous'
    ])
  })
})

describe('while paused', () => {
  it('keeps the pause across stop until resume is explicitly called', async () => {
    const { sensing } = setup()
    await sensing.pause()
    await sensing.stop()
    await sensing.startCalibration()
    await sensing.startReturnCheck()
    await sensing.startContinuous()
    expect(h.windows).toHaveLength(0)
    expect(h.pushes).toHaveLength(0)
    await sensing.resume()
    expect(sensing.phase()).toBe('continuous')
  })

  it('starts no capture of any kind, and resume() continues the schedule', async () => {
    const { sensing, names } = setup()
    sensing.startCheckins(3)
    await sensing.pause()
    await vi.advanceTimersByTimeAsync(10 * 60_000) // three scheduled check-ins while paused
    await sensing.startCalibration()
    await sensing.startReturnCheck()
    expect(h.pushes.filter((p) => p.channel === 'push:capture-start')).toHaveLength(0)
    expect(h.windows).toHaveLength(0)
    expect(names().filter((n) => n.startsWith('sdk:checkin-started'))).toEqual([])
    expect(sensing.phase()).toBe('idle')

    await sensing.resume()
    await vi.advanceTimersByTimeAsync(3 * 60_000) // next tick after resume
    expect(names().filter((n) => n.startsWith('sdk:checkin-started'))).toEqual([
      'sdk:checkin-started:checkin'
    ])
  })
})

describe('capture messages', () => {
  it.each([true, false])(
    'raw no-face overrides metrics before hint debounce (face consent %s)',
    async (face) => {
      const t = setup()
      vi.spyOn(t.privacy, 'canUseFace').mockReturnValue(face)
      const engine = createStateEngine({ bus: t.bus, privacy: t.privacy })
      await t.sensing.startContinuous()
      h.handlers['capture:validation'](
        { t: Date.now(), code: 1, hint: 'No face found' },
        { sender: h.wc }
      )
      const m = {
        t: Date.now(),
        face: { present: true },
        pulse: { value: 60, confidence: 90, stable: true }
      }
      h.handlers['capture:metrics'](m, { sender: h.wc })
      expect(engine.diagnostics().lastFace).toBeNull()
      expect(t.events.filter((e) => e.name === 'sdk:metrics').at(-1)?.payload).toEqual(
        face
          ? { t: m.t, validationCode: 1, face: { present: false } }
          : { t: m.t, validationCode: 1 }
      )
      expect(t.events.filter((e) => e.name === 'sdk:validation')).toHaveLength(0)
      for (let sec = 0; sec < 25; sec++) {
        h.handlers['capture:metrics']({ ...m, t: Date.now() }, { sender: h.wc })
        await vi.advanceTimersByTimeAsync(1000)
      }
      expect(engine.current().away).toBe(true)
      h.handlers['capture:validation']({ t: Date.now(), code: 0, hint: '' }, { sender: h.wc })
      await vi.advanceTimersByTimeAsync(1000)
      // With face consent a returning face brings its box; a box-less pulse can't wake (Job 10).
      const back = face ? { present: true, center: { x: 0.5, y: 0.5 }, size: 0.4 } : m.face
      h.handlers['capture:metrics']({ ...m, face: back, t: Date.now() }, { sender: h.wc })
      expect(engine.current().away).toBe(false)
      await t.sensing.stop()
      engine.dispose()
    }
  )

  it('raw code 2 blocks landmark presence before hint debounce without discarding pulse', async () => {
    const t = setup()
    vi.spyOn(t.privacy, 'canUseFace').mockReturnValue(true)
    const engine = createStateEngine({ bus: t.bus, privacy: t.privacy })
    await t.sensing.startContinuous()
    h.handlers['capture:validation'](
      { t: Date.now(), code: 2, hint: 'Multiple faces' },
      { sender: h.wc }
    )
    const m = { t: Date.now(), face: { present: true, center: { x: 0.5, y: 0.5 }, size: 0.4 } }
    h.handlers['capture:metrics'](m, { sender: h.wc })
    expect(engine.diagnostics().lastFace).toBeNull()
    h.handlers['capture:metrics'](
      { ...m, t: m.t + 1, pulse: { value: 60, confidence: 90, stable: true } },
      { sender: h.wc }
    )
    expect(engine.diagnostics().lastFace).toBe(m.t + 1)
    await t.sensing.stop()
    engine.dispose()
  })

  it('uses raw framing codes for vitals-only presence before hints and returns without capture restart', async () => {
    const t = setup()
    const engine = createStateEngine({ bus: t.bus, privacy: t.privacy })
    await t.sensing.startContinuous()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(engine.current().away).toBe(true)
    let wasAway = true
    t.bus.on('state:updated', (s) => {
      if (wasAway && !s.away) void t.sensing.startReturnCheck()
      wasAway = s.away
    })
    h.handlers['capture:validation']({ t: Date.now(), code: 7, hint: 'Chest' }, { sender: h.wc })
    for (let sec = 0; sec < 3; sec++) {
      h.handlers['capture:metrics']({ t: Date.now(), face: { present: true } }, { sender: h.wc })
      expect(engine.current().away).toBe(sec !== 2)
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(t.sensing.phase()).toBe('return-check')
    await vi.advanceTimersByTimeAsync(2000)
    expect(t.sensing.phase()).toBe('continuous')
    expect(h.pushes.map((p) => p.channel)).toEqual(['push:capture-start'])
    await t.sensing.stop()
    engine.dispose()
  })

  it('forwards metrics and only emits validation codes that persist', async () => {
    const { sensing, events } = setup()
    await sensing.startContinuous()
    const e = { sender: h.wc }
    h.handlers['capture:metrics']({ t: 1 }, e)
    h.handlers['capture:metrics']({ t: 2 }, { sender: {} }) // not the capture window
    h.handlers['capture:validation']({ t: 0, code: 17, hint: 'Face the camera.' }, e)
    await vi.advanceTimersByTimeAsync(300)
    h.handlers['capture:validation']({ t: 0, code: 0, hint: '' }, e)
    await vi.advanceTimersByTimeAsync(300)
    h.handlers['capture:validation']({ t: 0, code: 7, hint: 'Chest' }, e)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(events.filter((x) => x.name === 'sdk:metrics')).toHaveLength(1)
    expect(events.filter((x) => x.name === 'sdk:validation').map((x) => x.payload)).toMatchObject([
      { code: 7, hint: 'Chest' }
    ])
  })
})

describe('live privacy changes', () => {
  it('stops capture and scheduled check-ins when consent is revoked', async () => {
    const t = setup()
    t.sensing.startCheckins(3)
    await t.sensing.startContinuous()
    vi.spyOn(t.privacy, 'canUseCamera').mockReturnValue(false)
    t.bus.emit('privacy:changed', { ...DEFAULT_PRIVACY, camera: 'not-now' })
    await vi.advanceTimersByTimeAsync(0)
    expect(t.sensing.phase()).toBe('idle')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(t.names().filter((n) => n.startsWith('sdk:checkin-started'))).toHaveLength(1)
  })

  it('restarts with face metrics disabled and drops in-flight face data immediately', async () => {
    const t = setup()
    const face = vi.spyOn(t.privacy, 'canUseFace').mockReturnValue(true)
    t.bus.emit('privacy:changed', { ...DEFAULT_PRIVACY, camera: 'yes', face: 'vitals-and-face' })
    await t.sensing.startContinuous()
    face.mockReturnValue(false)
    t.bus.emit('privacy:changed', { ...DEFAULT_PRIVACY, camera: 'yes', face: 'vitals-only' })
    h.handlers['capture:metrics'](
      { t: 1, face: { present: true, expressions: { happy: 80 } } },
      { sender: h.wc }
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(t.events.filter((e) => e.name === 'sdk:metrics').at(-1)?.payload).toEqual({ t: 1 })
    expect(
      h.pushes.filter((p) => p.channel === 'push:capture-start').at(-1)?.payload
    ).toMatchObject({ face: false })
    expect(t.sensing.phase()).toBe('continuous')
  })
})

it('applies telemetry opt-out to the currently running native session', async () => {
  const t = setup()
  const consent = vi
    .spyOn(t.privacy, 'get')
    .mockReturnValue({ ...DEFAULT_PRIVACY, telemetry: true })
  t.bus.emit('privacy:changed', t.privacy.get())
  await t.sensing.startContinuous()
  expect(h.pushes[0].payload).toMatchObject({ telemetry: true })
  consent.mockReturnValue({ ...DEFAULT_PRIVACY, telemetry: false })
  t.bus.emit('privacy:changed', t.privacy.get())
  await vi.advanceTimersByTimeAsync(0)
  expect(h.pushes.filter((p) => p.channel === 'push:capture-start').at(-1)?.payload).toMatchObject({
    telemetry: false
  })
})

it('denies a late media permission request after camera consent is revoked', async () => {
  const t = setup()
  await t.sensing.startCalibration()
  expect(h.permissionCheck!(h.wc, 'media')).toBe(true)
  vi.spyOn(t.privacy, 'canUseCamera').mockReturnValue(false)
  const answer = vi.fn()
  h.permissionRequest!(h.wc, 'media', answer, { mediaTypes: ['video'] })
  expect(answer).toHaveBeenCalledWith(false)
  expect(h.permissionCheck!(h.wc, 'media')).toBe(false)
})

describe('SDK crash recovery (decision 48)', () => {
  const capture = (channel: string, payload: unknown): void =>
    h.handlers[channel](payload, { sender: h.wc })
  const starts = (): unknown[] =>
    h.pushes.filter((p) => p.channel === 'push:capture-start').map((p) => p.payload)
  const reconnecting = (events: Setup['events']): unknown[] =>
    events.filter((e) => e.name === 'sdk:reconnecting').map((e) => e.payload)

  it('restarts the same stream on kError without ending the phase, and says it is reconnecting', async () => {
    const t = setup()
    t.bus.on('sdk:reconnecting', (payload) => t.events.push({ name: 'sdk:reconnecting', payload }))
    await t.sensing.startContinuous()
    capture('capture:status', 'running')
    capture('capture:error', {
      code: 'sdk-status',
      message: 'SDK processing status is kError',
      retryable: false
    })
    // Repeated signals from the same dead instance don't use up attempts.
    capture('capture:error', { code: 1, message: 'not in a valid state', retryable: false })
    expect(reconnecting(t.events)).toEqual([{ active: true, message: sensingConfig.lostMessage }])
    await vi.advanceTimersByTimeAsync(sensingConfig.restartBackoffMs[0])
    expect(starts()).toHaveLength(2)
    expect(starts()[1]).toMatchObject({ phase: 'continuous', apiKey: 'test-key' })
    capture('capture:status', 'running')
    expect(reconnecting(t.events).at(-1)).toEqual({ active: false })
    expect(t.sensing.phase()).toBe('continuous')
    expect(t.names().filter((n) => n.startsWith('sdk:checkin'))).toEqual([
      'sdk:checkin-started:continuous'
    ])
    // Raw SDK errors reach the bus for logging, marked retryable because Ovra handles them.
    expect(
      t.events
        .filter((e) => e.name === 'sdk:error')
        .every((e) => (e.payload as { retryable: boolean }).retryable)
    ).toBe(true)
    await t.sensing.stop()
  })

  it('treats the SDK log of refused frames as a dead pipeline', async () => {
    const { bindSmartSpectraIpc } = await import('@smartspectra/node-sdk/main')
    const t = setup()
    await t.sensing.startContinuous()
    const logger = vi.mocked(bindSmartSpectraIpc).mock.calls.at(-1)![1]!.logger!
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logger(
      'warn',
      'dropped frame (1 total): SmartSpectra is not in a valid state for this operation'
    )
    await vi.advanceTimersByTimeAsync(sensingConfig.restartBackoffMs[0])
    expect(starts()).toHaveLength(1) // capture wasn't running yet: start churn, not a crash
    capture('capture:status', 'running')
    logger(
      'warn',
      'dropped frame (30 total): SmartSpectra is not in a valid state for this operation'
    )
    await vi.advanceTimersByTimeAsync(sensingConfig.restartBackoffMs[0])
    expect(starts()).toHaveLength(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[smartspectra/main] dropped frame'))
    warn.mockRestore()
    await t.sensing.stop()
  })

  it('gives up with the network message after a network/auth error, and never logs the key', async () => {
    const t = setup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await t.sensing.startContinuous()
    capture('capture:status', 'running')
    capture('capture:error', {
      code: 2,
      message: 'Usage verification failed for test-key',
      retryable: false
    })
    for (const wait of sensingConfig.restartBackoffMs) {
      await vi.advanceTimersByTimeAsync(wait)
      capture('capture:error', { code: 1, message: 'not in a valid state', retryable: false })
    }
    await vi.advanceTimersByTimeAsync(0)
    const errors = t.events.filter((e) => e.name === 'sdk:error').map((e) => e.payload)
    expect(errors.at(-1)).toEqual({
      code: 'sdk-lost',
      message: sensingConfig.networkMessage,
      retryable: false
    })
    expect(JSON.stringify(errors)).not.toContain('test-key')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('test-key')
    expect(t.sensing.phase()).toBe('idle')
    warn.mockRestore()
  })

  it('gives a stream that ran a while a fresh set of restarts', async () => {
    const t = setup()
    await t.sensing.startContinuous()
    const crash = (): void =>
      capture('capture:error', { code: 8, message: 'Processing failed', retryable: false })
    for (let i = 0; i < 5; i++) {
      capture('capture:status', 'running')
      await vi.advanceTimersByTimeAsync(sensingConfig.restartHealthyMs)
      crash()
      await vi.advanceTimersByTimeAsync(sensingConfig.restartBackoffMs[0])
    }
    expect(t.sensing.phase()).toBe('continuous')
    expect(starts()).toHaveLength(6)
    await t.sensing.stop()
  })

  it('pauses the calibration cap while the SDK is reconnecting', async () => {
    const t = setup({ config: { calibrationMaxMs: 10_000 } })
    await t.sensing.startCalibration()
    capture('capture:status', 'running')
    await vi.advanceTimersByTimeAsync(4_000)
    capture('capture:error', { code: 1, message: 'not in a valid state', retryable: false })
    await vi.advanceTimersByTimeAsync(sensingConfig.restartBackoffMs[0])
    // Restart sent but slow to come up: still down, the cap stays paused.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(t.sensing.phase()).toBe('calibration')
    capture('capture:status', 'running')
    // 6 s of the cap were left when the SDK went down.
    await vi.advanceTimersByTimeAsync(5_900)
    expect(t.sensing.phase()).toBe('calibration')
    await vi.advanceTimersByTimeAsync(200)
    expect(t.sensing.phase()).toBe('idle')
  })

  it('shows "Camera reconnecting" as the calibration hint while the SDK is down', async () => {
    const t = setup()
    await t.sensing.startCalibration()
    capture('capture:status', 'running')
    capture('capture:error', { code: 1, message: 'not in a valid state', retryable: false })
    await vi.advanceTimersByTimeAsync(1000)
    const progress = t.events.filter((e) => e.name === 'sdk:calibration-progress')
    expect(progress.at(-1)?.payload).toMatchObject({ hint: sensingConfig.reconnectingText })
    await t.sensing.stop()
  })
})

describe('calibration hands over to continuous on the running stream (decision 48)', () => {
  function run(mode: 'continuous' | 'checkins'): Setup & {
    engine: ReturnType<typeof createStateEngine>
    ready: { ok: boolean }[]
  } {
    const t = setup({ config: sensingConfig })
    const engine = createStateEngine({ bus: t.bus, privacy: t.privacy })
    const ready: { ok: boolean }[] = []
    t.bus.on('state:baseline-ready', (r) => {
      ready.push(r)
      // What the session does on success.
      if (r.ok && mode === 'continuous') void t.sensing.startContinuous()
      if (r.ok && mode === 'checkins') t.sensing.startCheckins(5)
    })
    t.bus.emit('session:started', {
      id: 's',
      config: {
        activity: 'focus',
        lengthMin: 60,
        cameraMode: mode,
        checkinIntervalMin: 5,
        music: false
      },
      startedAt: Date.now(),
      status: 'calibrating',
      sensingEnabled: true
    })
    return { ...t, engine, ready }
  }
  async function calibrate(t: Setup): Promise<void> {
    await t.sensing.startCalibration()
    h.handlers['capture:validation']({ t: Date.now(), code: 0, hint: '' }, { sender: h.wc })
    for (let i = 0; i < 60 && t.sensing.phase() === 'calibration'; i++) {
      h.handlers['capture:metrics'](
        { t: Date.now(), pulse: { value: 60, stable: true, confidence: 90 } },
        { sender: h.wc }
      )
      await vi.advanceTimersByTimeAsync(1000)
    }
  }

  it('continuous: no stop/start, calibration ends and continuous starts on the same stream', async () => {
    const t = run('continuous')
    await calibrate(t)
    await vi.advanceTimersByTimeAsync(0)
    expect(t.ready).toEqual([{ ok: true }])
    expect(t.sensing.phase()).toBe('continuous')
    expect(h.pushes.map((p) => p.channel)).toEqual(['push:capture-start'])
    expect(t.names().filter((n) => n.startsWith('sdk:checkin'))).toEqual([
      'sdk:checkin-started:calibration',
      'sdk:checkin-ended:calibration',
      'sdk:checkin-started:continuous'
    ])
    await t.sensing.stop()
    t.engine.dispose()
  })

  it('check-ins: the camera still turns off after calibration', async () => {
    const t = run('checkins')
    await calibrate(t)
    await vi.advanceTimersByTimeAsync(0)
    expect(t.ready).toEqual([{ ok: true }])
    expect(t.sensing.phase()).toBe('idle')
    expect(h.pushes.map((p) => p.channel)).toEqual(['push:capture-start', 'push:capture-stop'])
    await t.sensing.stop()
    t.engine.dispose()
  })

  it('turns the camera off if the state still rejects the baseline after a hand-over', async () => {
    const t = setup({ config: sensingConfig })
    t.bus.emit('session:started', {
      id: 's',
      config: {
        activity: 'focus',
        lengthMin: 60,
        cameraMode: 'continuous',
        checkinIntervalMin: 5,
        music: false
      },
      startedAt: Date.now(),
      status: 'calibrating',
      sensingEnabled: true
    })
    // Sensing's bar passed, but the state's verdict fails (no engine here).
    t.bus.on('sdk:checkin-ended', ({ phase }) => {
      if (phase === 'calibration') t.bus.emit('state:baseline-ready', { ok: false, reason: 'x' })
    })
    await calibrate(t)
    await vi.advanceTimersByTimeAsync(0)
    expect(t.sensing.phase()).toBe('idle')
    expect(h.pushes.map((p) => p.channel)).toEqual(['push:capture-start', 'push:capture-stop'])
  })
})

describe('calibration live-pattern replay (mock capture only)', () => {
  function replay(): Setup & {
    ready: { ok: boolean; reason?: string }[]
    engine: ReturnType<typeof createStateEngine>
  } {
    const t = setup({ config: sensingConfig })
    const engine = createStateEngine({ bus: t.bus, privacy: t.privacy })
    const ready: { ok: boolean; reason?: string }[] = []
    t.bus.on('state:baseline-ready', (r) => ready.push(r))
    return { ...t, ready, engine }
  }

  function validation(code: number, hint: string): void {
    h.handlers['capture:validation']({ t: Date.now(), code, hint }, { sender: h.wc })
  }

  function pulse(): void {
    h.handlers['capture:metrics'](
      { t: Date.now(), pulse: { value: 60, stable: true, confidence: 90 } },
      { sender: h.wc }
    )
  }

  it('shows the SDK hint through 45 s of framing, then builds after 30 s of steady pulse', async () => {
    const t = replay()
    await t.sensing.startCalibration()
    for (const code of [16, 7, 17, 15, 12]) {
      validation(code, `position ${code}`)
      await vi.advanceTimersByTimeAsync(9000)
      expect(t.events.filter((e) => e.name === 'sdk:calibration-progress').at(-1)?.payload).toEqual(
        { progress: 0, hint: `position ${code}`, framing: true }
      )
    }
    expect(t.ready).toEqual([])
    validation(0, '')
    for (let sec = 0; sec < 60 && t.sensing.phase() === 'calibration'; sec++) {
      // 30 face payloads/s, with pulse in only one payload/s after a 10 s warmup.
      for (let frame = 0; frame < 30; frame++) {
        const m: MetricsSnapshot = { t: Date.now(), face: { present: true } }
        if (sec >= 10 && frame === 0) m.pulse = { value: 60, confidence: 90, stable: true }
        h.handlers['capture:metrics'](m, { sender: h.wc })
      }
      await vi.advanceTimersByTimeAsync(1000)
      if (sec === 24) {
        // Pulse from second 10: 15 of 30 steady seconds, counted only once the clock runs.
        expect(t.sensing.phase()).toBe('calibration')
        expect(t.ready).toEqual([])
        expect(
          t.events.filter((e) => e.name === 'sdk:calibration-progress').at(-1)?.payload
        ).toEqual({ progress: 0.5, hint: null, framing: false })
      }
    }
    expect(t.sensing.phase()).toBe('idle')
    expect(t.ready).toEqual([{ ok: true }])
    expect(t.engine.diagnostics()).toMatchObject({
      baseline: true,
      pulseCount: 30,
      pulseNeeded: 30
    })
    expect(t.events.filter((e) => e.name === 'sdk:checkin-ended')).toHaveLength(1)
    await t.sensing.stop()
    t.engine.dispose()
  })

  it('fails hints-only calibration at the 180 s cap, never at 90 s', async () => {
    const t = replay()
    await t.sensing.startCalibration()
    validation(7, 'Place more of the chest in view.')
    await vi.advanceTimersByTimeAsync(90_000)
    expect(t.sensing.phase()).toBe('calibration')
    expect(t.ready).toEqual([])
    await vi.advanceTimersByTimeAsync(89_999)
    expect(t.ready).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(t.sensing.phase()).toBe('idle')
    expect(t.ready).toEqual([{ ok: false, reason: 'I only got 0 of 30 s of steady heart rate.' }])
    expect(t.events.filter((e) => e.name === 'sdk:calibration-progress').at(-1)?.payload).toEqual({
      progress: 0,
      hint: 'Place more of the chest in view.',
      framing: true
    })
    expect(t.events.filter((e) => e.name === 'sdk:checkin-ended')).toHaveLength(1)
    await t.sensing.stop()
    t.engine.dispose()
  })

  it('allows insufficient steady readings until the cap even after validation passes', async () => {
    const t = replay()
    await t.sensing.startCalibration()
    validation(0, '')
    pulse()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(t.sensing.phase()).toBe('calibration')
    expect(t.ready).toEqual([])
    await vi.advanceTimersByTimeAsync(90_000)
    expect(t.ready).toEqual([{ ok: false, reason: expect.stringContaining('of 30 s') }])
    await t.sensing.stop()
    t.engine.dispose()
  })

  it('Skip starts the clock without waiting for the framing check', async () => {
    const t = replay()
    await t.sensing.startCalibration()
    validation(7, 'Place more of the chest in view.')
    await vi.advanceTimersByTimeAsync(10_000)
    t.sensing.skipFraming()
    expect(t.events.filter((e) => e.name === 'sdk:calibration-progress').at(-1)?.payload).toEqual({
      progress: 0,
      hint: 'Place more of the chest in view.',
      framing: false
    })
    for (let sec = 0; sec < 40 && t.sensing.phase() === 'calibration'; sec++) {
      pulse()
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(t.ready).toEqual([{ ok: true }])
    t.sensing.skipFraming() // no-op outside calibration
    await t.sensing.stop()
    t.engine.dispose()
  })

  it('can start the clock from a steady pulse without a validation callback', async () => {
    const t = replay()
    await t.sensing.startCalibration()
    await vi.advanceTimersByTimeAsync(45_000)
    for (let sec = 0; sec < 90; sec++) {
      pulse()
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(t.ready).toEqual([{ ok: true }])
    expect(t.sensing.phase()).toBe('idle')
    await t.sensing.stop()
    t.engine.dispose()
  })

  it('pairs calibration end on pause, cancels its clock, and respects consent revocation', async () => {
    const t = replay()
    await t.sensing.startCalibration()
    validation(0, '')
    await vi.advanceTimersByTimeAsync(20_000)
    await t.sensing.pause()
    const ended = t.events.filter((e) => e.name === 'sdk:checkin-ended')
    const progress = t.events.filter((e) => e.name === 'sdk:calibration-progress')
    await vi.advanceTimersByTimeAsync(180_000)
    expect(t.events.filter((e) => e.name === 'sdk:checkin-ended')).toEqual(ended)
    expect(t.events.filter((e) => e.name === 'sdk:calibration-progress')).toEqual(progress)
    expect(ended).toHaveLength(1)
    vi.spyOn(t.privacy, 'canUseCamera').mockReturnValue(false)
    t.bus.emit('privacy:changed', { ...DEFAULT_PRIVACY, camera: 'not-now' })
    await vi.advanceTimersByTimeAsync(0)
    expect(t.sensing.phase()).toBe('idle')
    expect(h.pushes.filter((p) => p.channel === 'push:capture-start')).toHaveLength(1)
    t.engine.dispose()
  })
})
