import type {
  CaptureDiagnostics,
  MonitorCounts,
  MonitorMetricSummary,
  SensingPhase
} from '@shared/types'
import { addMonitorCounts, emptyMonitorCounts } from '@shared/diagnostics'
import { monitorConfig } from '@shared/monitor-config'

export function summarizeDiagnostics(
  counts: MonitorCounts,
  durationSec: number
): MonitorMetricSummary {
  const signal = (key: 'pulse' | 'breathing' | 'hrv'): MonitorMetricSummary['pulse'] => ({
    present: counts[key].present,
    stable: counts[key].stable,
    confidence: counts[key].confidenceCount
      ? counts[key].confidenceSum / counts[key].confidenceCount
      : null
  })
  return {
    payloads: counts.payloads,
    snapshots: counts.snapshots,
    durationSec,
    pulse: signal('pulse'),
    breathing: signal('breathing'),
    hrv: signal('hrv'),
    face: { ...counts.face },
    validationCodes: { ...counts.validationCodes }
  }
}

export function rate(count: number, payloads: number): number {
  return payloads ? Math.round((count / payloads) * 100) : 0
}

/** Only ten seconds of buckets plus one phase total are retained, even in long continuous runs. */
export function createMonitorCounters(startedAt: number): {
  phase(phase: SensingPhase, t: number): void
  add(item: CaptureDiagnostics): void
  read(t: number): { recent: MonitorMetricSummary; phaseMetrics: MonitorMetricSummary }
} {
  let phase: SensingPhase = 'idle'
  let phaseStart = startedAt
  let total = emptyMonitorCounts()
  let recent: CaptureDiagnostics[] = []
  return {
    phase(next, t) {
      phase = next
      phaseStart = t
      total = emptyMonitorCounts()
    },
    add(item) {
      recent.push(item)
      if (item.phase === phase) addMonitorCounts(total, item)
    },
    read(t) {
      recent = recent.filter((d) => d.t > t - monitorConfig.rollingMs)
      const rolling = emptyMonitorCounts()
      for (const d of recent) addMonitorCounts(rolling, d)
      return {
        recent: summarizeDiagnostics(
          rolling,
          Math.max(0, Math.min(monitorConfig.rollingMs, t - startedAt) / 1000)
        ),
        phaseMetrics: summarizeDiagnostics(total, Math.max(0, (t - phaseStart) / 1000))
      }
    }
  }
}
