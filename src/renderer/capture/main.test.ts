import { DEFAULT_PRIVACY, type CaptureStartRequest } from '@shared/types'

const h = vi.hoisted(() => ({
  handlers: {} as Record<string, (req?: CaptureStartRequest) => void>,
  send: vi.fn(),
  track: { stop: vi.fn(), readyState: 'live', getSettings: () => ({ width: 1280, height: 720 }) },
  destroy: vi.fn()
}))

vi.mock('@smartspectra/node-sdk/renderer', () => ({
  breathingMetrics: [],
  cardioMetrics: [],
  faceMetrics: [],
  ProcessingStatus: { kStarting: 1, kRunning: 2, kStopping: 3 },
  SmartSpectraSDK: vi.fn(function (this: Record<string, unknown>) {
    const events: Record<string, (stream: unknown) => void> = {}
    this.processingStatus = 0
    this.on = (name: string, fn: (stream: unknown) => void) => (events[name] = fn)
    // Entire SDK is mocked: no camera or native SDK can run in this test.
    this.start = async () =>
      events.streamAvailable({
        getVideoTracks: () => [h.track],
        getTracks: () => [h.track]
      })
    this.stop = async () => {}
    this.destroy = h.destroy
  })
}))

it('does not acknowledge idle during startup, then ends every acquired track on stop', async () => {
  vi.useFakeTimers()
  h.track.stop.mockImplementation(() => {
    h.track.readyState = 'ended'
  })
  vi.stubGlobal('window', {
    ovra: {
      send: h.send,
      on: (channel: string, fn: (req?: CaptureStartRequest) => void) => (h.handlers[channel] = fn)
    }
  })
  try {
    await import('./main')
    h.handlers['push:capture-start']({
      phase: 'continuous',
      apiKey: 'unit-test-only',
      source: { kind: 'camera' },
      telemetry: DEFAULT_PRIVACY.telemetry,
      face: false
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.send).toHaveBeenCalledWith('capture:status', 'running')
    expect(h.send).not.toHaveBeenCalledWith('capture:status', 'idle')
    h.handlers['push:capture-stop']()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.track.stop).toHaveBeenCalled()
    expect(h.destroy).toHaveBeenCalledOnce()
    expect(h.send).toHaveBeenLastCalledWith('capture:status', 'idle')
  } finally {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})
