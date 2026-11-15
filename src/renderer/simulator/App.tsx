// Dev simulator: pick what the "camera" sees and watch what the app decides.
import type React from 'react'
import { useEffect, useState } from 'react'
import { type SimAction, type SimulatorStatus } from '@shared/types'
import { SCENARIO_LABEL, MOOD_LABEL, MUSIC_LABEL } from '../../main/simulator/display'
import { ovra } from '../shared/bridge'

const INITIAL: SimulatorStatus = {
  scenario: 'calm',
  fastMode: true,
  speed: 'instant',
  state: null,
  targetWord: null,
  lastNudge: null,
  phase: 'idle'
}

const ACTIONS: [SimAction, string][] = [
  ['tilt-left', 'Tilt left'],
  ['tilt-right', 'Tilt right'],
  ['stand-up', 'Stand up'],
  ['breathing-slows', 'Breathing slows']
]

export function App(): React.JSX.Element {
  const [status, setStatus] = useState(INITIAL)
  const [switching, setSwitching] = useState(false)
  const [musicHint, setMusicHint] = useState('')
  useEffect(() => {
    void ovra().invoke('simulator:status').then(setStatus)
    return ovra().on('push:simulator', setStatus)
  }, [])

  const { state } = status
  const mood = state?.away ? MOOD_LABEL.away : state?.situation ? MOOD_LABEL[state.situation] : '—'
  const camera = status.phase !== 'idle'

  return (
    <main>
      <p className="banner" role="status">
        SIMULATED — no camera
      </p>

      <h2>Scenario</h2>
      <div className="grid" role="radiogroup" aria-label="Scenario">
        {(Object.keys(SCENARIO_LABEL) as (keyof typeof SCENARIO_LABEL)[]).map((id) => (
          <button
            key={id}
            role="radio"
            aria-checked={status.scenario === id}
            className={status.scenario === id ? 'on' : ''}
            onClick={() =>
              void ovra().invoke('simulator:set-scenario', { scenario: id }).then(setStatus)
            }
          >
            {SCENARIO_LABEL[id]}
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

      <h2>Speed</h2>
      <div className="speeds" role="group" aria-label="Speed">
        {(['instant', 'fast', 'normal'] as const).map((speed) => (
          <button
            key={speed}
            aria-pressed={status.speed === speed}
            className={status.speed === speed ? 'on' : ''}
            onClick={() => void ovra().invoke('simulator:set-speed', { speed }).then(setStatus)}
          >
            {speed === 'instant' ? 'Instant' : speed === 'fast' ? 'Fast' : 'Normal'}
          </button>
        ))}
      </div>

      <h2>What the app decided</h2>
      <dl>
        <dt>Sensing</dt>
        <dd className={camera ? 'live' : ''}>{status.phase}</dd>
        <dt>Current mood</dt>
        <dd>
          {mood}
          {state?.situation && !state.away ? ` · ${Math.round(state.confidence * 100)}%` : ''}
        </dd>
        <dt>Building toward</dt>
        <dd role="status">{status.countdown ?? status.why?.text ?? 'Waiting for readings'}</dd>
        <dt>Music</dt>
        <dd>{status.target ? MUSIC_LABEL[status.target] : '—'}</dd>
        <dt>Last nudge</dt>
        <dd>{status.lastNudge?.message ?? '—'}</dd>
      </dl>
      <button
        className="switch-music"
        disabled={switching}
        onClick={async () => {
          setSwitching(true)
          setMusicHint('')
          try {
            await ovra().invoke('simulator:switch-music')
            setMusicHint(
              'Pick requested. Spotify must be open, with session music on and switching allowed.'
            )
          } catch {
            setMusicHint("Couldn't switch music. Check Spotify and try again.")
          } finally {
            setSwitching(false)
          }
        }}
      >
        {switching ? 'Switching…' : 'Switch music now'}
      </button>
      <p className="hint" role="status">
        {musicHint || 'Plays the pick for the current target. Never opens Spotify.'}
      </p>
    </main>
  )
}
