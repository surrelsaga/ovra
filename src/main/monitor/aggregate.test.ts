import { createMonitorCounters, summarizeDiagnostics, rate } from './aggregate'
import { emptyMonitorCounts } from '@shared/diagnostics'
import type { CaptureDiagnostics } from '@shared/types'

function bucket(t: number, payloads: number): CaptureDiagnostics {
  return {
    ...emptyMonitorCounts(),
    t,
    phase: 'continuous',
    payloads,
    processing: 'kRunning',
    validation: null
  }
}

it('weights confidence by reading count and handles missing readings', () => {
  const counts = emptyMonitorCounts()
  counts.payloads = 3
  counts.pulse = { present: 2, stable: 1, confidenceSum: 120, confidenceCount: 2 }
  const result = summarizeDiagnostics(counts, 1)
  expect(result.pulse).toEqual({ present: 2, stable: 1, confidence: 60 })
  expect(result.breathing.confidence).toBeNull()
  expect(rate(result.pulse.stable, result.payloads)).toBe(33)
  expect(rate(0, 0)).toBe(0)
})

it('expires rolling counts, keeps phase totals and resets them at a phase boundary', () => {
  const counts = createMonitorCounters(0)
  counts.phase('continuous', 0)
  const a = bucket(1000, 20)
  a.snapshots = 4
  a.validationCodes = { 0: 10, 7: 2 }
  a.pulse = { present: 10, stable: 5, confidenceSum: 800, confidenceCount: 10 }
  counts.add(a)
  const b = bucket(9000, 10)
  b.pulse = { present: 10, stable: 0, confidenceSum: 600, confidenceCount: 10 }
  b.validationCodes = { 7: 3 }
  counts.add(b)
  expect(counts.read(10_000)).toMatchObject({
    recent: {
      payloads: 30,
      snapshots: 4,
      pulse: { confidence: 70 },
      validationCodes: { 0: 10, 7: 5 }
    },
    phaseMetrics: { payloads: 30 }
  })
  expect(counts.read(11_000)).toMatchObject({
    recent: { payloads: 10, pulse: { confidence: 60 }, validationCodes: { 7: 3 } },
    phaseMetrics: { payloads: 30 }
  })
  counts.phase('idle', 12_000)
  expect(counts.read(12_000).phaseMetrics.payloads).toBe(0)
  expect(counts.read(20_000).recent.payloads).toBe(0)
})
