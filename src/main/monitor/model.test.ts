import { createBus } from '../bus'
import { createMonitorModel } from './model'
import { formatMonitor } from './format'
import { emptyMonitorCounts } from '@shared/diagnostics'
import type { CaptureDiagnostics, Session, StateDiagnostics, StateUpdate } from '@shared/types'

it('observes flags, session sources and metrics, then removes its listeners', () => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  try {
    const bus = createBus()
    const log = vi.fn()
    const state: StateUpdate = {
      t: Date.now(),
      situation: null,
      confidence: 0,
      seatedMinutes: 0,
      away: false,
      trend: 'steady'
    }
    const diagnostics: StateDiagnostics = {
      pulseCount: 2,
      pulseSpanSec: 5,
      pulseNeeded: 5,
      pulseSpanNeededSec: 15,
      awayNoFaceSec: 20,
      baseline: false,
      baselineFailure: 'too few steady pulse readings',
      lastFace: null,
      phaseStart: Date.now(),
      phase: 'continuous',
      paused: false
    }
    const session: Session = {
      id: 's',
      startedAt: Date.now(),
      status: 'running',
      sensingEnabled: true,
      config: {
        activity: 'focus',
        lengthMin: 1,
        cameraMode: 'continuous',
        checkinIntervalMin: 5,
        music: false
      }
    }
    const model = createMonitorModel(
      {
        bus,
        state: {
          current: () => state,
          diagnostics: () => diagnostics,
          lastWindow: () => ({ n: 1, line: 'signal=tense rule="pulse up, pulse only"' })
        },
        sensing: { phase: () => 'continuous' },
        session: { current: () => session },
        music: {
          status: () => ({
            available: false,
            leaveAlone: true,
            target: null,
            nowPlaying: null,
            scoringQueue: 0,
            scoredCount: 0,
            playlist: { uri: 'spotify:playlist:test', name: 'Focus\n"mix"', played: 3 }
          })
        }
      },
      log
    )
    vi.advanceTimersByTime(5000)
    const diag: CaptureDiagnostics = {
      ...emptyMonitorCounts(),
      t: Date.now(),
      phase: 'continuous',
      payloads: 140,
      snapshots: 20,
      processing: 'kRunning',
      validation: { t: Date.now(), code: 7, hint: 'Place more of the chest in view.' }
    }
    diag.pulse = { present: 140, stable: 0, confidenceSum: 7000, confidenceCount: 140 }
    diag.face.object = 140
    diag.validationCodes = { 7: 140 }
    bus.emit('monitor:diag', diag)
    bus.emit('monitor:capture-status', { status: 'running' })
    bus.emit('monitor:session-change', {
      t: Date.now(),
      status: 'running',
      reason: 'baseline failed',
      source: 'state:baseline-ready'
    })
    bus.emit('state:updated', state)
    bus.emit('state:updated', state)
    expect(log.mock.calls.filter(([line]) => line.includes('window signal=tense'))).toHaveLength(1)
    bus.emit('monitor:music', {
      action: 'switch',
      reason: 'song count',
      from: 'Focus\n"mix"',
      to: 'Evening',
      playlist: 'Evening',
      played: 0
    })
    expect(log.mock.calls.at(-1)?.[0]).toContain('music switch reason="song count"')
    expect(log.mock.calls.at(-1)?.[0]).not.toContain('\n')
    const snapshot = model.snapshot()
    expect(snapshot).toMatchObject({
      processing: 'kRunning',
      capture: 'running',
      recent: { payloads: 140, snapshots: 20, durationSec: 5 },
      state: { secondsSinceFace: null, awayCountdownSec: 15, lastUpdated: 1_000_000 },
      session: { remainingSec: 55, lastChange: { source: 'state:baseline-ready' } },
      music: { available: false, leaveAlone: true }
    })
    const text = formatMonitor(snapshot)
    expect(text).toContain('last10{seconds=5.0 raw/s=28.0 sent/s=4.0 pulse=100/0/50')
    expect(text).toContain('face=100/0/0/0/0/0')
    expect(text).toContain('source')
    expect(text).toContain('playlist="Focus\\n\\"mix\\"" played=3')
    expect(text).not.toContain('\n')
    bus.emit('sdk:validation', diag.validation!)
    bus.emit('sdk:validation', diag.validation!)
    expect(log.mock.calls.filter(([line]) => line.includes('validation=7'))).toHaveLength(1)
    const calls = log.mock.calls.length
    model.dispose()
    bus.emit('state:baseline-ready', { ok: true })
    expect(log).toHaveBeenCalledTimes(calls)
  } finally {
    vi.useRealTimers()
  }
})
