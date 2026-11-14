import type { CaptureDiagnostics, MetricsSnapshot } from '@shared/types'

/**
 * Per-run numbers for the padded-frame A/B (reliability §5.6): share of SDK validation callbacks
 * at code 0, seconds (1 s diagnostic buckets) with a steady pulse, and the median steady pulse.
 * Terminal only, never saved. Pulse is kept as a whole-bpm histogram so memory stays constant.
 */
export function createRunStats(t0: number): {
  diag(d: CaptureDiagnostics): void
  metrics(m: MetricsSnapshot): void
  line(t: number): string
} {
  let code0 = 0
  let codes = 0
  let steadySec = 0
  const bpm = new Map<number, number>()
  let n = 0
  const median = (): number | null => {
    let seen = 0
    for (const [v, c] of [...bpm].sort((a, b) => a[0] - b[0])) {
      seen += c
      if (seen * 2 >= n) return v
    }
    return null
  }
  return {
    diag(d) {
      for (const [code, c] of Object.entries(d.validationCodes)) {
        codes += c
        if (code === '0') code0 += c
      }
      if (d.pulse.stable > 0) steadySec++
    },
    metrics(m) {
      if (!m.pulse?.stable) return
      const v = Math.round(m.pulse.value)
      bpm.set(v, (bpm.get(v) ?? 0) + 1)
      n++
    },
    line(t) {
      const share = codes ? Math.round((code0 / codes) * 100) : 0
      return `seconds=${Math.round((t - t0) / 1000)} code0=${share}% steadyPulse=${steadySec}s medianPulse=${median() ?? '-'}`
    }
  }
}
