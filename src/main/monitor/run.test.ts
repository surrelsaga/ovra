import { emptyMonitorCounts } from '@shared/diagnostics'
import type { CaptureDiagnostics } from '@shared/types'
import { createRunStats } from './run'

const diag = (codes: Record<string, number>, stable: number): CaptureDiagnostics => {
  const d: CaptureDiagnostics = {
    ...emptyMonitorCounts(),
    t: 0,
    phase: 'continuous',
    processing: 'kRunning',
    validation: null,
    validationCodes: codes
  }
  d.pulse.stable = stable
  return d
}

it('counts code 0 share, steady seconds and the median steady pulse', () => {
  const run = createRunStats(0)
  expect(run.line(0)).toBe('seconds=0 code0=0% steadyPulse=0s medianPulse=-')
  run.diag(diag({ '0': 20, '7': 10 }, 3))
  run.diag(diag({ '7': 30 }, 0))
  run.diag(diag({ '0': 30 }, 1))
  for (const value of [70.4, 71, 90, 72.2])
    run.metrics({ t: 0, pulse: { value, confidence: 50, stable: true } })
  run.metrics({ t: 0, pulse: { value: 150, confidence: 10, stable: false } })
  expect(run.line(3000)).toBe('seconds=3 code0=56% steadyPulse=2s medianPulse=71')
})
