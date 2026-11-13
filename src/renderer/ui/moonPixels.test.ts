import { breathDisk, moonPixels, SAT_STEPS, satelliteCells } from './moonPixels'

const cells = (path: string): number => (path.match(/M/g) ?? []).length

describe('pixel moon', () => {
  it('draws a closed outline, halo and craters; away eclipses most of the disk', () => {
    const full = moonPixels(22, 32)
    expect(cells(full.tones.outline)).toBeGreaterThan(50)
    expect(cells(full.tones.crater) + cells(full.tones.shade)).toBeGreaterThan(20)
    expect(cells(full.halo)).toBeGreaterThan(0)
    expect(full.eclipse).toBe('')

    const away = moonPixels(22, 32, true)
    expect(away.halo).toBe('')
    expect(cells(away.eclipse)).toBeGreaterThan(cells(away.tones.light) + cells(away.tones.rim))
  })

  it('breathes in whole two-pixel steps', () => {
    expect([0, 0.25, 0.5, 0.75, 1].map((b) => breathDisk(22, b))).toEqual([16, 18, 20, 22, 24])
    expect(breathDisk(22, undefined)).toBe(22)
  })

  it('waxes from a thin crescent to full; the unlit side stays drawn', () => {
    const lit = (m: ReturnType<typeof moonPixels>): number =>
      ['crater', 'shade', 'base', 'light', 'rim'].reduce(
        (n, t) => n + cells(m.tones[t as keyof typeof m.tones]),
        0
      )
    const [p0, p5, p1] = [0, 0.5, 1].map((phase) => moonPixels(22, 32, false, { phase }))
    expect(lit(p0)).toBeGreaterThan(0)
    expect(lit(p0)).toBeLessThan(lit(p5))
    expect(lit(p5)).toBeLessThan(lit(p1))
    expect(p1.night + p1.nightEdge).toBe('')
    // Every disk cell is still drawn, lit or not.
    for (const m of [p0, p5]) expect(lit(m) + cells(m.night) + cells(m.nightEdge)).toBe(lit(p1))
    // Away keeps its eclipse and ignores the phase.
    expect(moonPixels(22, 32, true, { phase: 0 }).night).toBe('')
  })

  it('moonrise builds out ring by ring, growing edge in outline', () => {
    const size = (reveal: number): number => {
      const m = moonPixels(22, 32, false, { reveal })
      return Object.values(m.tones).reduce((n, p) => n + cells(p), 0)
    }
    const steps = [0, 1, 2, 3, 4, 5, 6, 7].map((s) => size(s / 8 + 0.06))
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1])
    expect(steps[7]).toBeLessThanOrEqual(size(1))
    const mid = moonPixels(22, 32, false, { reveal: 0.5 })
    expect(mid.halo).toBe('')
    // The growing edge is outline; the full moon's outer outline isn't there yet.
    expect(cells(mid.tones.outline)).toBeGreaterThan(20)
    expect(cells(mid.tones.outline)).toBeLessThan(cells(moonPixels(22, 32).tones.outline))
  })

  it('satellite steps round a pixel circle just outside the disk, inside the grid', () => {
    const seen = new Set<string>()
    for (let step = 0; step < SAT_STEPS; step++) {
      const cs = satelliteCells(32, 15, step)
      expect(cs.map((c) => c[3])).toEqual([2, 1, 0])
      const [x, y, size] = cs[2]
      expect(size).toBe(2)
      for (const [cx, cy, s] of cs) {
        expect(cx >= 0 && cy >= 0 && cx + s <= 32 && cy + s <= 32).toBe(true)
        expect(Math.hypot(cx + s / 2 - 16, cy + s / 2 - 16)).toBeGreaterThan(13)
      }
      seen.add(`${x},${y}`)
    }
    expect(seen.size).toBe(SAT_STEPS)
    // Step 0 is at 12 o'clock; a full turn comes back.
    expect(satelliteCells(32, 15, 0)[2]).toEqual([15, 0, 2, 0])
    expect(satelliteCells(32, 15, SAT_STEPS)).toEqual(satelliteCells(32, 15, 0))
    expect(satelliteCells(32, 15, 0, 0)).toHaveLength(1)
  })
})
