// Owner: Agent A. Pure reduction of decoded SDK metrics to MetricsSnapshot.
// Landmarks are used here only to derive face values; they never leave the capture renderer.
import type { decodeMetrics } from '@smartspectra/node-sdk/messages'
import type { Expression, FaceSnapshot, HrvReading, MetricsSnapshot, Reading } from '@shared/types'

type Metrics = ReturnType<typeof decodeMetrics>
type Point = { x?: number | null; y?: number | null }

/** SDK ExpressionType enum order (0 = UNSPECIFIED). */
const EXPRESSIONS: (Expression | null)[] = [
  null,
  'angry',
  'contempt',
  'disgust',
  'fear',
  'happy',
  'neutral',
  'sad',
  'surprise'
]

const RIGHT_EYE_OUTER = 33
const LEFT_EYE_OUTER = 263

export interface FrameSize {
  width: number
  height: number
}

function reading(
  r: { value?: number | null; confidence?: number | null; stable?: boolean | null } | undefined
): Reading | undefined {
  if (r?.value == null) return undefined
  return { value: r.value, confidence: r.confidence ?? 0, stable: !!r.stable }
}

/**
 * Head roll in degrees from the outer eye corners. Positive = right ear down
 * (the subject's right eye, landmark 33, sits lower in the image than the left one).
 */
export function headRollDeg(points: Point[]): number | undefined {
  const a = points[RIGHT_EYE_OUTER]
  const b = points[LEFT_EYE_OUTER]
  if (a?.x == null || a.y == null || b?.x == null || b.y == null) return undefined
  return (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI
}

/** Normalised bounding-box centre (0–1) and height as a fraction of the frame height. */
export function faceBox(
  points: Point[],
  frame: FrameSize
): { center: { x: number; y: number }; size: number } | undefined {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x == null || p.y == null) continue
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  if (minX === Infinity) return undefined
  return {
    center: { x: (minX + maxX) / 2 / frame.width, y: (minY + maxY) / 2 / frame.height },
    size: (maxY - minY) / frame.height
  }
}

function reduceFace(face: NonNullable<Metrics['face']>, frame: FrameSize): FaceSnapshot {
  const points = face.landmarks?.at(-1)?.value ?? []
  const out: FaceSnapshot = { present: points.length > 0 }
  if (face.blinking?.length) out.blinking = face.blinking.some((d) => !!d.detected)
  if (face.talking?.length) out.talking = face.talking.some((d) => !!d.detected)
  const scores = face.expression?.at(-1)?.scores
  if (scores?.length) {
    out.expressions = {}
    for (const s of scores) {
      const name =
        typeof s.type === 'string'
          ? ((s.type as string).toLowerCase() as Expression)
          : EXPRESSIONS[s.type ?? 0]
      if (name && s.confidence != null) out.expressions[name] = s.confidence
    }
  }
  if (points.length) {
    out.headRollDeg = headRollDeg(points)
    Object.assign(out, faceBox(points, frame))
  }
  return out
}

/** Reduce one decoded metrics payload. Only derived face values are kept. */
export function reduceMetrics(m: Metrics, frame: FrameSize, t: number): MetricsSnapshot {
  const snap: MetricsSnapshot = { t }
  const pulse = reading(m.cardio?.pulseRate?.at(-1))
  if (pulse) snap.pulse = pulse
  const breathing = reading(m.breathing?.rate?.at(-1))
  if (breathing) snap.breathing = breathing
  const h = m.cardio?.hrv?.at(-1)
  if (h?.rmssd != null) {
    const hrv: HrvReading = {
      rmssd: h.rmssd,
      meanNn: h.meanNn ?? 0,
      sdnn: h.sdnn ?? 0,
      baevsky: h.baevsky ?? 0,
      confidence: h.confidence ?? 0,
      stable: !!h.stable
    }
    snap.hrv = hrv
  }
  if (m.face) snap.face = reduceFace(m.face, frame)
  return snap
}

/**
 * Merge a newer snapshot into the pending (throttled) one: latest values win,
 * blinking/talking are OR-ed so short blinks between sends aren't lost.
 */
export function mergeSnapshots(
  prev: MetricsSnapshot | null,
  next: MetricsSnapshot
): MetricsSnapshot {
  if (!prev) return next
  const out: MetricsSnapshot = { ...prev, ...next }
  if (prev.face || next.face) {
    const face: FaceSnapshot = { ...prev.face, ...next.face, present: !!next.face?.present }
    if (prev.face?.blinking || next.face?.blinking) face.blinking = true
    if (prev.face?.talking || next.face?.talking) face.talking = true
    out.face = face
  }
  return out
}
