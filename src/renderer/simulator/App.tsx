// Dev simulator: pick what the "camera" sees and watch what the app decides.
import type React from 'react'
import { useEffect, useState } from 'react'
import { ORB_MOOD, type SimAction, type SimScenario, type SimulatorStatus } from '@shared/types'
import { ovra } from '../shared/bridge'

const INITIAL: SimulatorStatus = {
  scenario: 'calm',
  fastMode: true,
  state: null,
  targetWord: null,
  lastNudge: null,
  phase: 'idle'
}

const SCENARIOS: [SimScenario, string][] = [
  ['calm', 'Calm'],
  ['tense', 'Tense'],
  ['crashing', 'Crashing'],
  ['low', 'Low'],
  ['good', 'Good'],
  ['away', 'Away']
]

const ACTIONS: [SimAction, string][] = [
  ['tilt-left', 'Tilt left'],
  ['tilt-right', 'Tilt right'],
  ['stand-up', 'Stand up'],
  ['breathing-slows', 'Breathing slows']
]

export function App(): React.JSX.Element {
  const [status, setStatus] = useState(INITIAL)
  useEffect(() => {
    void ovra().invoke('simulator:status').then(setStatus)
    return ovra().on('push:simulator', setStatus)
  }, [])

  const { state } = status
  const situation = state?.away ? 'away' : (state?.situation ?? '—')
  const mood = state?.away ? 'away' : state?.situation ? ORB_MOOD[state.situation] : '—'
  const camera = status.phase !== 'idle'

  return (
    <main>
      <p className="banner" role="status">
        SIMULATED — no camera
      </p>

      <h2>Scenario</h2>
      <div className="grid" role="radiogroup" aria-label="Scenario">
        {SCENARIOS.map(([id, label]) => (
          <button
            key={id}
            role="radio"
            aria-checked={status.scenario === id}
            className={status.scenario === id ? 'on' : ''}
            onClick={() =>
              void ovra().invoke('simulator:set-scenario', { scenario: id }).then(setStatus)
            }
          >
            {label}
          </button>
        ))}
      </div>

      <h2>Actions (about 8 s)</h2>
      <div className="grid">
        {ACTIONS.map(([id, label]) => (
          <button key={id} onClick={() => void ovra().invoke('simulator:action', { action: id })}>
            {label}
          </button>
        ))}
      </div>
      {!camera && (
        <p className="hint">
          Camera is off between check-ins; actions only register while a phase runs.
        </p>
      )}

      <label className="toggle">
        <input
          type="checkbox"
          checked={status.fastMode}
          onChange={(e) =>
            void ovra()
              .invoke('simulator:set-fast-mode', { value: e.target.checked })
              .then(setStatus)
          }
        />
        Fast mode
      </label>

      <h2>What the app decided</h2>
      <dl>
        <dt>Sensing</dt>
        <dd className={camera ? 'live' : ''}>{status.phase}</dd>
        <dt>Situation</dt>
        <dd>
          {situation}
          {state?.situation && !state.away ? ` · ${Math.round(state.confidence * 100)}%` : ''}
        </dd>
        <dt>Orb</dt>
        <dd>{mood}</dd>
        <dt>Music</dt>
        <dd>{status.targetWord ?? '—'}</dd>
        <dt>Last nudge</dt>
        <dd>{status.lastNudge?.message ?? '—'}</dd>
      </dl>
    </main>
  )
}
