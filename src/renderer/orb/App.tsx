// Owner: Agent E. Orb window: moon, speech bubble, now-playing chip, hover mini controls. Drag to move.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent
} from 'react'
import { AppWindow, Camera, CameraOff, Hand, Music, Square } from 'lucide-react'
import type { MusicStatus, OrbView } from '@shared/types'
import { ovra, usePush } from '../shared/bridge'
import { MoonOrb } from '../ui/MoonOrb'
import { awayText, cameraLabel, MUSIC_TARGET_LABEL, MUSIC_WORD_LABEL, orbConfig } from './config'
import './orb.css'

const START: OrbView = { mood: 'calm', listening: false, paused: false, away: false }
const NO_MUSIC: MusicStatus = {
  available: false,
  leaveAlone: false,
  target: null,
  nowPlaying: null,
  scoringQueue: 0,
  scoredCount: 0
}

/** Move the window by dragging the moon. Clicks under the threshold aren't drags. */
function useDrag(): {
  dragging: () => boolean
  onPointerDown: (e: PointerEvent) => void
  onPointerMove: (e: PointerEvent) => void
  onPointerUp: () => void
  onKeyDown: (e: KeyboardEvent) => void
} {
  const drag = useRef<{ dx: number; dy: number; x0: number; y0: number; moving: boolean } | null>(
    null
  )
  const dragging = useCallback(() => drag.current !== null, [])
  const moveTo = (x: number, y: number): void => void ovra().invoke('window:orb-moved', { x, y })
  return {
    dragging,
    onPointerDown: (e) => {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      drag.current = {
        dx: e.screenX - window.screenX,
        dy: e.screenY - window.screenY,
        x0: e.screenX,
        y0: e.screenY,
        moving: false
      }
    },
    onPointerMove: (e) => {
      const d = drag.current
      if (!d) return
      if (!d.moving && Math.hypot(e.screenX - d.x0, e.screenY - d.y0) < orbConfig.dragThresholdPx)
        return
      d.moving = true
      moveTo(e.screenX - d.dx, e.screenY - d.dy)
    },
    onPointerUp: () => (drag.current = null),
    onKeyDown: (e) => {
      const step = orbConfig.keyMovePx
      const delta = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step]
      }[e.key]
      if (!delta) return
      e.preventDefault()
      moveTo(window.screenX + delta[0], window.screenY + delta[1])
    }
  }
}

/**
 * Click-through: the window ignores the mouse (events still forwarded) except over [data-hit] areas.
 * Returns whether the pointer is over the orb (controls show while true, with a short grace period).
 */
function useClickThrough(dragging: () => boolean): boolean {
  const [hover, setHover] = useState(false)
  useEffect(() => {
    let ignoring: boolean | null = null
    let leave: ReturnType<typeof setTimeout> | undefined
    const setIgnore = (ignore: boolean): void => {
      if (ignoring === ignore) return
      ignoring = ignore
      void ovra().invoke('window:orb-ignore-mouse', { ignore })
    }
    const out = (): void => {
      if (dragging()) return
      setIgnore(true)
      clearTimeout(leave)
      leave = setTimeout(() => setHover(false), orbConfig.hoverGraceMs)
    }
    const onMove = (e: MouseEvent): void => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-hit]')) return out()
      clearTimeout(leave)
      setHover(true)
      setIgnore(false)
    }
    document.addEventListener('mousemove', onMove)
    document.documentElement.addEventListener('mouseleave', out)
    return () => {
      clearTimeout(leave)
      document.removeEventListener('mousemove', onMove)
      document.documentElement.removeEventListener('mouseleave', out)
    }
  }, [dragging])
  return hover
}

