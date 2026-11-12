import {
  DEFAULT_PRIVACY,
  DEFAULT_SETTINGS,
  type BusEventName,
  type PrivacyService
} from '@shared/types'
import { createBus } from '../bus'
import { createSensing } from '.'

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

function setup(opts: { consent?: boolean; key?: string | null } = {}): Setup {
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
    config: { calibrationMs: 10_000, checkinMs: 5_000, returnCheckMs: 3_000, hintPersistMs: 1_000 }
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
    expect(sensing.phase()).toBe('continuous')
    expect(names()).toEqual(['sdk:checkin-started:continuous'])
    h.handlers['capture:status']('idle', { sender: h.wc })
    await Promise.all([returning, calibrating])
    expect(names()).toEqual([
      'sdk:checkin-started:continuous',
      'sdk:checkin-ended:continuous',
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

  it('ends a phase promptly if renderer startup fails', async () => {
    const { sensing, names } = setup()
    await sensing.startReturnCheck()
    h.handlers['capture:error'](
      { code: 'start-failed', message: 'Video unavailable', retryable: true },
      { sender: h.wc }
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(sensing.phase()).toBe('idle')
    expect(names()).toEqual([
      'sdk:checkin-started:return-check',
      'sdk:error',
      'sdk:checkin-ended:return-check'
    ])
  })

  it('calibration emits progress and ends on time', async () => {
    const { sensing, events, names } = setup()
    await sensing.startCalibration()
    expect(sensing.phase()).toBe('calibration')
    await vi.advanceTimersByTimeAsync(10_000)
    const progress = events
      .filter((e) => e.name === 'sdk:calibration-progress')
      .map((e) => e.payload)
    expect(progress.length).toBeGreaterThanOrEqual(10)
    expect(progress.at(-1)).toEqual({ progress: 1, hint: null })
    expect(names()).toEqual(['sdk:checkin-started:calibration', 'sdk:checkin-ended:calibration'])
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

  it('return check hands back to continuous mode', async () => {
    const { sensing, names } = setup()
    await sensing.startContinuous()
    await sensing.startReturnCheck()
    expect(sensing.phase()).toBe('return-check')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(sensing.phase()).toBe('continuous')
    expect(names()).toEqual([
      'sdk:checkin-started:continuous',
      'sdk:checkin-ended:continuous',
      'sdk:checkin-started:return-check',
      'sdk:checkin-ended:return-check',
      'sdk:checkin-started:continuous'
    ])
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
