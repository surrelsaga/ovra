// Owner: Agent E. Small shared React components. Styles in ui.css.
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { MoodPoint } from '@shared/types'
import { SITUATION_LABEL, timelineSegments } from './timeline'
import './ui.css'

export { MoonOrb } from './MoonOrb'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  icon?: ReactNode
}

export function Button({
  variant = 'secondary',
  icon,
  children,
  className,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button type="button" className={`btn btn--${variant} ${className ?? ''}`} {...rest}>
      {icon}
      {children}
    </button>
  )
}

export interface Option<T extends string | number> {
  value: T
  label: string
  hint?: string
}

/** Radio group shown as cards. Native radios keep keyboard and screen reader support. */
export function ChoiceGroup<T extends string | number>(props: {
  legend: string
  description?: ReactNode
  name: string
  options: Option<T>[]
  value: T | null
  onChange: (v: T) => void
  required?: boolean
  columns?: number
  disabled?: boolean
}): React.JSX.Element {
  const { legend, description, name, options, value, onChange, required, columns, disabled } = props
  return (
    <fieldset className="choice" disabled={disabled}>
      <legend className="choice__legend">
        {legend}
        {required && <span className="choice__required"> · must answer</span>}
      </legend>
      {description && <p className="choice__desc">{description}</p>}
      <div
        className="choice__options"
        style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, 1fr)` }}
      >
        {options.map((o) => (
          <label
            key={o.value}
            className="choice__option"
            data-checked={value === o.value || undefined}
          >
            <input
              type="radio"
              name={name}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              required={required}
            />
            <span className="choice__label">{o.label}</span>
            {o.hint && <span className="choice__hint">{o.hint}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function Toggle(props: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  const { label, hint, checked, onChange } = props
  return (
    <div className="toggle-row">
      <div>
        <div className="toggle-row__label">{label}</div>
        {hint && <div className="toggle-row__hint">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="toggle"
        onClick={() => onChange(!checked)}
      >
        <span className="toggle__thumb" />
      </button>
    </div>
  )
}

export function Progress({ value, label }: { value: number; label: string }): React.JSX.Element {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress__fill" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function EnergyDots({ energy }: { energy: number }): React.JSX.Element {
  return (
    <span className="dots" role="img" aria-label={`Energy ${energy} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="dots__dot" data-on={i <= energy || undefined} />
      ))}
    </span>
  )
}

export function MoodTimeline(props: {
  points: MoodPoint[]
  start: number
  end: number
  legend?: boolean
}): React.JSX.Element {
  const segments = timelineSegments(props.points, props.start, props.end)
  const summary = segments.length
    ? segments
        .map((s) => `${SITUATION_LABEL[s.situation]} ${Math.round(s.fraction * 100)}%`)
        .join(', ')
    : 'No mood data'
  const kinds = [...new Set(segments.map((s) => s.situation))]
  return (
    <div className="timeline">
      <div className="timeline__bar" role="img" aria-label={`Mood timeline: ${summary}`}>
        {segments.map((s, i) => (
          <span
            key={i}
            className="timeline__seg"
            data-situation={s.situation}
            style={{ flexGrow: s.fraction }}
          />
        ))}
      </div>
      {props.legend && kinds.length > 0 && (
        <ul className="timeline__legend">
          {kinds.map((k) => (
            <li key={k}>
              <span className="timeline__swatch" data-situation={k} />
              {SITUATION_LABEL[k]}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Two-step button for destructive actions: first click asks, second click does it. */
export function ConfirmButton(props: {
  label: string
  confirmLabel: string
  onConfirm: () => void | Promise<void>
  icon?: ReactNode
}): React.JSX.Element {
  const [asking, setAsking] = useState(false)
  if (!asking)
    return (
      <Button variant="danger" icon={props.icon} onClick={() => setAsking(true)}>
        {props.label}
      </Button>
    )
  return (
    <span className="confirm">
      <Button
        variant="danger"
        autoFocus
        onClick={async () => {
          await props.onConfirm()
          setAsking(false)
        }}
      >
        {props.confirmLabel}
      </Button>
      <Button variant="ghost" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  )
}
