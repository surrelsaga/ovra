// Owner: Agent E. Session tab: new session, calibration, running.
import { useState } from 'react'
import { Play, Square } from 'lucide-react'
import type {
  Activity,
  AppSettings,
  CameraMode,
  MusicStatus,
  PrivacySettings,
  Session
} from '@shared/types'
import { ovra, usePush } from '../shared/bridge'
import { Button, ChoiceGroup, MoonOrb, Progress, Toggle } from '../ui'
import { ACTIVITIES, ACTIVITY_LABEL, fmtClock, fmtMinutes, mainConfig } from './config'

const NO_MUSIC: MusicStatus = {
  available: false,
  leaveAlone: false,
  target: null,
  nowPlaying: null,
  scoringQueue: 0,
  scoredCount: 0
}

export function NewSession(props: {
  privacy: PrivacySettings
  settings: AppSettings
  onStarted: (s: Session) => void
}): React.JSX.Element {
  const { privacy, settings } = props
  const cameraOn = privacy.camera === 'yes'
  const [activity, setActivity] = useState<Activity>('deep-work')
  const [length, setLength] = useState<number | 'custom'>(60)
  const [custom, setCustom] = useState(mainConfig.customMin.default)
  const [cameraMode, setCameraMode] = useState<CameraMode>(privacy.cameraMode)
  const [music, setMusic] = useState(privacy.music === 'spotify')
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const { min, max } = mainConfig.customMin
  const lengthMin = length === 'custom' ? custom : length
  const validLength = Number.isFinite(lengthMin) && lengthMin >= min && lengthMin <= max

  const start = async (): Promise<void> => {
    setStarting(true)
    setError(null)
    try {
      props.onStarted(
        await ovra().invoke('session:start', {
          activity,
          lengthMin,
          cameraMode,
          checkinIntervalMin: settings.checkinIntervalMin,
          music
        })
      )
    } catch {
      setError('Couldn’t start the session. Try again.')
    } finally {
      setStarting(false)
    }
  }

  return (
    <section className="page" aria-labelledby="new-session-title">
      <header className="page__header">
        <h1 id="new-session-title">New session</h1>
        <p>Pick what you’re doing and for how long.</p>
      </header>
      <div className="panel stack">
        <ChoiceGroup
          legend="Activity"
          name="activity"
          columns={5}
          options={ACTIVITIES}
          value={activity}
          onChange={setActivity}
        />
        <ChoiceGroup
          legend="Length"
          name="length"
          columns={5}
          options={[
            ...mainConfig.lengthsMin.map((m) => ({ value: m, label: fmtMinutes(m) })),
            { value: 'custom' as const, label: 'Custom' }
          ]}
          value={length}
          onChange={setLength}
        />
        {length === 'custom' && (
          <label className="field">
            <span className="field__label">
              Minutes ({min}–{max})
            </span>
            <input
              className="input"
              type="number"
              min={min}
              max={max}
              value={custom}
              onChange={(e) => setCustom(e.target.valueAsNumber)}
              aria-invalid={!validLength}
            />
          </label>
        )}
        <ChoiceGroup
          legend="Camera"
          name="camera-mode"
          disabled={!cameraOn}
          description={
            cameraOn
              ? undefined
              : 'The camera is off (you chose Not now). You still get the timer, music and timed nudges. Change it in Privacy.'
          }
          options={[
            {
              value: 'checkins',
              label: 'Check-ins',
              hint: `About 90 s every ${settings.checkinIntervalMin} min`
            },
            {
              value: 'continuous',
              label: 'The whole session',
              hint: 'Camera stays on until you end'
            }
          ]}
          value={cameraOn ? cameraMode : null}
          onChange={setCameraMode}
        />
        <Toggle
          label="Music"
          hint={
            music
              ? 'Ovra picks songs from your Spotify to fit how you’re doing'
              : 'No music this session'
          }
          checked={music}
          onChange={setMusic}
        />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="page__actions">
        <Button
          variant="primary"
          icon={<Play />}
          disabled={!validLength || starting}
          onClick={() => void start()}
        >
          Start session
        </Button>
      </div>
    </section>
  )
}

export function Calibration({ session }: { session: Session }): React.JSX.Element {
  const cal = usePush('push:calibration', { progress: 0, hint: null })
  const music = usePush('push:music', NO_MUSIC)
  const secLeft = Math.ceil((1 - cal.progress) * mainConfig.calibrationSec)
  return (
    <section className="page page--center" aria-labelledby="calibration-title">
      <MoonOrb mood="calm" listening away={false} size={128} />
      <h1 id="calibration-title">Getting to know today’s you</h1>
      <p className="muted">
        Sit back so your shoulders and chest are in view, and breathe normally. The camera is on;
        nothing is recorded.
      </p>
      <div className="calibration">
        <Progress value={cal.progress} label="Calibration progress" />
        <div className="calibration__meta">
          <span aria-live="polite">{cal.hint ?? 'Looking good'}</span>
          <span>{secLeft > 0 ? `About ${secLeft} s left` : 'Almost done'}</span>
        </div>
        {session.config.music && music.scoringQueue > 0 && (
          <p className="muted small">
            Getting to know your music · {music.scoredCount} sorted, {music.scoringQueue} to go
          </p>
        )}
      </div>
      <Button variant="ghost" onClick={() => void ovra().invoke('session:end')}>
        Cancel session
      </Button>
    </section>
  )
}

export function Running({ session }: { session: Session }): React.JSX.Element {
  const tick = usePush('push:session-tick', {
    sessionId: session.id,
    elapsedSec: 0,
    remainingSec: session.config.lengthMin * 60
  })
  return (
    <section className="page page--center" aria-labelledby="running-title">
      <MoonOrb mood="calm" listening={false} away={session.status === 'on-break'} size={96} />
      <h1 id="running-title">{session.status === 'on-break' ? 'On a break' : 'Session running'}</h1>
      <p className="big-number" aria-label="Time left">
        {fmtClock(tick.remainingSec)}
      </p>
      <p className="muted">
        {ACTIVITY_LABEL[session.config.activity]} · {fmtMinutes(session.config.lengthMin)} · the
        moon is on your screen
      </p>
      <Button variant="danger" icon={<Square />} onClick={() => void ovra().invoke('session:end')}>
        End session
      </Button>
    </section>
  )
}
