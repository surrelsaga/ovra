// Owner: Agent E. Pixel-art moon: which grid cell gets which tone. Pure, so the art is testable.
// Light comes from the right (dark left side, light rim on the right), like a waxing moon.

export type Tone = 'outline' | 'crater' | 'shade' | 'base' | 'light' | 'rim'

export interface MoonPixels {
  /** One SVG path per tone, each cell a 1×1 square. */
  tones: Record<Tone, string>
  /** Cells just inside the outline (stormy recolours them). */
  edge: string
  /** Away: the eclipsed part of the disk. */
  eclipse: string
  /** Waxing: the unlit side, kept faintly visible (night tones). */
  night: string
  nightEdge: string
  /** Stepped halo: a solid ring of cells, then a dithered one. */
  halo: string
  haloDither: string
}

export const TONES: Tone[] = ['outline', 'crater', 'shade', 'base', 'light', 'rim']
const DARKER: Record<Tone, Tone> = {
  outline: 'outline',
  crater: 'crater',
  shade: 'crater',
  base: 'shade',
  light: 'base',
  rim: 'light'
}

/** Craters as [x, y] in disk radii from the centre and radius in cells at a 22-cell disk. */
const CRATERS: [number, number, number][] = [
  [-0.38, -0.28, 2.4],
  [0.28, 0.36, 2],
  [-0.12, 0.5, 1.4],
  [0.36, -0.42, 1.3],
  [-0.6, 0.18, 1.1],
  [0.04, -0.06, 1.1],
  [-0.3, 0.72, 0.9]
]

const cell = (x: number, y: number): string => `M${x} ${y}h1v1h-1z`

export interface MoonLight {
  /** Waxing, 0 = thin crescent, 1 = full (default). Lit from the right. */
  phase?: number
  /** Moonrise, 0–1: how far the disk has built out from its centre (default 1, whole moon). */
  reveal?: number
}

/**
 * Waxing: is the cell lit at this phase? The terminator sweeps right to left across the disk
 * inside the outline, starting from a crescent about a cell thick.
 */
function litAt(dx: number, dy: number, r: number, phase: number): boolean {
  const half = Math.sqrt(Math.max(0, (r - 1) ** 2 - dy * dy))
  return dx >= Math.cos(Math.PI * (0.15 + phase * 0.85)) * half
}

/**
 * A disk `d` cells wide, centred in a `grid`×`grid` square. Use even `d` and `grid`
 * so the disk stays symmetric.
 */
export function moonPixels(
  d: number,
  grid: number,
  away = false,
  { phase = 1, reveal = 1 }: MoonLight = {}
): MoonPixels {
  const c = grid / 2
  const r = d / 2
  const scale = d / 22
  const dist = (x: number, y: number): number => Math.hypot(x + 0.5 - c, y + 0.5 - c)
  const inside = (x: number, y: number): boolean => dist(x, y) < r
  const out: Record<Tone, string[]> = {
    outline: [],
    crater: [],
    shade: [],
    base: [],
    light: [],
    rim: []
  }
  const edge: string[] = []
  const eclipse: string[] = []
  const night: string[] = []
  const nightEdge: string[] = []
  const rising = reveal < 1
  // Moonrise builds one ring at a time; the growing edge is drawn in the outline colour.
  const maxD = Math.ceil(reveal * (r + 1))
  const halo: string[] = []
  const haloDither: string[] = []
  // ponytail: eclipse as a second disk offset up-left; leaves a crescent on the lit side.
  const shadow = { x: c - 0.42 * r, y: c - 0.12 * r, r: 0.96 * r }

  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const p = cell(x, y)
      const dd = dist(x, y)
      if (rising && dd > maxD) continue
      if (!inside(x, y)) {
        if (away || rising) continue
        if (dd < r + 1) halo.push(p)
        else if (dd < r + 2.2 && (x + y) % 2 === 0) haloDither.push(p)
        continue
      }
      const n4 = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1]
      ]
      if (n4.some(([a, b]) => !inside(a, b))) {
        out.outline.push(p)
        continue
      }
      if (rising && dd > maxD - 1.2) {
        out.outline.push(p)
        continue
      }
      const nearEdge = n4.some(([a, b]) => n4Outline(a, b))
      if (away && Math.hypot(x + 0.5 - shadow.x, y + 0.5 - shadow.y) < shadow.r) {
        eclipse.push(p)
        continue
      }
      if (!away && phase < 1 && !litAt(x + 0.5 - c, y + 0.5 - c, r, phase)) {
        ;(nearEdge ? nightEdge : night).push(p)
        continue
      }
      if (nearEdge) edge.push(p)

      const nx = (x + 0.5 - c) / r
      const ny = (y + 0.5 - c) / r
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
      const lit = 0.7 * nx - 0.2 * ny + 0.45 * nz
      let tone: Tone =
        nearEdge && nx > 0.3 ? 'rim' : lit < -0.15 ? 'shade' : lit < 0.35 ? 'base' : 'light'
      for (const [cx, cy, cr] of CRATERS) {
        const rr = cr * scale
        if (rr < 0.8) continue
        const dx = x + 0.5 - (c + cx * r)
        const dy = y + 0.5 - (c + cy * r)
        const dc = Math.hypot(dx, dy)
        if (dc < rr) tone = DARKER[tone]
        else if (dc < rr + 1 && dx > 0 && dy > 0 && tone !== 'rim') tone = 'light'
      }
      out[tone].push(p)
    }
  }
  return {
    tones: Object.fromEntries(TONES.map((t) => [t, out[t].join('')])) as Record<Tone, string>,
    edge: edge.join(''),
    eclipse: eclipse.join(''),
    night: night.join(''),
    nightEdge: nightEdge.join(''),
    halo: halo.join(''),
    haloDither: haloDither.join('')
  }

  /** Outline cells are inside cells with a neighbour outside. */
  function n4Outline(x: number, y: number): boolean {
    if (!inside(x, y)) return false
    return !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)
  }
}

export const SAT_STEPS = 32

/**
 * Camera satellite at `step` on a pixel circle of `radius` round the grid centre, clockwise from
 * 12 o'clock, 32 steps a turn. Returns [x, y, size, back] trail first, head last: the head is a
 * 2×2 block (back 0), then `trail` single cells behind it.
 */
export function satelliteCells(
  grid: number,
  radius: number,
  step: number,
  trail = 2
): [number, number, number, number][] {
  const c = grid / 2
  const cells: [number, number, number, number][] = []
  for (let back = trail; back >= 0; back--) {
    const a = ((step - back) / SAT_STEPS) * 2 * Math.PI - Math.PI / 2
    const size = back === 0 ? 2 : 1
    const at = (v: number): number => Math.round(c - size / 2 + v * radius)
    cells.push([at(Math.cos(a)), at(Math.sin(a)), size, back])
  }
  return cells
}

/** Breathe along: the disk grows and shrinks two art pixels at a time (5 frames). */
export function breathDisk(disk: number, breath: number | undefined): number {
  if (breath === undefined) return disk
  return disk - 6 + 2 * Math.round(Math.min(1, Math.max(0, breath)) * 4)
}
