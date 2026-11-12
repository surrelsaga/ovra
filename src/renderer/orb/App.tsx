// Owner: Agent E. Orb window: moon, speech bubble, now-playing chip, hover mini controls. Drag to move.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { AppWindow, Camera, CameraOff, Hand, Music, Square } from 'lucide-react'
import type { MusicStatus, OrbView } from '@shared/types'
import { ovra, usePush } from '../shared/bridge'
import { MoonOrb } from '../ui/MoonOrb'
import { awayText, orbConfig } from './config'
import './orb.css'

const START: OrbView = { mood: 'calm', listening: false, away: false }
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
  onPointerDown: (e: PointerEvent) => void
  onPointerMove: (e: PointerEvent) => void
  onPointerUp: () => void
  onKeyDown: (e: KeyboardEvent) => void
} {
  const drag = useRef<{ dx: number; dy: number; x0: number; y0: number; moving: boolean } | null>(
    null
  )
  const moveTo = (x: number, y: number): void => void ovra().invoke('window:orb-moved', { x, y })
  return {
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

export default function App(): React.JSX.Element {
  const view = usePush('push:orb', START)
  const music = usePush('push:music', NO_MUSIC)
  // Optimistic toggle until the next music status push arrives.
  const [override, setOverride] = useState<{ value: boolean; from: MusicStatus } | null>(null)
  const leaveAlone = override?.from === music ? override.value : music.leaveAlone
  const [cameraPaused, setCameraPaused] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const drag = useDrag()

  useEffect(() => {
    if (!view.away) return
    const tick = (): void => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, orbConfig.awayTickMs)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [view.away])

  const toggleCamera = (): void => {
    void ovra().invoke(cameraPaused ? 'camera:resume' : 'camera:pause')
    setCameraPaused(!cameraPaused)
  }
  const toggleMusic = (): void => {
    void ovra().invoke('music:set-leave-alone', { value: !leaveAlone })
    setOverride({ value: !leaveAlone, from: music })
  }

  return (
    <div className="orb-app">
      <div className="orb-app__bubble-zone" aria-live="polite">
        {view.bubble && <p className="bubble">{view.bubble}</p>}
      </div>

      <div
        className="orb-app__moon"
        role="button"
        tabIndex={0}
        aria-label="Ovra moon. Drag or use arrow keys to move."
        {...drag}
      >
        <MoonOrb {...view} />
      </div>

      <div className="orb-app__info">
        {view.away && view.awaySince ? (
          <p className="pill">{awayText(now - view.awaySince)}</p>
        ) : view.listening ? (
          <p className="pill pill--listening">
            <Camera aria-hidden /> Camera on
          </p>
        ) : view.nowPlaying ? (
          <p
            className="pill now-playing"
            title={`${view.nowPlaying.name} · ${view.nowPlaying.artist}`}
          >
            {view.nowPlaying.word && (
              <span className={`word word--${view.nowPlaying.word.toLowerCase()}`}>
                {view.nowPlaying.word}
              </span>
            )}
            <span className="now-playing__text">
              {view.nowPlaying.name} · <span className="muted">{view.nowPlaying.artist}</span>
            </span>
          </p>
        ) : null}
      </div>

      <div className="controls" role="toolbar" aria-label="Session controls">
        <button
          type="button"
          className="control"
          aria-pressed={cameraPaused}
          aria-label={cameraPaused ? 'Resume camera' : 'Pause camera'}
          title={cameraPaused ? 'Resume camera' : 'Pause camera'}
          onClick={toggleCamera}
        >
          {cameraPaused ? <Camera /> : <CameraOff />}
        </button>
        <button
          type="button"
          className="control"
          aria-pressed={leaveAlone}
          aria-label="Leave my music alone"
          title={leaveAlone ? 'Music: hands off (on)' : 'Leave my music alone'}
          onClick={toggleMusic}
        >
          {leaveAlone ? <Hand /> : <Music />}
        </button>
        <button
          type="button"
          className="control"
          aria-label="End session"
          title="End session"
          onClick={() => void ovra().invoke('session:end')}
        >
          <Square />
        </button>
        <button
          type="button"
          className="control"
          aria-label="Open main window"
          title="Open main window"
          onClick={() => void ovra().invoke('window:open-main')}
        >
          <AppWindow />
        </button>
      </div>
    </div>
  )
}
