// Owner: Agent E. The pixel-art moon orb. Used by the orb window and the main window (logo, greeting, calibration).
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { OrbView } from '@shared/types'
import { breathDisk, moonPixels, SAT_STEPS, satelliteCells, TONES } from './moonPixels'
import './moon.css'

export type MoonProps = Pick<OrbView, 'mood' | 'listening' | 'away' | 'breath' | 'calibration'> & {
  paused?: boolean
  /** Disk width in px; snapped to whole art pixels. */
  size?: number
  /** Accessible description; defaults to the state. */
  label?: string
}

/** Grid cells around the disk for halo, satellite and sparkles. */
const MARGIN = 5

/** Camera indicator timings (approved mockup). */
const moonMotion = {
  satStepMs: 110,
  riseMs: 1000,
  riseSteps: 8,
  /** Camera off: the satellite holds each fade step this long, two steps. */
  fadeStepMs: 300,
  waxSteps: 24
}
const FADE = [0.6, 0.25]

const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Camera on/off motion: ms since `listening` last changed and the satellite step.
 * Ticks only while the camera is on or the satellite is fading out.
 */
function useCameraMotion(listening: boolean, still: boolean): { ms: number; step: number } {
  const [s, setS] = useState({ on: listening, ms: Infinity, step: 0 })
  // Adjust state while rendering (not in an effect) so the first frame after a change is right.
  if (s.on !== listening) setS({ on: listening, ms: 0, step: s.step })
  const ticking = !still && (listening || s.ms < FADE.length * moonMotion.fadeStepMs)
  useEffect(() => {
    if (!ticking) return
    const id = setInterval(
      () => setS((p) => ({ ...p, ms: p.ms + moonMotion.satStepMs, step: p.step + 1 })),
      moonMotion.satStepMs
    )
    return () => clearInterval(id)
  }, [ticking])
  return s
}

function moonLabel(p: MoonProps): string {
  const parts = [`Ovra moon, ${p.away ? 'away' : p.mood}`]
  if (p.breath !== undefined) parts.push('breathing along')
  if (p.listening) parts.push('camera on')
  else if (p.paused) parts.push('camera paused')
  return parts.join(', ')
}

export function MoonOrb(props: MoonProps): React.JSX.Element {
  const { mood, listening, away, breath, calibration, size = 88, label } = props
  const [still] = useState(reducedMotion)
  const motion = useCameraMotion(listening, still)
  // Small logos get a coarser 12-cell disk so the pixels still read.
  const disk = size < 48 ? 12 : 22
  const px = Math.max(1, Math.round(size / disk))
  const grid = disk + 2 * MARGIN
  const d = breathDisk(disk, breath)
  // Waxing only during calibration; check-ins and the return check show the full moon.
  const phase =
    calibration === undefined
      ? 1
      : Math.floor(Math.min(1, Math.max(0, calibration)) * moonMotion.waxSteps) /
        moonMotion.waxSteps
  const reveal =
    listening && !still && motion.ms < moonMotion.riseMs
      ? Math.floor((motion.ms / moonMotion.riseMs) * moonMotion.riseSteps) / moonMotion.riseSteps +
        0.06
      : 1
  const art = useMemo(
    () => moonPixels(d, grid, away, { phase, reveal }),
    [d, grid, away, phase, reveal]
  )
  // The camera indicator: on for the whole time `listening` is true, then fades in two steps.
  const satAlpha = listening
    ? 1
    : still
      ? 0
      : (FADE[Math.floor(motion.ms / moonMotion.fadeStepMs)] ?? 0)
  const sat = satAlpha
    ? satelliteCells(grid, grid / 2 - 1, still ? 0 : motion.step % SAT_STEPS, still ? 0 : 2)
    : null
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
      data-phase={phase < 1 ? phase.toFixed(3) : undefined}
      data-rise={reveal < 1 ? reveal.toFixed(3) : undefined}
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
        <path className="px px--night" d={art.night} />
        <path className="px px--night-edge" d={art.nightEdge} />
        {sat && (
          <g
            className="moon__satellite"
            data-testid="camera-satellite"
            opacity={satAlpha}
            // Dark 1-px edge keeps it visible on light desktops.
            strokeWidth={2 * edge}
          >
            {sat.map(([x, y, s, back]) => (
              <rect key={back} className={`sat sat--${back}`} x={x} y={y} width={s} height={s} />
            ))}
          </g>
        )}
      </svg>
    </div>
  )
}
