// Owner: Agent E. Music library: playlist links, songs by tab, leave-alone, clear.
import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import type { MusicStatus, PlaylistLink, Song } from '@shared/types'
import { ovra, usePush } from '../shared/bridge'
import { Button, ConfirmButton, EnergyDots, Toggle } from '../ui'
import { musicUiConfig } from './config'
import {
  SOURCE_LABEL,
  SONG_TAB_LABEL,
  SONG_MOOD_LABEL,
  SINGING_LABEL,
  effectiveEnergy,
  songTab,
  type SongTab
} from './config'

const TABS: SongTab[] = ['Calm', 'Focus', 'Boost', 'Not sure yet']

export function Music(props: {
  initialStatus: MusicStatus
  onHelp?: () => void
  helpOpen?: boolean
}): React.JSX.Element {
  const status = usePush('push:music', props.initialStatus)
  // Optimistic toggle until the next music status push arrives.
  const [override, setOverride] = useState<{ value: boolean; from: MusicStatus } | null>(null)
  const leaveAlone = override?.from === status ? override.value : status.leaveAlone
  const [library, setLibrary] = useState<{ songs: Song[]; playlists: PlaylistLink[] }>({
    songs: [],
    playlists: []
  })
  const [tab, setTab] = useState<SongTab>('Focus')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = (): void => {
    ovra()
      .invoke('music:library')
      .then(setLibrary)
      .catch(() => undefined)
  }
  useEffect(load, [status.scoredCount, props.helpOpen])
  useEffect(() => {
    const refresh = (): void => {
      void ovra()
        .invoke('music:status')
        .catch(() => undefined)
    }
    refresh()
    const timer = setInterval(refresh, musicUiConfig.availabilityPollMs)
    return () => clearInterval(timer)
  }, [])

  const add = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      await ovra().invoke('music:add-playlist', { url: url.trim() })
      setUrl('')
      load()
    } catch {
      setError('Not a Spotify playlist link')
    }
  }

  const songs = library.songs.filter((s) => songTab(s) === tab)

  return (
    <section className="page" aria-labelledby="music-title">
      <header className="page__header">
        <h1 id="music-title">Music</h1>
        {status.scoringQueue > 0 && (
          <p>Getting to know your music · {status.scoringQueue} songs left</p>
        )}
        {status.available && <p className="small">Spotify is running</p>}
        {!status.available && (
          <p className="muted" role="status">
            Spotify isn&apos;t open
          </p>
        )}
      </header>

      <div className="panel stack">
        <form className="paste" onSubmit={(e) => void add(e)}>
          <label className="field paste__field">
            <span className="field__label">Paste a Spotify playlist link</span>
            <input
              className="input"
              type="text"
              inputMode="url"
              placeholder="https://open.spotify.com/playlist/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={!!error}
            />
          </label>
          <Button type="submit" variant="primary" icon={<Plus />} disabled={!url.trim()}>
            Add
          </Button>
        </form>
        <button type="button" className="text-link" onClick={props.onHelp}>
          How do I add one?
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {library.playlists.length > 0 && (
          <ul className="chips">
            {library.playlists.map((p) => (
              <li key={p.uri} className="chip">
                <span className="chip__text">
                  <span>{p.name ?? p.url}</span>
                  <small>
                    {p.readError ??
                      (p.trackCount !== undefined
                        ? `Read ${p.trackCount} songs`
                        : 'Songs will be learned as they play')}
                  </small>
                </span>
                <button
                  type="button"
                  className="chip__remove"
                  aria-label={`Remove ${p.name ?? 'playlist'}`}
                  onClick={async () => {
                    await ovra().invoke('music:remove-playlist', { uri: p.uri })
                    load()
                  }}
                >
                  <X />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Toggle
          label="Leave my music alone"
          hint="Ovra stops switching songs but keeps learning from what plays"
          checked={leaveAlone}
          onChange={(v) => {
            setOverride({ value: v, from: status })
            void ovra().invoke('music:set-leave-alone', { value: v })
          }}
        />
      </div>

      <div className="panel">
        <div className="tabs" role="tablist" aria-label="Song groups">
          {TABS.map((t) => (
            <button
              key={SONG_TAB_LABEL[t]}
              type="button"
              role="tab"
              id={`tab-${t}`}
              aria-selected={tab === t}
              aria-controls="song-panel"
              className="tabs__tab"
              onClick={() => setTab(t)}
            >
              {SONG_TAB_LABEL[t]}
              <span className="tabs__count">
                {library.songs.filter((s) => songTab(s) === t).length}
              </span>
            </button>
          ))}
        </div>
        <div id="song-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {songs.length === 0 ? (
            <p className="empty">
              {library.songs.length === 0
                ? 'No songs yet. Add a playlist or just play music during a session.'
                : 'Nothing here yet.'}
            </p>
          ) : (
            <table className="songs">
              <thead>
                <tr>
                  <th scope="col">Song</th>
                  <th scope="col">Energy</th>
                  <th scope="col">Mood</th>
                  <th scope="col">Singing</th>
                  <th scope="col">Why it’s here</th>
                </tr>
              </thead>
              <tbody>
                {songs.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="songs__title">{s.title}</div>
                      <div className="muted small">{s.artist}</div>
                    </td>
                    <td>{s.scores ? <EnergyDots energy={effectiveEnergy(s) ?? 0} /> : '—'}</td>
                    <td className="cap">{s.scores ? SONG_MOOD_LABEL[s.scores.mood] : '—'}</td>
                    <td className="cap">{s.scores ? SINGING_LABEL[s.scores.vocals] : '—'}</td>
                    <td className="muted small">
                      {s.scores
                        ? SOURCE_LABEL[s.learned ? 'learned' : s.scores.source]
                        : 'Not sorted yet'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="page__actions page__actions--start">
        <ConfirmButton
          label="Clear music library"
          confirmLabel="Yes, clear what Ovra learned"
          icon={<Trash2 />}
          onConfirm={async () => {
            await ovra().invoke('music:clear-library')
            load()
          }}
        />
      </div>
    </section>
  )
}
