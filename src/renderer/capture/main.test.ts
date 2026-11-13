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
  ProcessingStatus: { kIdle: 0, kStarting: 1, kRunning: 2, kStopping: 3 },
  SmartSpectraSDK: vi.fn(function (this: Record<string, unknown>) {
    this.processingStatus = 0
    this.on = (name: string, fn: (...args: unknown[]) => void) => (h.events[name] = fn)
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
  await import('./main')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function start(diagnostics = false): Promise<void> {
  h.track.readyState = 'live'
  h.handlers['push:capture-start']({
    phase: 'continuous',
    apiKey: 'unit-test-only',
    source: { kind: 'camera' },
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
      h.events.metrics({
        cardio: { pulseRate: [{ value: 99, confidence: 75, stable: i % 2 === 0 }] },
        face: { landmarks: [] }
      })
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
