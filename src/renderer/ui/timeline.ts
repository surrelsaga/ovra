// Owner: Agent E. Mood timeline maths (pure).
import type { MoodPoint } from '@shared/types'

export type TimelineKind = MoodPoint['situation']

export const SITUATION_LABEL: Record<TimelineKind, string> = {
  focused: 'Focused',
  tense: 'Tense',
  crashing: 'Rough patch',
  low: 'Low energy',
  good: 'Good mood',
  away: 'Away',
  unknown: 'No reading'
}

/** Each point holds until the next one. Merges neighbours with the same label. */
export function timelineSegments(
  points: MoodPoint[],
  start: number,
  end: number
): { situation: TimelineKind; fraction: number }[] {
  const total = end - start
  if (total <= 0 || points.length === 0) return []
  const sorted = [...points].sort((a, b) => a.t - b.t)
  const out: { situation: TimelineKind; fraction: number }[] = []
  if (sorted[0].t > start)
    out.push({ situation: 'unknown', fraction: (sorted[0].t - start) / total })
  sorted.forEach((p, i) => {
    const from = Math.max(p.t, start)
    const to = Math.min(sorted[i + 1]?.t ?? end, end)
    if (to <= from) return
    const last = out[out.length - 1]
    if (last?.situation === p.situation) last.fraction += (to - from) / total
    else out.push({ situation: p.situation, fraction: (to - from) / total })
  })
  return out
}
