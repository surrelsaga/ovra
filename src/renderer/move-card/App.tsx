// Owner: Agent D. Move card: nudge prompt, guided move, away timer, return check.
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { MoveCardView, MoveId, Nudge } from '@shared/types'
import { ovra, usePush } from '../shared/bridge'
import { Figure } from './Figure'

type MoveView = Extract<MoveCardView, { kind: 'move' }>
type AwayView = Extract<MoveCardView, { kind: 'away' }>
type ResultView = Extract<MoveCardView, { kind: 'return-result' }>

/** Preview figure on the nudge prompt. */
const PREVIEW: Record<MoveId, string> = {
  breathe: 'breathe',
  'neck-stretch': 'neck-left',
  'stand-stretch': 'reach-up',
  walk: 'walk',
  'step-outside': 'outside'
}

const RING_R = 62
const RING_C = 2 * Math.PI * RING_R

const endMove = (): void => void ovra().invoke('move:end')

function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** --orb-breath-period from theme.css, in ms (one breath = in + out). */
function breathPeriodMs(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--orb-breath-period')
  const n = parseFloat(raw)
  return (raw.trim().endsWith('ms') ? n : n * 1000) || 10_000
}

function useNow(everyMs: number): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}

function Button({
  children,
  onClick,
  primary,
  label
}: {
  children: React.ReactNode
  onClick: () => void
  primary?: boolean
  label?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={primary ? 'btn btn-primary' : 'btn'}
      onClick={onClick}
      aria-label={label}
    >
      {children}
    </button>
  )
}

function Header({ title, onClose }: { title: string; onClose?: () => void }): React.JSX.Element {
  return (
    <header className="card-header">
      <span className="card-eyebrow">{title}</span>
      {onClose && (
        <button type="button" className="icon-btn" onClick={onClose} aria-label="End move">
          <X size={18} aria-hidden="true" />
        </button>
      )}
    </header>
  )
}

function NudgeCard({ nudge }: { nudge: Nudge }): React.JSX.Element {
  const respond = (response: 'go' | 'snooze' | 'skip') => (): void =>
    void ovra().invoke('move:respond', { nudgeId: nudge.id, response })
  return (
    <section className="card card-nudge" aria-labelledby="nudge-msg">
      <Header title="A small break" />
      <div className="nudge-figure">
        <Figure animation={PREVIEW[nudge.moveId]} breathPeriodMs={breathPeriodMs()} />
      </div>
      <p id="nudge-msg" className="nudge-msg">
        {nudge.message}
      </p>
      <div className="actions">
        <Button primary onClick={respond('go')}>
          Let&apos;s go
        </Button>
        <div className="actions-row">
          <Button onClick={respond('snooze')}>5 more min</Button>
          <Button onClick={respond('skip')}>Skip</Button>
        </div>
      </div>
    </section>
  )
}

function BreathCue({ periodMs }: { periodMs: number }): React.JSX.Element {
  const now = useNow(200)
  const inhale = now % periodMs < periodMs / 2
  return (
    <p className={`breath-cue ${inhale ? 'is-in' : 'is-out'}`} aria-live="polite">
      {inhale ? 'in' : 'out'}
    </p>
  )
}

