import { addPayload, emptyDiagnostics } from './diagnostics'

it('counts raw fields separately from the reduced face-present flag', () => {
  const d = emptyDiagnostics('calibration', 1)
  addPayload(
    d,
    {
      cardio: {
        pulseRate: [
          { value: 99, stable: true, confidence: 80 },
          { value: 98, stable: false, confidence: 60 }
        ]
      },
      face: {
        landmarks: [],
        blinking: [],
        talking: [],
        expression: [{ scores: [{ type: 5, confidence: 92 }] }]
      }
    },
    { t: 1, face: { present: false, expressions: { happy: 92 } } }
  )
  expect(d.pulse).toEqual({ present: 1, stable: 1, confidenceSum: 140, confidenceCount: 2 })
  expect(d.face).toEqual({
    object: 1,
    landmarks: 0,
    present: 0,
    blinking: 1,
    talking: 1,
    expressions: 1
  })
  expect(JSON.stringify(d)).not.toMatch(/99|98|92|"value"|"scores"|"x"|"y"/)
  addPayload(d, {}, { t: 2 })
  expect(d.payloads).toBe(2)
  expect(d.pulse.present).toBe(1)
})
