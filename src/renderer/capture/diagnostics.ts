import type { decodeMetrics } from '@smartspectra/node-sdk/messages'
import type {
  CaptureDiagnostics,
  MetricsSnapshot,
  MonitorCounts,
  SensingPhase
} from '@shared/types'
import { emptyMonitorCounts } from '@shared/diagnostics'

type Metric = { confidence?: number | null; stable?: boolean | null }

export function emptyDiagnostics(
  phase: Exclude<SensingPhase, 'idle'>,
  t = Date.now()
): CaptureDiagnostics {
  return { ...emptyMonitorCounts(), t, phase, processing: 'unknown', validation: null }
}

function countSignal(out: MonitorCounts['pulse'], readings: Metric[] | null | undefined): void {
  if (!readings?.length) return
  out.present++
  if (readings.some((r) => r.stable === true)) out.stable++
  for (const r of readings)
    if (typeof r.confidence === 'number' && Number.isFinite(r.confidence)) {
      out.confidenceSum += Math.max(0, Math.min(100, r.confidence))
      out.confidenceCount++
    }
}

/** Read raw payload shape before throttling; retain only counts and confidence sums. */
export function addPayload(
  out: CaptureDiagnostics,
  raw: Pick<ReturnType<typeof decodeMetrics>, 'cardio' | 'breathing' | 'face'>,
  snapshot: MetricsSnapshot
): void {
  out.payloads++
  countSignal(out.pulse, raw.cardio?.pulseRate)
  countSignal(out.breathing, raw.breathing?.rate)
  countSignal(out.hrv, raw.cardio?.hrv)
  if (!raw.face) return
  out.face.object++
  if (raw.face.landmarks?.some((r) => (r.value?.length ?? 0) > 0)) out.face.landmarks++
  if (snapshot.face?.present) out.face.present++
  if (raw.face.blinking != null) out.face.blinking++
  if (raw.face.talking != null) out.face.talking++
  if (raw.face.expression?.some((r) => r.scores?.length)) out.face.expressions++
}
