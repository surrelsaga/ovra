import type { MonitorCounts } from './types'

export function emptyMonitorCounts(): MonitorCounts {
  const signal = (): MonitorCounts['pulse'] => ({
    present: 0,
    stable: 0,
    confidenceSum: 0,
    confidenceCount: 0
  })
  return {
    payloads: 0,
    snapshots: 0,
    pulse: signal(),
    breathing: signal(),
    hrv: signal(),
    face: { object: 0, landmarks: 0, present: 0, blinking: 0, talking: 0, expressions: 0 },
    validationCodes: {}
  }
}

/** Merge only the allowed counters, never extra fields from an IPC payload. */
export function addMonitorCounts(total: MonitorCounts, item: MonitorCounts): void {
  total.payloads += item.payloads
  total.snapshots += item.snapshots
  for (const key of ['pulse', 'breathing', 'hrv'] as const) {
    for (const field of ['present', 'stable', 'confidenceSum', 'confidenceCount'] as const)
      total[key][field] += item[key][field]
  }
  for (const key of Object.keys(total.face) as (keyof MonitorCounts['face'])[])
    total.face[key] += item.face[key]
  for (const [code, count] of Object.entries(item.validationCodes))
    total.validationCodes[code] = (total.validationCodes[code] ?? 0) + count
}
