import { DEFAULT_PRIVACY, type CaptureStartRequest } from '@shared/types'

const h = vi.hoisted(() => ({
  handlers: {} as Record<string, (req?: CaptureStartRequest) => void>,
  events: {} as Record<string, (...args: unknown[]) => void>,
  send: vi.fn(),
  track: { stop: vi.fn(), readyState: 'live', getSettings: () => ({ width: 1280, height: 720 }) },
  destroy: vi.fn()
}))

// No SDK code runs; even decoding is replaced with an in-memory fixture.
vi.mock('@smartspectra/node-sdk/messages', () => ({ decodeMetrics: (payload: unknown) => payload }))
vi.mock('@smartspectra/node-sdk/renderer', () => ({
  breathingMetrics: [],
  cardioMetrics: [],
  faceMetrics: [],
  ProcessingStatus: { kIdle: 0, kStarting: 1, kRunning: 2, kStopping: 3, kError: 5 },
  SmartSpectraSDK: vi.fn(function (this: Record<string, unknown>) {
    this.processingStatus = 0
    this.on = (name: string, fn: (...args: unknown[]) => void) => (h.events[name] = fn)
    this.useMediaStream = vi.fn()
    this.start = async () => {
      this.processingStatus = 2
      h.events.streamAvailable({ getVideoTracks: () => [h.track], getTracks: () => [h.track] })
    }
    this.stop = async () => {
      this.processingStatus = 0
    }
    this.destroy = h.destroy
  })
}))

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  vi.resetModules()
  // These cases use the unpadded camera; the shrunk frame is covered by config.test.ts.
  vi.stubEnv('RENDERER_VITE_OVRA_LIVE_SCALE', '1')
  h.send.mockClear()
  h.destroy.mockClear()
  h.track.readyState = 'live'
  h.track.stop.mockImplementation(() => {
    h.track.readyState = 'ended'
  })
  vi.stubGlobal('window', {
    ovra: {
      send: h.send,
      on: (channel: string, fn: (req?: CaptureStartRequest) => void) => (h.handlers[channel] = fn)
    }
  })
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [h.track] }) }
  })
  await import('./main')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function start(diagnostics = false, cameraId = ''): Promise<void> {
  h.track.readyState = 'live'
  h.handlers['push:capture-start']({
    phase: 'continuous',
    apiKey: 'unit-test-only',
    source: { kind: 'camera', cameraId },
    telemetry: DEFAULT_PRIVACY.telemetry,
    face: false,
    diagnostics
  })
  await vi.advanceTimersByTimeAsync(0)
}
async function stop(): Promise<void> {
  h.handlers['push:capture-stop']()
  await vi.advanceTimersByTimeAsync(0)
}

it('ends every acquired track on stop and sends no diagnostics in a normal run', async () => {
  await start()
  expect(h.send).toHaveBeenCalledWith('capture:status', 'running')
  expect(h.send).not.toHaveBeenCalledWith('capture:status', 'idle')
  await stop()
  expect(h.track.stop).toHaveBeenCalled()
  expect(h.destroy).toHaveBeenCalledOnce()
  expect(h.send).toHaveBeenLastCalledWith('capture:status', 'idle')
  expect(h.send.mock.calls.some(([channel]) => channel === 'capture:diag')).toBe(false)
})

it('leaves throttle/merge output identical while counting raw payloads and all validation events', async () => {
  const run = async (diagnostics: boolean): Promise<unknown[]> => {
    vi.setSystemTime(1_000_000)
    h.send.mockClear()
    await start(diagnostics)
    for (let i = 0; i < 20; i++) {
      h.events.metrics(
        {
          cardio: { pulseRate: [{ value: 99, confidence: 75, stable: i % 2 === 0 }] },
          face: { landmarks: [] }
        },
        Date.now() * 1000
      )
      h.events.validationStatus(7, Date.now(), 'Place more of the chest in view.')
      await vi.advanceTimersByTimeAsync(50)
    }
    const metrics = h.send.mock.calls
      .filter(([channel]) => channel === 'capture:metrics')
      .map(([, snapshot]) => snapshot)
    if (diagnostics) {
      const diag = h.send.mock.calls.find(([channel]) => channel === 'capture:diag')?.[1]
      expect(diag).toMatchObject({
        payloads: 20,
        processing: 'kRunning',
        pulse: { present: 20, stable: 10, confidenceSum: 1500, confidenceCount: 20 },
        face: { object: 20, landmarks: 0, present: 20 },
        validationCodes: { 7: 20 }
      })
      expect(diag.pulse).not.toHaveProperty('value')
      expect(diag.face).not.toHaveProperty('expressions.happy')
    }
    await stop()
    if (diagnostics)
      expect(
        h.send.mock.calls
          .filter(([channel]) => channel === 'capture:diag')
          .reduce((sum, [, diag]) => sum + diag.snapshots, 0)
      ).toBe(metrics.length)
    return metrics
  }
  const normal = await run(false)
  expect(await run(true)).toEqual(normal)
})

it('forwards raw validation and the SDK frame timestamp instead of refreshing a frozen frame', async () => {
  await start()
  const timestampUs = Date.now() * 1000
  h.events.validationStatus(7, timestampUs, 'Chest not visible')
  h.events.metrics({ face: {} }, timestampUs)
  await vi.advanceTimersByTimeAsync(250)
  h.events.metrics({ face: {} }, timestampUs)
  await vi.advanceTimersByTimeAsync(250)
  const snapshots = h.send.mock.calls
    .filter(([channel]) => channel === 'capture:metrics')
    .map(([, snapshot]) => snapshot)
  expect(snapshots).toEqual([
    { t: timestampUs / 1000, validationCode: 7, face: { present: true } },
    { t: timestampUs / 1000, validationCode: 7, face: { present: true } }
  ])
  await stop()
})

it('reports SDK errors and the kError status to main without stopping itself', async () => {
  await start()
  h.events.error(1, 'SmartSpectra is not in a valid state for this operation', false)
  h.events.processingStatus(5)
  await vi.advanceTimersByTimeAsync(0)
  expect(h.send).toHaveBeenCalledWith('capture:error', {
    code: 1,
    message: 'SmartSpectra is not in a valid state for this operation',
    retryable: false
  })
  expect(h.send).toHaveBeenCalledWith('capture:error', {
    code: 'sdk-status',
    message: 'SDK processing status is kError',
    retryable: false
  })
  // Main decides whether to restart or give up.
  expect(h.send).not.toHaveBeenCalledWith('capture:status', 'stopping')
  expect(h.destroy).not.toHaveBeenCalled()
  await stop()
})

it('opens the selected camera itself, so the SDK cannot choose the system default', async () => {
  await start(false, 'usb')
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
    audio: false,
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
      deviceId: { exact: 'usb' }
    }
  })
  expect(h.send).toHaveBeenCalledWith('capture:status', 'running')
  await stop()
})
