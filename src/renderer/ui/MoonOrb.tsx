// Owner: Agent E. The pixel-art moon orb. Used by the orb window and the main window (logo, greeting, calibration).
import { useMemo, type CSSProperties } from 'react'
import type { OrbView } from '@shared/types'
import { moonPixels, ringCells, TONES } from './moonPixels'
import './moon.css'

export type MoonProps = Pick<OrbView, 'mood' | 'listening' | 'away' | 'breath'> & {
  paused?: boolean
  /** Disk width in px; snapped to whole art pixels. */
  size?: number
  /** Accessible description; defaults to the state. */
  label?: string
}

/** Grid cells around the disk for halo, ring and sparkles. */
const MARGIN = 5

function moonLabel(p: MoonProps): string {
  const parts = [`Ovra moon, ${p.away ? 'away' : p.mood}`]
  if (p.breath !== undefined) parts.push('breathing along')
  if (p.listening) parts.push('camera on')
  else if (p.paused) parts.push('camera paused')
  return parts.join(', ')
}

/** Breathe along: the disk grows and shrinks two art pixels at a time (5 frames). */
export function breathDisk(disk: number, breath: number | undefined): number {
  if (breath === undefined) return disk
  return disk - 6 + 2 * Math.round(Math.min(1, Math.max(0, breath)) * 4)
}

export function MoonOrb(props: MoonProps): React.JSX.Element {
  const { mood, listening, away, breath, size = 88, label } = props
  // Small logos get a coarser 12-cell disk so the pixels still read.
  const disk = size < 48 ? 12 : 22
  const px = Math.max(1, Math.round(size / disk))
  const grid = disk + 2 * MARGIN
  const d = breathDisk(disk, breath)
  const art = useMemo(() => moonPixels(d, grid, away), [d, grid, away])
  const ring = useMemo(() => {
    const cells = ringCells(grid, grid / 2 - 2)
    return { cells, path: cells.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join('') }
  }, [grid])
  const edge = 1 / px
  const sparkles: [number, number][] = [
    [grid - 5, 4],
    [4, grid - 6],
    [grid - 3, Math.round(grid * 0.6)]
  ]
  const style = { width: disk * px, height: disk * px, '--px': `${px}px` } as CSSProperties

  return (
    <div
      className="moon"
      data-mood={mood}
      data-away={away || undefined}
      data-breathing={breath !== undefined || undefined}
      data-disk={d}
      style={style}
      role="img"
      aria-label={label ?? moonLabel(props)}
    >
      <svg
        className="moon__px"
        viewBox={`0 0 ${grid} ${grid}`}
        width={grid * px}
        height={grid * px}
        shapeRendering="crispEdges"
        aria-hidden
      >
        <path className="moon__halo" d={art.halo} />
        <path className="moon__halo-dither" d={art.haloDither} />
        {TONES.map((t) => (
          <path key={t} className={`px px--${t}`} d={art.tones[t]} />
        ))}
        {mood === 'stormy' && <path className="moon__edge" d={art.edge} />}
        <path className="px px--eclipse" d={art.eclipse} />
        {mood === 'bright' &&
          !away &&
          sparkles.map(([x, y], i) => (
            <g key={i} className="moon__sparkle" style={{ animationDelay: `${-i * 0.8}s` }}>
              <path
                className="moon__sparkle-arms"
                style={{ animationDelay: `${-i * 0.8}s` }}
                d={`M${x} ${y - 1}h1v1h1v1h-1v1h-1v-1h-1v-1h1z`}
              />
              <rect x={x} y={y} width={1} height={1} />
            </g>
          ))}
        {listening && (
          <g className="moon__ring" data-testid="listening-ring">
            {/* Dark 1-px edge on both sides keeps the ring visible on light desktops. */}
            {[
              [edge, 0],
              [-edge, 0],
              [0, edge],
              [0, -edge]
            ].map(([dx, dy]) => (
              <path
                key={`${dx},${dy}`}
                className="moon__ring-edge"
                d={ring.path}
                transform={`translate(${dx} ${dy})`}
              />
            ))}
            {ring.cells.map(([x, y, turn]) => (
              <rect
                key={`${x},${y}`}
                x={x}
                y={y}
                width={1}
                height={1}
                // A brighter head walks round clockwise, one pixel at a time.
                style={{
                  animationDelay: `calc(var(--orbit-period) * ${turn.toFixed(3)} - var(--orbit-period))`
                }}
              />
            ))}
          </g>
        )}
      </svg>
    </div>
  )
}
