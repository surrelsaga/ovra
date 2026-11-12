// Owner: Agent D. Line-figure animation per step animation key. SVG drawn here, motion in styles.css.
import type { CSSProperties } from 'react'

const SEATED = ['sit', 'breathe', 'neck-left', 'neck-right', 'shoulder-roll', 'look-up']
const WALKING = ['walk', 'outside']

/** Negative delay so every breath animation (card and orb) lines up with the wall clock. */
function breathDelay(periodMs: number): CSSProperties {
  return { animationDelay: `-${Date.now() % periodMs}ms` }
}

function Seated({ bodyStyle }: { bodyStyle?: CSSProperties }): React.JSX.Element {
  return (
    <g className="fig-seated">
      <line className="fig-prop" x1="34" y1="78" x2="86" y2="78" />
      <line className="fig-prop" x1="38" y1="78" x2="38" y2="104" />
      <line className="fig-prop" x1="82" y1="78" x2="82" y2="104" />
      <polyline points="60,72 47,77 47,102" />
      <polyline points="60,72 73,77 73,102" />
      <g className="fig-body" style={bodyStyle}>
        <line x1="60" y1="37" x2="60" y2="72" />
        <g className="fig-head">
          <circle cx="60" cy="27" r="9" />
        </g>
        <g className="fig-arm fig-arm-l">
          <polyline points="60,44 47,58 52,72" />
        </g>
        <g className="fig-arm fig-arm-r">
          <polyline points="60,44 73,58 68,72" />
        </g>
        <path className="fig-cue" d="M60 8 l-4 5 M60 8 l4 5 M60 8 v8" />
      </g>
    </g>
  )
}

function Standing({ armsUp }: { armsUp?: boolean }): React.JSX.Element {
  // Arms hang from the shoulder (60,40); "up" is the same line rotated over the head.
  const l = armsUp ? 'rotate(150 60 40)' : undefined
  const r = armsUp ? 'rotate(-150 60 40)' : undefined
  return (
    <g className="fig-standing">
      <line className="fig-prop" x1="28" y1="106" x2="92" y2="106" />
      <line x1="60" y1="68" x2="51" y2="105" />
      <line x1="60" y1="68" x2="69" y2="105" />
      <g className="fig-body">
        <line x1="60" y1="33" x2="60" y2="68" />
        <g className="fig-head">
          <circle cx="60" cy="23" r="9" />
        </g>
        <g className="fig-arm fig-arm-l">
          <line x1="60" y1="40" x2="50" y2="65" transform={l} />
        </g>
        <g className="fig-arm fig-arm-r">
          <line x1="60" y1="40" x2="70" y2="65" transform={r} />
        </g>
      </g>
    </g>
  )
}

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
      <g className="fig-leg fig-leg-a">
        <line x1="58" y1="68" x2="58" y2="105" />
      </g>
      <g className="fig-leg fig-leg-b">
        <line x1="58" y1="68" x2="58" y2="105" />
      </g>
      <line x1="58" y1="33" x2="58" y2="68" />
      <circle cx="60" cy="23" r="9" />
      <g className="fig-arm fig-arm-a">
        <line x1="58" y1="40" x2="58" y2="64" />
      </g>
      <g className="fig-arm fig-arm-b">
        <line x1="58" y1="40" x2="58" y2="64" />
      </g>
      {!outside && <path className="fig-prop" d="M80 80h10l-1.5 18h-7z" />}
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
  let body: React.JSX.Element
  if (animation === 'stand-up') {
    body = (
      <>
        <g className="fig-swap-a">
          <Seated />
        </g>
        <g className="fig-swap-b">
          <Standing />
        </g>
      </>
    )
  } else if (SEATED.includes(animation)) {
    body = <Seated bodyStyle={animation === 'breathe' ? breathDelay(breathPeriodMs) : undefined} />
  } else if (WALKING.includes(animation)) {
    body = <Walking outside={animation === 'outside'} />
  } else {
    body = <Standing armsUp={animation === 'side-bend'} />
  }
  return (
    <svg className={`figure fig--${animation}`} viewBox="0 0 120 120" aria-hidden="true">
      {body}
    </svg>
  )
}
