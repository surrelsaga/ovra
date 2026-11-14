import { faceBox, headRollDeg, mergeSnapshots, reduceMetrics } from './reduce'

const frame = { width: 1000, height: 500 }

/** 478 points, with the outer eye corners (33 = subject's right, 263 = left) set explicitly. */
function face(
  right: { x: number; y: number },
  left: { x: number; y: number }
): { x: number; y: number }[] {
  const pts = Array.from({ length: 478 }, () => ({ x: 500, y: 250 }))
  pts[33] = right
  pts[263] = left
  return pts
}

describe('headRollDeg', () => {
  it('is 0 for a level head', () => {
    expect(headRollDeg(face({ x: 400, y: 200 }, { x: 600, y: 200 }))).toBeCloseTo(0)
  })
  it('is positive when the right ear goes down (right eye lower in the image)', () => {
    expect(headRollDeg(face({ x: 400, y: 300 }, { x: 600, y: 100 }))).toBeCloseTo(45)
    expect(headRollDeg(face({ x: 400, y: 100 }, { x: 600, y: 300 }))).toBeCloseTo(-45)
  })
  it('is undefined without the eye corners', () => {
    expect(headRollDeg([{ x: 1, y: 1 }])).toBeUndefined()
  })
})

describe('faceBox', () => {
  it('normalises the centre and gives height as a fraction of the frame', () => {
    const box = faceBox(
      [
        { x: 400, y: 100 },
        { x: 600, y: 300 }
      ],
      frame
    )
    expect(box).toEqual({ center: { x: 0.5, y: 0.4 }, size: 0.4 })
  })
  it('rounds geometry to coarse steps and rejects invalid coordinates', () => {
    const box = faceBox(
      [
        { x: 413, y: 111 },
        { x: 623, y: 303 }
      ],
      frame
    )!
    expect(box.center.x).toBeCloseTo(0.52)
    expect(box.center.y).toBeCloseTo(0.41)
    expect(box.size).toBeCloseTo(0.38)
    expect(faceBox([{ x: NaN, y: Infinity }], frame)).toBeUndefined()
  })
  it('is undefined with no points', () => {
    expect(faceBox([], frame)).toBeUndefined()
  })
})

describe('reduceMetrics', () => {
  const decoded = {
    cardio: {
      pulseRate: [
        { value: 70, confidence: 50, stable: false },
        { value: 62, confidence: 90, stable: true }
      ],
      hrv: [{ rmssd: 80, meanNn: 900, sdnn: 50, baevsky: 0.3, confidence: 70, stable: true }]
    },
    face: {
      landmarks: [{ value: face({ x: 400, y: 200 }, { x: 600, y: 200 }) }],
      blinking: [{ detected: false }, { detected: true }],
      talking: [{ detected: false }],
      expression: [
        {
          scores: [
            { type: 6, confidence: 80 },
            { type: 5, confidence: 15 }
          ]
        }
      ]
    }
  }

  it('keeps the latest readings and only derived face values', () => {
    const s = reduceMetrics(decoded as never, frame, 123)
    expect(s.t).toBe(123)
    expect(s.pulse).toEqual({ value: 62, confidence: 90, stable: true })
    expect(s.breathing).toBeUndefined()
    expect(s.hrv?.rmssd).toBe(80)
    expect(s.face).toMatchObject({
      present: true,
      blinking: true,
      talking: false,
      expressions: { neutral: 80, happy: 15 },
      headRollDeg: 0
    })
    expect(JSON.stringify(s)).not.toContain('landmarks')
    expect(Object.keys(s.face ?? {}).sort()).toEqual(
      ['blinking', 'center', 'expressions', 'headRollDeg', 'present', 'size', 'talking'].sort()
    )
  })

  it('keeps the latest non-empty landmark list inside a payload', () => {
    const s = reduceMetrics(
      {
        face: {
          landmarks: [
            { value: [] },
            {
              value: [
                { x: 400, y: 100 },
                { x: 600, y: 300 }
              ]
            },
            { value: [] }
          ]
        }
      } as never,
      frame,
      1
    )
    expect(s.face).toMatchObject({ center: { x: 0.5, y: 0.4 }, size: 0.4 })
    expect(s.face).not.toHaveProperty('landmarks')
  })

  it('reports a face object as present without landmarks or derived geometry', () => {
    expect(reduceMetrics({ face: {} } as never, frame, 1).face).toEqual({ present: true })
    expect(reduceMetrics({} as never, frame, 1).face).toBeUndefined()
  })
})

describe('mergeSnapshots', () => {
  it('keeps landmarks from any merged payload, using the latest geometry', () => {
    const a = { t: 1, face: { present: true } }
    const b = { t: 2, face: { present: true, center: { x: 0.5, y: 0.5 }, size: 0.2 } }
    const merged = mergeSnapshots(mergeSnapshots(a, b), { t: 3, face: { present: true } })
    expect(merged.face).toEqual(b.face)
    expect(mergeSnapshots(merged, { t: 4 }).face).toEqual(b.face)
    const newer = { t: 5, face: { present: true, center: { x: 0.6, y: 0.5 }, size: 0.3 } }
    expect(mergeSnapshots(merged, newer).face).toEqual(newer.face)
  })

  it('keeps latest values and ORs blinking/talking between sends', () => {
    const a = {
      t: 1,
      pulse: { value: 60, confidence: 80, stable: true },
      face: { present: true, blinking: true }
    }
    const b = { t: 2, face: { present: true, blinking: false, talking: false } }
    expect(mergeSnapshots(a, b)).toEqual({
      t: 2,
      pulse: a.pulse,
      face: { present: true, blinking: true, talking: false }
    })
    expect(mergeSnapshots(null, b)).toBe(b)
    expect(
      mergeSnapshots({ t: 1, face: { present: true, expressions: { happy: 80 } } }, b).face
    ).toMatchObject({ expressions: { happy: 80 } })
  })
})
