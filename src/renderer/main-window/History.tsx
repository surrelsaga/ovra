// Owner: Agent E. History list and the session summary (also shown when a session ends).
import { useEffect, useState } from 'react'
import { ArrowLeft, Play, Trash2 } from 'lucide-react'
import type { MoveId, SessionRecord } from '@shared/types'
import { ovra } from '../shared/bridge'
import { Button, ConfirmButton, MoodTimeline } from '../ui'
import { ACTIVITY_LABEL, fmtDate, fmtMinutes } from './config'

const MOVE_LABEL: Record<MoveId, string> = {
  breathe: 'Breathe along',
  'neck-stretch': 'Neck and shoulder stretch',
  'stand-stretch': 'Stand and stretch',
  walk: 'Walk / get water',
  'step-outside': 'Step outside'
}

const doneMoves = (r: SessionRecord): MoveId[] =>
  r.moves.filter((m) => m.outcome === 'done').map((m) => m.moveId)

export function SessionSummaryView(props: {
  record: SessionRecord
  title: string
  onBack: () => void
  backLabel: string
  onDeleted: () => void
}): React.JSX.Element {
  const { record: r } = props
  const done = doneMoves(r)
  const stats = [
    {
      label: 'Moves done',
      value: String(done.length),
      detail: [...new Set(done)].map((m) => MOVE_LABEL[m]).join(', ')
    },
    {
      label: 'Snoozed',
      value: String(r.snoozes),
      detail: r.snoozes ? 'Nudges you put off' : 'None'
    },
    {
      label: 'Songs learned',
      value: String(r.learnedSongIds.length),
      detail: 'Songs Ovra learned something about'
    },
    {
      label: 'Longest seated stretch',
      value: fmtMinutes(r.longestSeatedMin),
      detail: 'Without a real break'
    }
  ]
  return (
    <section className="page" aria-labelledby="summary-title">
      <header className="page__header">
        <h1 id="summary-title">{props.title}</h1>
        <p>
          {ACTIVITY_LABEL[r.activity]} · {fmtDate(r.startedAt)} ·{' '}
          {fmtMinutes((r.endedAt - r.startedAt) / 60000)}
          {r.cameraMode === 'off' ? ' · camera off' : ''}
        </p>
      </header>
      <div className="panel">
        <h2 className="panel__title">How it went</h2>
        <MoodTimeline points={r.moodTimeline} start={r.startedAt} end={r.endedAt} legend />
      </div>
      <div className="stats">
        {stats.map((s) => (
          <div key={s.label} className="panel stat">
            <span className="stat__label">{s.label}</span>
            <span className="stat__value">{s.value}</span>
            {s.detail && <span className="stat__detail">{s.detail}</span>}
          </div>
        ))}
      </div>
      <div className="panel saved">
        <div>
          <h2 className="panel__title">What’s saved</h2>
          <p className="muted small">
            Mood labels with times, moves done, session length and which songs it learned about.
            Kept on this Mac only. No video, no pulse or breathing numbers.
          </p>
        </div>
        <ConfirmButton
          label="Delete this session"
          confirmLabel="Yes, delete it"
          icon={<Trash2 />}
          onConfirm={async () => {
            await ovra().invoke('history:delete', { id: r.id })
            props.onDeleted()
          }}
        />
      </div>
      <div className="page__actions">
        <Button
          variant={props.backLabel === 'New session' ? 'primary' : 'secondary'}
          icon={props.backLabel === 'New session' ? <Play /> : <ArrowLeft />}
          onClick={props.onBack}
        >
          {props.backLabel}
        </Button>
      </div>
    </section>
  )
}

export function History(): React.JSX.Element {
  const [records, setRecords] = useState<SessionRecord[] | null>(null)
  const [open, setOpen] = useState<SessionRecord | null>(null)

  const load = (): void => {
    ovra()
      .invoke('history:list')
      .then((list) => setRecords([...list].sort((a, b) => b.startedAt - a.startedAt)))
      .catch(() => setRecords([]))
  }
  useEffect(load, [])

  if (open)
    return (
      <SessionSummaryView
        record={open}
        title="Session"
        backLabel="All sessions"
        onBack={() => setOpen(null)}
        onDeleted={() => {
          setOpen(null)
          load()
        }}
      />
    )

  return (
    <section className="page" aria-labelledby="history-title">
      <header className="page__header">
        <h1 id="history-title">History</h1>
        <p>Past sessions on this Mac. Older ones are removed by your auto-delete setting.</p>
      </header>
      {records === null ? null : records.length === 0 ? (
        <div className="panel empty">
          No sessions yet. Your first one shows up here when it ends.
        </div>
      ) : (
        <ul className="list">
          {records.map((r) => (
            <li key={r.id} className="panel history-row">
              <button type="button" className="history-row__main" onClick={() => setOpen(r)}>
                <span className="history-row__title">
                  {ACTIVITY_LABEL[r.activity]}
                  <span className="muted"> · {fmtMinutes((r.endedAt - r.startedAt) / 60000)}</span>
                </span>
                <span className="muted small">{fmtDate(r.startedAt)}</span>
                <MoodTimeline points={r.moodTimeline} start={r.startedAt} end={r.endedAt} />
                <span className="muted small">
                  {doneMoves(r).length} moves done · {r.snoozes} snoozed
                </span>
              </button>
              <Button
                variant="ghost"
                icon={<Trash2 />}
                aria-label={`Delete ${ACTIVITY_LABEL[r.activity]} session from ${fmtDate(r.startedAt)}`}
                onClick={async () => {
                  await ovra().invoke('history:delete', { id: r.id })
                  load()
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
