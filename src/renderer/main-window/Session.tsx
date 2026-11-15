// Owner: Agent E. Session tab: new session, calibration, running.
import { useEffect, useState } from 'react'
import { Play, RotateCcw, Square } from 'lucide-react'
import type {
  Activity,
  AppSettings,
  CalibrationAction,
  CameraMode,
  MusicStatus,
  PrivacySettings,
  Session
} from '@shared/types'
import { ovra, usePush } from '../shared/bridge'
import { Button, ChoiceGroup, MoonOrb, Progress, Toggle } from '../ui'
import { ACTIVITIES, ACTIVITY_LABEL, fmtClock, fmtMinutes, mainConfig } from './config'
import { SessionCamera } from './SessionCamera'
import { SpotifyStartDialog } from './SpotifyStartDialog'

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
  beforeStart?: () => Promise<void>
}): React.JSX.Element {
  const { privacy, settings } = props
  const cameraOn = privacy.camera === 'yes'
  const [activity, setActivity] = useState<Activity>('focus')
  const [length, setLength] = useState<number | 'custom'>(60)
  const [custom, setCustom] = useState(mainConfig.customMin.default)
  const [cameraMode, setCameraMode] = useState<CameraMode>(privacy.cameraMode)
  const [demo, setDemo] = useState(false)
  const [music, setMusic] = useState(privacy.music === 'spotify')
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [spotifyChoice, setSpotifyChoice] = useState<((music: boolean | null) => void) | null>(null)

  const { min, max } = mainConfig.customMin
  const lengthMin = length === 'custom' ? custom : length
  const validLength = Number.isFinite(lengthMin) && lengthMin >= min && lengthMin <= max

  const start = async (): Promise<void> => {
    setStarting(true)
    setError(null)
    try {
      await props.beforeStart?.()
      let sessionMusic = music
      if (music && !(await ovra().invoke('music:status')).available) {
        const choice = await new Promise<boolean | null>((resolve) =>
          setSpotifyChoice(() => resolve)
        )
        setSpotifyChoice(null)
        if (choice === null) return
        sessionMusic = choice
      }
      props.onStarted(
        await ovra().invoke('session:start', {
          activity,
          lengthMin,
          cameraMode: demo ? 'continuous' : cameraMode,
          ...(demo ? { demo: true } : {}),
          checkinIntervalMin: settings.checkinIntervalMin,
          music: sessionMusic
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
      {spotifyChoice && <SpotifyStartDialog onDone={spotifyChoice} />}
      <header className="page__header">
        <h1 id="new-session-title">New session</h1>
        <p>Pick what you’re doing and for how long.</p>
      </header>
      <div className="panel stack">
        <ChoiceGroup
          legend="What are you doing?"
          name="activity"
          columns={3}
          options={ACTIVITIES}
          value={activity}
          onChange={(value) => {
            setActivity(value)
            if (!demo) setLength(mainConfig.activityLengthMin[value])
          }}
        />
        <ChoiceGroup
          legend="How long?"
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
          disabled={!cameraOn || demo}
          description={
            cameraOn
              ? undefined
              : 'The camera is off (you chose Not now). You still get the timer, music and break reminders. Change it in Privacy.'
          }
          options={[
            {
              value: 'checkins',
              label: 'Every few minutes',
              hint: `About 90 s every ${settings.checkinIntervalMin} min`
            },
            {
              value: 'continuous',
              label: 'The whole session',
              hint: 'Camera stays on until you end'
            }
          ]}
          value={cameraOn ? (demo ? 'continuous' : cameraMode) : null}
          onChange={setCameraMode}
        />
        <Toggle
          label="Demo mode"
          hint="Try the moods in about 16 minutes. Ovra uses your real heart rate and breathing, with the same rules and shorter waits. A mood only appears if the readings match."
          checked={demo}
          onChange={(enabled) => {
            setDemo(enabled)
            if (enabled) {
              setLength('custom')
              setCustom(mainConfig.demoLengthMin)
            }
          }}
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

export function Calibration({
  session,
  settings
}: {
  session: Session
  settings: AppSettings
}): React.JSX.Element {
  const cal = usePush('push:calibration', { progress: 0, hint: null, starting: true })
  const music = usePush('push:music', NO_MUSIC)
  const [preview, setPreview] = useState<MediaStream | null>(null)
  const [cameraError, setCameraError] = useState(false)
  const devVideo = ovra().isDev ? settings.devVideoSource : null
  const failed = session.calibrationFailed
  // The camera is off while Ovra waits on Try again or Start anyway, so is the preview.
  const previewEnabled = session.status === 'calibrating' && session.sensingEnabled && !failed
  const framing = cal.framing === true
  const starting = cal.starting === true
  const stage = starting
    ? 'Starting the camera…'
    : framing
      ? 'Getting you in view'
      : 'Getting to know you'
  const choose = (action: CalibrationAction): void =>
    void ovra().invoke('session:calibration', { action })
  useEffect(() => {
    if (!previewEnabled || devVideo || !navigator.mediaDevices?.getUserMedia) return
    let stream: MediaStream | null = null
    let cancelled = false
    void navigator.mediaDevices
      .getUserMedia({ audio: false, video: true })
      .then((result) => {
        if (cancelled) result.getTracks().forEach((track) => track.stop())
        else {
          stream = result
          setPreview(result)
        }
      })
      .catch(() => {
        if (!cancelled) setCameraError(true)
      })
    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
      setPreview(null)
    }
  }, [previewEnabled, devVideo])
  const secLeft = Math.ceil((1 - cal.progress) * mainConfig.calibrationSec)
  if (failed)
    return (
      <section className="page page--center" aria-labelledby="calibration-title">
        <MoonOrb mood="dim" listening={false} away={false} size={128} />
        <h1 id="calibration-title">Getting to know you</h1>
        <div className="calibration-hint" role="alert">
          {session.calibrationSdkFailed ? (
            // The SDK failed, not the readings: say why, without posture advice.
            <p className="calibration-hint__text">{failed}</p>
          ) : (
            <>
              <p className="muted">I couldn’t get a steady read this time.</p>
              <p className="calibration-hint__text">{failed}</p>
              <p className="muted">
                Even light on your face and a still moment usually help. Or start now, and I’ll get
                to know you as we go.
              </p>
            </>
          )}
        </div>
        <div className="page__actions">
          <Button variant="primary" icon={<RotateCcw />} onClick={() => choose('retry')}>
            Try again
          </Button>
          <Button icon={<Play />} onClick={() => choose('start-anyway')}>
            Start anyway
          </Button>
        </div>
        <Button variant="ghost" onClick={() => void ovra().invoke('session:end')}>
          Cancel session
        </Button>
      </section>
    )
  return (
    <section className="page page--center" aria-labelledby="calibration-title">
      <MoonOrb mood="calm" listening calibration={cal.progress} away={false} size={128} />
      <h1 id="calibration-title" aria-live="polite">
        {stage}
      </h1>
      <p className="muted">
        {starting
          ? 'This can take a few seconds.'
          : 'Sit back so your shoulders and chest are in view, and breathe normally.'}
      </p>
      {!starting && (
        <div className="calibration-hint" role="status" aria-live="polite">
          <p className="muted">
            {cal.hint ? 'Let’s get you in view.' : 'Make yourself comfortable.'}
          </p>
          <p className="calibration-hint__text">
            {cal.hint ?? 'You’re in view. Keep breathing normally.'}
          </p>
        </div>
      )}
      {previewEnabled && (
        <div className="calibration-preview" aria-label="Live camera preview">
          {devVideo ? (
            <video
              src="ovra-preview://calibration"
              autoPlay
              muted
              loop
              playsInline
              onError={() => setCameraError(true)}
            />
          ) : (
            preview && (
              <video
                ref={(video) => {
                  if (video && video.srcObject !== preview) video.srcObject = preview
                }}
                autoPlay
                muted
                playsInline
                onError={() => setCameraError(true)}
              />
            )
          )}
          <span>Not recorded</span>
        </div>
      )}
      {cameraError && (
        <p className="muted" role="status">
          Camera preview isn’t available. I can still get to know you.
        </p>
      )}
      <div className="calibration">
        <Progress value={cal.progress} label="Getting to know you progress" />
        <div className="calibration__meta">
          <span>
            {stage}
            {!starting && !framing && (
              <>
                {' · '}
                <span>
                  {secLeft > 0 ? `About ${secLeft} s of steady heart rate left` : 'Almost done'}
                </span>
              </>
            )}
          </span>
          {!starting && framing && (
            <button type="button" className="text-link" onClick={() => choose('skip-framing')}>
              Skip
            </button>
          )}
        </div>
        {session.config.music && music.scoringQueue > 0 && (
          <p className="muted small">
            Getting to know your music · {music.scoringQueue} songs left
          </p>
        )}
      </div>
      <Button variant="ghost" onClick={() => void ovra().invoke('session:end')}>
        Cancel session
      </Button>
    </section>
  )
}

export function Running({
  session,
  initialMusic = NO_MUSIC,
  sdkFailed = false,
  cameraConsent = false,
  showCameraInitially = false
}: {
  session: Session
  initialMusic?: MusicStatus
  sdkFailed?: boolean
  cameraConsent?: boolean
  showCameraInitially?: boolean
}): React.JSX.Element {
  const music = usePush('push:music', initialMusic)
  const [showCamera, setShowCamera] = useState(showCameraInitially)
  const [visible, setVisible] = useState(document.visibilityState === 'visible')
  const mainWindow = usePush('push:main-window', {
    visible: document.visibilityState === 'visible'
  })
  const orb = usePush('push:orb', { mood: 'calm', listening: false, paused: true, away: false })
  useEffect(() => {
    const changed = (): void => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  const canPreview = cameraConsent && session.sensingEnabled && !orb.paused
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
      {sdkFailed && (
        <p className="muted" role="status">
          Couldn’t start the camera check. Your session will keep running with timed breaks.
        </p>
      )}
      {session.config.music && !music.available && (
        <p className="muted" role="status">
          Spotify isn&apos;t open. Open the Spotify app to play your music.
        </p>
      )}
      {cameraConsent && session.sensingEnabled && (
        <>
          <Button
            variant="ghost"
            disabled={orb.paused}
            aria-expanded={showCamera && canPreview}
            onClick={() => setShowCamera(!showCamera)}
          >
            {orb.paused ? 'Camera paused by you' : showCamera ? 'Hide camera' : 'Show camera'}
          </Button>
          {showCamera && canPreview && visible && mainWindow.visible && <SessionCamera />}
        </>
      )}
      <Button variant="danger" icon={<Square />} onClick={() => void ovra().invoke('session:end')}>
        End session
      </Button>
    </section>
  )
}
