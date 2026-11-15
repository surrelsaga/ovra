import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ovra } from '../shared/bridge'
import { Button } from '../ui'

export function MusicHelp({ onDone }: { onDone: () => Promise<void> }): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current!
    element.showModal()
    return () => {
      element.close()
      previous?.focus()
    }
  }, [])

  const finish = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await onDone()
    } catch {
      setError('Couldn’t save this choice. Try again.')
      setBusy(false)
    }
  }
  const add = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const playlist = await ovra().invoke('music:add-playlist', { url: url.trim() })
      if (playlist.readError) {
        setError(playlist.readError)
        setBusy(false)
        return
      }
      await onDone()
    } catch {
      setError('Couldn’t add that playlist. Paste a public Spotify playlist link and try again.')
      setBusy(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      className="panel stack music-help"
      aria-labelledby="music-help-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) void finish()
      }}
    >
      <h2 id="music-help-title" className="panel__title">
        Ovra can play your own playlists
      </h2>
      <p className="muted small">
        Paste a Spotify playlist and Ovra picks the song that fits how you’re doing: calmer when
        you’re stressed, more upbeat when you’re tired. It reads up to 100 songs per playlist.
      </p>
      <ol className="music-help__steps">
        <li>
          Open a playlist <strong>you made</strong> in Spotify, click{' '}
          <strong>··· → Add to profile</strong> so it’s public.
        </li>
        <li>
          <strong>··· → Share → Copy link to playlist</strong>.
        </li>
      </ol>
      <p className="music-help__warning small">
        <strong>Liked Songs won’t work.</strong> Spotify doesn’t let it be shared. Make a new
        playlist and drag your liked songs in.
      </p>
      <form className="paste" onSubmit={(event) => void add(event)}>
        <label className="field paste__field">
          <span className="field__label">Paste playlist link</span>
          <input
            className="input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://open.spotify.com/playlist/…"
            inputMode="url"
            autoFocus
            aria-invalid={!!error}
            disabled={busy}
          />
        </label>
        <Button type="submit" variant="primary" disabled={busy || !url.trim()}>
          Add
        </Button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="saved">
        <Button variant="ghost" disabled={busy} onClick={() => void finish()}>
          Later
        </Button>
        <span className="muted small">You can add more in Music anytime.</span>
      </div>
    </dialog>
  )
}
