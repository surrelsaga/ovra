// Owner: Agent E. The moon orb. Used by the orb window and the main window (greeting, calibration).
import type { CSSProperties } from 'react'
import type { OrbView } from '@shared/types'
import './moon.css'

export type MoonProps = Pick<OrbView, 'mood' | 'listening' | 'away' | 'breath'> & {
  paused?: boolean
  size?: number
  /** Accessible description; defaults to the state. */
  label?: string
}

function moonLabel(p: MoonProps): string {
  const parts = [`Ovra moon, ${p.away ? 'away' : p.mood}`]
  if (p.breath !== undefined) parts.push('breathing along')
  if (p.listening) parts.push('camera on')
  else if (p.paused) parts.push('camera paused')
  return parts.join(', ')
}

export function MoonOrb(props: MoonProps): React.JSX.Element {
  const { mood, listening, away, breath, size = 112, label } = props
  const style = {
    '--size': `${size}px`,
    '--breath': breath ?? 0.5
  } as CSSProperties
  return (
    <div
      className="moon"
      data-mood={mood}
      data-away={away || undefined}
      data-breathing={breath !== undefined || undefined}
      style={style}
      role="img"
      aria-label={label ?? moonLabel(props)}
    >
      <div className="moon__glow" />
      <div className="moon__body">
        {mood === 'bright' && !away && <span className="moon__sparkle" />}
      </div>
      {listening && <div className="moon__ring" data-testid="listening-ring" />}
    </div>
  )
}
