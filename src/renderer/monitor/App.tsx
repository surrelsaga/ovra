import React, { useEffect, useState } from 'react'
import type { MonitorMetricSummary, MonitorSnapshot } from '@shared/types'

function pct(n: number, total: number): string {
  return `${total ? Math.round((n * 100) / total) : 0}%`
}
function time(t: number | null): string {
  return t === null ? '—' : new Date(t).toLocaleTimeString()
}
function perSec(n: number, duration: number): string {
  return duration ? (n / duration).toFixed(1) : '0.0'
}
function codes(counts: Record<string, number>): string {
  return (
    Object.entries(counts)
      .map(([code, n]) => `${code} × ${n}`)
      .join(' · ') || '—'
  )
}
function signal(data: MonitorMetricSummary, key: 'pulse' | 'breathing' | 'hrv'): string {
  const value = data[key]
  return `${pct(value.present, data.payloads)} / ${pct(value.stable, data.payloads)} / ${value.confidence?.toFixed(0) ?? '—'}`
}

export default function App(): React.JSX.Element {
  const [s, set] = useState<MonitorSnapshot | null>(null)
  useEffect(() => window.ovra.on('push:monitor', set), [])
  if (!s)
    return (
      <main>
        <h1>Sensing monitor</h1>
        <p>Waiting for app diagnostics…</p>
      </main>
    )
  const row = (label: string, value: (data: MonitorMetricSummary) => string): React.JSX.Element => (
    <tr key={label}>
      <th scope="row">{label}</th>
      <td>{value(s.recent)}</td>
      <td>{value(s.phaseMetrics)}</td>
    </tr>
  )
  const face = (data: MonitorMetricSummary, keys: (keyof MonitorMetricSummary['face'])[]): string =>
    keys.map((key) => pct(data.face[key], data.payloads)).join(' / ')
  const change = s.session.lastChange
  return (
    <main>
      <header>
        <div>
          <h1>Sensing monitor</h1>
          <small>Updated {time(s.t)} · memory only</small>
        </div>
        <span className="pill">{s.phase}</span>
      </header>
      <div className="status">
        <b>SDK {s.processing}</b>
        <span>capture {s.capture}</span>
        <span>validation {s.validation?.code ?? '—'}</span>
      </div>
      <p className="hint">{s.validation?.hint || 'No validation hint received.'}</p>
      <section className="signals">
        <table>
          <thead>
            <tr>
              <th scope="col">Signal</th>
              <th scope="col">
                Last 10 s <small>({s.recent.durationSec.toFixed(0)} s)</small>
              </th>
              <th scope="col">
                Since phase start <small>({s.phaseMetrics.durationSec.toFixed(0)} s)</small>
              </th>
            </tr>
          </thead>
          <tbody>
            {row('Raw SDK payloads / s', (d) => perSec(d.payloads, d.durationSec))}
            {row('Snapshots sent / s', (d) => perSec(d.snapshots, d.durationSec))}
            {row('Validation code counts', (d) => codes(d.validationCodes))}
            {row('Pulse: present / stable / confidence', (d) => signal(d, 'pulse'))}
            {row('Breathing: present / stable / confidence', (d) => signal(d, 'breathing'))}
            {row('HRV: present / stable / confidence', (d) => signal(d, 'hrv'))}
            {row('Face object / landmarks / Ovra present', (d) =>
              face(d, ['object', 'landmarks', 'present'])
            )}
            {row('Blink fields / talk fields / expression scores', (d) =>
              face(d, ['blinking', 'talking', 'expressions'])
            )}
          </tbody>
        </table>
        <small className="legend">
          Presence and stable: % of payloads. Confidence: mean 0–100; — means unavailable.
        </small>
      </section>
      <section>
        <h2>Ovra state</h2>
        <p>
          Calibration stable pulse{' '}
          <b>
            {s.state.pulseCount} / {s.state.pulseNeeded}
          </b>{' '}
          · span{' '}
          <b>
            {s.state.pulseSpanSec.toFixed(1)} / {s.state.pulseSpanNeededSec} s
          </b>{' '}
          · baseline <b>{s.state.baseline ? 'yes' : 'no'}</b>
        </p>
        {s.state.baselineFailure && <p className="failure">{s.state.baselineFailure}</p>}
        <p>
          Last face{' '}
          <b>
            {s.state.secondsSinceFace === null
              ? 'never in this phase'
              : `${s.state.secondsSinceFace.toFixed(1)} s ago`}
          </b>{' '}
          · away countdown{' '}
          <b>
            {s.state.awayCountdownSec === null
              ? 'inactive'
              : `${s.state.awayCountdownSec.toFixed(1)} s`}
          </b>{' '}
          / {s.state.awayNoFaceSec} s · away <b>{String(s.state.away)}</b>
        </p>
        <p>
          Situation <b>{s.state.situation ?? 'unknown'}</b> · confidence{' '}
          <b>{Math.round(s.state.confidence * 100)}%</b> · seated{' '}
          <b>{s.state.seatedMinutes.toFixed(1)} min</b> · state updated{' '}
          <b>{time(s.state.lastUpdated)}</b>
        </p>
      </section>
      <section>
        <h2>Session</h2>
        <p>
          Status <b>{s.session.status ?? 'none'}</b> · remaining{' '}
          <b>{s.session.remainingSec === null ? '—' : `${s.session.remainingSec} s`}</b>
        </p>
        <p>
          Last change{' '}
          {change ? (
            <>
              <b>{change.status}</b> · {change.reason} · source <b>{change.source}</b> ·{' '}
              {time(change.t)}
            </>
          ) : (
            '—'
          )}
        </p>
      </section>
      <section>
        <h2>Music</h2>
        <p>
          Available <b>{String(s.music.available)}</b> · target <b>{s.music.target ?? '—'}</b> ·
          Leave-alone <b>{String(s.music.leaveAlone)}</b>
        </p>
        <p className="track">
          {s.music.name ? `${s.music.name} · ${s.music.artist}` : 'No now-playing track reported'}
        </p>
      </section>
    </main>
  )
}
