// Owner: Agent D. Line-figure animation per step animation key. SVG drawn here, motion in styles.css.
// Every figure is the same jointed skeleton. Joints rotate by CSS variables (--hip-a, --knee-a, --lean, ...)
// that each animation's keyframes drive in styles.css; the walk cycle drives its joints directly.
import type { CSSProperties } from 'react'

type View = 'side' | 'front' | 'front-seated'
type Prop = 'chair-side' | 'chair-front' | 'floor'

/** Animation key → camera view and prop. Side view faces right, like the walk. */
const SCENES: Record<string, { view: View; prop: Prop }> = {
  sit: { view: 'side', prop: 'chair-side' },
  breathe: { view: 'side', prop: 'chair-side' },
  'neck-left': { view: 'front-seated', prop: 'chair-front' },
  'neck-right': { view: 'front-seated', prop: 'chair-front' },
  'shoulder-roll': { view: 'side', prop: 'chair-side' },
  'look-up': { view: 'side', prop: 'chair-side' },
  'stand-up': { view: 'side', prop: 'chair-side' },
  'reach-up': { view: 'front', prop: 'floor' },
  'side-bend': { view: 'front', prop: 'floor' },
  fold: { view: 'side', prop: 'floor' }
}

/** Negative delay so every breath animation (card and orb) lines up with the wall clock. */
function breathDelay(periodMs: number): CSSProperties {
  return { animationDelay: `-${Date.now() % periodMs}ms` }
}

const at = (x: number, y: number): CSSProperties => ({ transformOrigin: `${x}px ${y}px` })

/**
 * Bone lengths match the walk figure: hip y68, knee y87, ankle y105, shoulder y40, elbow y54, neck y33.
 * Front views spread the hips and shoulders; seated from the front, the thigh points at the viewer so it's shorter.
 */
interface Geo {
  knee: number
  hips: number[]
  shoulders: number[]
  toe: number[]
  hand: number
}
function geometry(view: View, x: number): Geo {
  const front = view !== 'side'
  return {
    knee: view === 'front-seated' ? 80 : 87,
    hips: front ? [x - 4, x + 4] : [x, x],
    shoulders: front ? [x - 8, x + 8] : [x, x],
    /** Foot points forward in the side view, outward from the front. */
    toe: front ? [-4, 4] : [5, 5],
    /** Forearm bends slightly forward in the side view, hangs straight from the front. */
    hand: front ? 0 : 5
  }
}

/** Thigh swings at the hip, shin bends at the knee, foot turns at the ankle. */
function Leg({ g, side }: { g: Geo; side: 'a' | 'b' }): React.JSX.Element {
  const i = side === 'a' ? 0 : 1
  const h = g.hips[i]
  return (
    <g className={`fig-leg fig-leg-${side}`} style={at(h, 68)}>
      <line x1={h} y1="68" x2={h} y2={g.knee} />
      <g className="fig-shin" style={at(h, g.knee)}>
        <line x1={h} y1={g.knee} x2={h} y2={g.knee + 18} />
        <g className="fig-foot" style={at(h, g.knee + 18)}>
          <line x1={h} y1={g.knee + 18} x2={h + g.toe[i]} y2={g.knee + 18} />
        </g>
      </g>
    </g>
  )
}

/** Upper arm swings at the shoulder, forearm bends at the elbow. */
function Arm({ g, side }: { g: Geo; side: 'a' | 'b' }): React.JSX.Element {
  const s = g.shoulders[side === 'a' ? 0 : 1]
  return (
    <g className={`fig-arm fig-arm-${side}`} style={at(s, 40)}>
      <line x1={s} y1="40" x2={s} y2="54" />
      <g className="fig-fore" style={at(s, 54)}>
        <line x1={s} y1="54" x2={s + g.hand} y2="66" />
      </g>
    </g>
  )
}

/**
 * The shared skeleton. Leg b and arm a are the far side in the side view (drawn behind).
 * Pivots: body at the hip, upper back at mid-spine, head at the base of the neck, arms at the shoulders.
 */
function Skeleton({ view, x, face }: { view: View; x: number; face?: boolean }): React.JSX.Element {
  const g = geometry(view, x)
  const front = view !== 'side'
  return (
    <g className="fig-bob">
      <Leg g={g} side="b" />
      <Leg g={g} side="a" />
      {front && <line className="fig-pelvis" x1={x - 4} y1="68" x2={x + 4} y2="68" />}
      <g className="fig-torso" style={at(x, 68)}>
        <line x1={x} y1="50" x2={x} y2="68" />
        <g className="fig-chest" style={at(x, 50)}>
          <Arm g={g} side="a" />
          <line x1={x} y1="38" x2={x} y2="50" />
          {front && <line className="fig-clav" x1={x - 8} y1="40" x2={x + 8} y2="40" />}
          {/* Head and neck bend together from the base of the neck, between the shoulders. */}
          <g className="fig-head" style={at(x, 38)}>
            <line x1={x} y1="33" x2={x} y2="38" />
            <circle cx={x} cy="23" r="9" />
            {face && front && (
              <path className="fig-face" d={`M${x - 3.5} 22.5h0.01 M${x + 3.5} 22.5h0.01`} />
            )}
            {face && !front && (
              <path className="fig-face" d={`M${x + 4} 21.5h0.01 M${x + 8} 20l3.5 4.5l-3 0.5`} />
            )}
          </g>
          <Arm g={g} side="b" />
        </g>
      </g>
    </g>
  )
}

function Scene({ prop }: { prop: Prop }): React.JSX.Element {
  return (
    <g className="fig-prop">
      <line x1="16" y1="106" x2="104" y2="106" />
      {prop === 'chair-side' && <path d="M50 90h22 M52 90v15 M70 90v15 M50 90l-2-26" />}
      {prop === 'chair-front' && <path d="M42 84h36 M44 84v21 M76 84v21" />}
    </g>
  )
}

// Facing right. Leg a and arm b are in phase; leg b and arm a run half a stride behind (styles.css).
function Walking({ outside }: { outside?: boolean }): React.JSX.Element {
  return (
    <g className="fig-walking">
      {outside && (
        <g className="fig-sun">
          <circle cx="96" cy="20" r="7" />
          <path d="M96 6v4 M96 30v4 M82 20h4 M106 20h4 M86 10l3 3 M103 27l3 3 M86 30l3-3 M103 13l3-3" />
        </g>
      )}
      <line className="fig-ground" x1="10" y1="106" x2="110" y2="106" />
      {!outside && <path className="fig-prop" d="M80 80h10l-1.5 18h-7z" />}
      <Skeleton view="side" x={58} />
    </g>
  )
}

export function Figure({
  animation,
  breathPeriodMs
}: {
  animation: string
  breathPeriodMs: number
}): React.JSX.Element {
  const scene = SCENES[animation]
  return (
    <svg
      className={`figure fig--${animation}`}
      viewBox="0 0 120 120"
      aria-hidden="true"
      style={animation === 'breathe' ? breathDelay(breathPeriodMs) : undefined}
    >
      {scene ? (
        <>
          <Scene prop={scene.prop} />
          <Skeleton view={scene.view} x={scene.view === 'side' ? 58 : 60} face />
          {animation === 'look-up' && (
            <path className="fig-cue" d="M84 14l-4 4 M84 14l1 5.5 M84 14l-8 9" />
          )}
        </>
      ) : (
        <Walking outside={animation === 'outside'} />
      )}
    </svg>
  )
}
