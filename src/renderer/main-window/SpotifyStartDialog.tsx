import { useEffect, useRef } from 'react'
import { ovra } from '../shared/bridge'
import { Button } from '../ui'
import { musicUiConfig } from './config'

export function SpotifyStartDialog({
  onDone
}: {
  onDone: (music: boolean | null) => void
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current!
    element.showModal()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const check = async (): Promise<void> => {
      try {
        const status = await ovra().invoke('music:status')
        if (cancelled) return
        if (status.available) return onDone(true)
      } catch {
        // A failed check leaves both choices available and retries while the dialog is open.
      }
      if (!cancelled) timer = setTimeout(() => void check(), musicUiConfig.startPollMs)
    }
    timer = setTimeout(() => void check(), musicUiConfig.startPollMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
      element.close()
      previous?.focus()
    }
  }, [onDone])

  return (
    <dialog
      ref={dialog}
      className="panel stack music-help"
      aria-labelledby="spotify-start-title"
      aria-describedby="spotify-start-body"
      onCancel={(event) => {
        event.preventDefault()
        onDone(null)
      }}
    >
      <h2 id="spotify-start-title" className="panel__title">
        Spotify isn&apos;t open
      </h2>
      <p id="spotify-start-body" className="muted small">
        Ovra plays your music through the Spotify app. Open Spotify, and Ovra will start as soon as
        it&apos;s ready.
      </p>
      <div className="page__actions page__actions--start">
        <Button variant="primary" onClick={() => onDone(false)}>
          Start without music
        </Button>
        <Button variant="ghost" autoFocus onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </dialog>
  )
}