function MoveCard({ view }: { view: MoveView }): React.JSX.Element {
  const { move, stepIndex, remainingSec, feedback } = view
  const step = move.steps[stepIndex]
  const awayStep = step.check === 'away-and-back'
  const breathing = step.animation === 'breathe'
  const period = breathPeriodMs()
  const left = awayStep ? 1 : remainingSec / step.durationSec
  return (
    <section className="card card-move" aria-labelledby="step-title">
      <Header title={`${move.name} · ${stepIndex + 1} of ${move.steps.length}`} onClose={endMove} />
      <div className="stage">
        <svg className="ring" viewBox="0 0 140 140" aria-hidden="true">
          <circle className="ring-track" cx="70" cy="70" r={RING_R} />
          <circle
            className="ring-fill"
            cx="70"
            cy="70"
            r={RING_R}
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - left)}
          />
        </svg>
        <Figure key={step.id} animation={step.animation} breathPeriodMs={period} />
      </div>
      <div className="step-head">
        <h1 id="step-title" className="step-title">
          {step.title}
        </h1>
        <span
          className="step-time"
          aria-label={awayStep ? undefined : `${remainingSec} seconds left`}
        >
          {awayStep
            ? `~${Math.max(1, Math.round(step.durationSec / 60))} min`
            : clock(remainingSec)}
        </span>
      </div>
      <p className="step-howto">{step.howTo}</p>
      {awayStep ? (
        <div className="actions-row">
          <Button primary onClick={() => void ovra().invoke('break:going')}>
            Okay, going
          </Button>
          <Button onClick={endMove}>Not now</Button>
        </div>
      ) : breathing ? (
        <BreathCue periodMs={period} />
      ) : (
        <p className="feedback" aria-live="polite">
          {feedback ?? ''}
        </p>
      )}
      {breathing && feedback && (
        <p className="feedback" aria-live="polite">
          {feedback}
        </p>
      )}
      {move.steps.length > 1 && (
        <ol className="steps" aria-label="Steps">
          {move.steps.map((s, i) => (
            <li
              key={s.id}
              className={i < stepIndex ? 'is-done' : i === stepIndex ? 'is-current' : undefined}
              aria-current={i === stepIndex ? 'step' : undefined}
            >
              {s.title}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function AwayCard({ view }: { view: AwayView }): React.JSX.Element {
  const now = useNow(1000)
  return (
    <section className="card card-away" aria-labelledby="away-title">
      <Header title="On a break" />
      <div className="moon" aria-hidden="true" />
      <p className="away-label" id="away-title">
        Time away
      </p>
      <p className="away-time" role="timer">
        {clock((now - view.since) / 1000)}
      </p>
      <p className="muted">
        {view.manual ? 'Enjoy it. Tap when you are back.' : "I'll notice when you're back."}
      </p>
      <div className="actions">
        <Button primary onClick={() => void ovra().invoke('break:back')}>
          I&apos;m back
        </Button>
      </div>
    </section>
  )
}

function ReturnCheckCard({ progress }: { progress: number }): React.JSX.Element {
  const pct = Math.round(progress * 100)
  return (
    <section className="card card-return" aria-labelledby="return-title">
      <Header title="Welcome back" />
      <div className="moon moon-waking" aria-hidden="true" />
      <h1 id="return-title" className="return-title">
        Checking in
      </h1>
      <p className="muted">Sit back and settle for a moment.</p>
      <div
        className="progress"
        role="progressbar"
        aria-label="Return check"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </section>
  )
}

function ResultCard({ view }: { view: ResultView }): React.JSX.Element {
  const tense = view.result === 'still-tense'
  return (
    <section className="card card-return" aria-labelledby="result-msg">
      <Header title="Welcome back" />
      <div className={`moon ${tense ? 'moon-uneasy' : 'moon-calm'}`} aria-hidden="true" />
      <p id="result-msg" className="return-title" role="status">
        {view.message}
      </p>
      <div className="actions">
        {tense ? (
          <>
            <Button primary onClick={() => void ovra().invoke('break:breathe-round')}>
              Breathe for 1 min
            </Button>
            <Button onClick={endMove}>Not now</Button>
          </>
        ) : (
          <Button primary onClick={endMove}>
            Done
          </Button>
        )}
      </div>
    </section>
  )
}

export default function App(): React.JSX.Element {
  const view = usePush('push:move-card', { kind: 'hidden' })
  switch (view.kind) {
    case 'nudge':
      return <NudgeCard key={view.nudge.id} nudge={view.nudge} />
    case 'move':
      return <MoveCard view={view} />
    case 'away':
      return <AwayCard view={view} />
    case 'return-check':
      return <ReturnCheckCard progress={view.progress} />
    case 'return-result':
      return <ResultCard view={view} />
    default:
      return <main className="card card-hidden" aria-hidden="true" />
  }
}