export default function App(): React.JSX.Element {
  const view = usePush('push:orb', START)
  const music = usePush('push:music', NO_MUSIC)
  const session = usePush('push:session', null)
  // Optimistic toggle until the next music status push arrives.
  const [override, setOverride] = useState<{ value: boolean; from: MusicStatus } | null>(null)
  const leaveAlone = override?.from === music ? override.value : music.leaveAlone
  const [now, setNow] = useState(() => Date.now())
  const { dragging, ...drag } = useDrag()
  const hover = useClickThrough(dragging)
  const [cameraNote, setCameraNote] = useState<{ on: boolean; text: string | null }>({
    on: false,
    text: null
  })
  if (cameraNote.on !== view.listening) {
    setCameraNote({ on: view.listening, text: view.listening ? 'Camera on' : 'Camera off' })
  }
  useEffect(() => {
    if (!cameraNote.text) return
    const timer = setTimeout(
      () => setCameraNote((note) => ({ ...note, text: null })),
      orbConfig.cameraNoteMs
    )
    return () => clearTimeout(timer)
  }, [cameraNote.on, cameraNote.text])
  const cameraTip = cameraLabel(view, now)
  const targetLabel = music.target
    ? MUSIC_TARGET_LABEL[music.target]
    : view.nowPlaying?.word
      ? MUSIC_WORD_LABEL[view.nowPlaying.word]
      : null
  // Why line: only while something is moving, or on hover. Never a vitals value (decision 34).
  const why = view.why && !view.away && (view.why.moving || hover) ? view.why : null

  useEffect(() => {
    if (!view.away && !view.nextCheckAt) return
    const tick = (): void => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, orbConfig.awayTickMs)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [view.away, view.nextCheckAt])

  const toggleCamera = (): void =>
    void ovra().invoke(view.paused ? 'camera:resume' : 'camera:pause')
  const toggleMusic = (): void => {
    void ovra().invoke('music:set-leave-alone', { value: !leaveAlone })
    setOverride({ value: !leaveAlone, from: music })
  }

  return (
    <div
      className="orb-app"
      style={{ '--control-tooltip-delay': `${orbConfig.tooltipDelayMs}ms` } as CSSProperties}
      data-hover={hover || undefined}
      // Mouse presses never take focus, so a later key press can't show a focus ring; Tab still can.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="orb-app__bubble-zone" aria-live="polite">
        {view.bubble && (
          <p className="bubble" data-hit>
            {view.bubble}
            {view.bubbleAction === 'show-camera' && (
              <button
                type="button"
                className="bubble__action"
                onClick={() => void ovra().invoke('window:open-main', { showCamera: true })}
              >
                Show camera
              </button>
            )}
          </p>
        )}
      </div>

      <div
        className="orb-app__moon"
        data-hit
        role="button"
        tabIndex={0}
        aria-label={`Ovra moon. ${cameraTip}. Drag or use arrow keys to move.`}
        aria-describedby="moon-camera-tip"
        {...drag}
      >
        <MoonOrb {...view} />
        {view.demo && <span className="demo-badge">Demo</span>}
        <span className="camera-tooltip" role="tooltip" id="moon-camera-tip">
          {cameraTip}
        </span>
      </div>

      <div className="orb-app__info">
        {view.away ? (
          <p className="pill" data-hit>
            {awayText(now - (view.awaySince ?? now))}
          </p>
        ) : session && session.status !== 'ended' && session.config.music && !music.available ? (
          <p className="pill" data-hit role="status">
            Open Spotify
          </p>
        ) : view.paused ? (
          <p className="pill pill--paused" data-hit>
            <span
              className="camera-dot camera-dot--paused"
              role="img"
              aria-label={cameraTip}
              tabIndex={0}
            >
              <span className="camera-tooltip" role="tooltip">
                {cameraTip}
              </span>
            </span>
            Camera paused
          </p>
        ) : cameraNote.text ? (
          <p className="pill" data-hit role="status">
            {cameraNote.text}
          </p>
        ) : view.nowPlaying ? (
          <p
            className="pill now-playing"
            data-hit
            tabIndex={0}
            aria-label={[targetLabel, view.nowPlaying.name, view.nowPlaying.artist]
              .filter(Boolean)
              .join(' · ')}
            title={[targetLabel, view.nowPlaying.name, view.nowPlaying.artist]
              .filter(Boolean)
              .join(' · ')}
          >
            {view.listening && (
              <span
                className="camera-dot camera-dot--on"
                role="img"
                aria-label={cameraTip}
                tabIndex={0}
              >
                <span className="camera-tooltip" role="tooltip">
                  {cameraTip}
                </span>
              </span>
            )}
            {view.nowPlaying.word && (
              <>
                <span className={`word word--${view.nowPlaying.word.toLowerCase()}`}>
                  {targetLabel}
                </span>
                <span aria-hidden>·</span>
              </>
            )}
            <span className="now-playing__text">
              {view.nowPlaying.name} · <span className="muted">{view.nowPlaying.artist}</span>
            </span>
          </p>
        ) : null}
        {why && (
          <p className="why" data-hit data-testid="why-line" title={why.text} aria-label={why.text}>
            <span className="why__text">{why.text}</span>
            {why.progress !== undefined && (
              <span className="why__bar" aria-hidden>
                <i style={{ width: `${Math.round(Math.min(1, why.progress) * 100)}%` }} />
              </span>
            )}
          </p>
        )}
      </div>

      <div
        className="controls"
        role="toolbar"
        aria-label="Session controls"
        data-hit={hover || undefined}
      >
        <button
          type="button"
          className="control"
          aria-pressed={view.paused}
          aria-label={view.paused ? 'Resume camera' : 'Pause camera'}
          onClick={toggleCamera}
        >
          {view.paused ? <Camera /> : <CameraOff />}
          <span className="control-tooltip" role="tooltip">
            {view.paused ? 'Resume camera' : 'Pause camera'}
          </span>
        </button>
        <button
          type="button"
          className="control"
          aria-pressed={leaveAlone}
          aria-label="Leave my music alone"
          onClick={toggleMusic}
        >
          {leaveAlone ? <Hand /> : <Music />}
          <span className="control-tooltip" role="tooltip">
            {leaveAlone ? 'Song switching is off' : 'Leave my music alone'}
          </span>
        </button>
        <button
          type="button"
          className="control"
          aria-label="End session"
          onClick={() => void ovra().invoke('session:end')}
        >
          <Square />
          <span className="control-tooltip" role="tooltip">
            End session
          </span>
        </button>
        <button
          type="button"
          className="control"
          aria-label="Open main window"
          onClick={() => void ovra().invoke('window:open-main')}
        >
          <AppWindow />
          <span className="control-tooltip" role="tooltip">
            Open main window
          </span>
        </button>
      </div>
    </div>
  )
}
