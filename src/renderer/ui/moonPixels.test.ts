import { breathDisk, moonPixels, ringCells } from './moonPixels'

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

  it('listening ring is a solid circle that fits the grid', () => {
    const ring = ringCells(32, 14)
    expect(ring.length).toBeGreaterThan(80)
    expect(ring.every(([x, y]) => x >= 0 && y >= 0 && x < 32 && y < 32)).toBe(true)
  })
})
