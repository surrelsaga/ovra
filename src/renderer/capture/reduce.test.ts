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

  it('reports no face when landmarks are missing', () => {
    expect(reduceMetrics({ face: {} } as never, frame, 1).face).toEqual({ present: false })
  })
})

describe('mergeSnapshots', () => {
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
  })
})
