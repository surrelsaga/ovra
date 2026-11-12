// Owner: Agent C (music). Songs learned as they play + pasted playlist links. See PLAN.md §6.
import type { NowPlaying, PlaylistLink, Song, Storage } from '@shared/types'

const PLAYLIST_ID = /^[A-Za-z0-9]{22}$/

/**
 * Parses a pasted playlist link (https://open.spotify.com/playlist/<id>?si=…, optional /intl-xx/,
 * or spotify:playlist:<id>). Returns null if it isn't one.
 */
export function parsePlaylistUrl(input: string): { uri: string; url: string } | null {
  const s = input.trim()
  const direct = /^spotify:playlist:([A-Za-z0-9]+)$/.exec(s)
  if (direct) {
    return PLAYLIST_ID.test(direct[1])
      ? { uri: s, url: `https://open.spotify.com/playlist/${direct[1]}` }
      : null
  }
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.hostname !== 'open.spotify.com') return null
  const parts = u.pathname.split('/').filter(Boolean)
  if (parts.length === 3 && parts[0].startsWith('intl-')) parts.shift()
  if (parts.length !== 2 || parts[0] !== 'playlist' || !PLAYLIST_ID.test(parts[1])) return null
  return { uri: `spotify:playlist:${parts[1]}`, url: s }
}

export interface Library {
  load(): Promise<void>
  songs(): Song[]
  get(id: string): Song | undefined
  playlists(): PlaylistLink[]
  addPlaylist(url: string, now: number): Promise<PlaylistLink>
  removePlaylist(uri: string): Promise<void>
  /** Records a playing track. Ads and non-tracks return null. */
  learn(t: NowPlaying, now: number): Promise<Song | null>
  /** Replaces a known song (ignored if it was cleared meanwhile). */
  update(song: Song): Promise<void>
  /** Clear music library: removes songs and their scores, keeps playlists. */
  clear(): Promise<void>
  /** Everything was deleted elsewhere: drop memory, write nothing back. */
  forget(): void
}

export function createLibrary(storage: Storage): Library {
  let songs = new Map<string, Song>()
  let playlists: PlaylistLink[] = []
  // Bumped by forget()/clear() so queued writes of old data are skipped.
  let gen = 0
  let chain: Promise<void> = Promise.resolve()

  const save = (file: 'songs' | 'playlists'): Promise<void> => {
    const g = gen
    chain = chain
      .then(() => {
        if (g !== gen) return
        return file === 'songs'
          ? storage.write('songs', [...songs.values()])
          : storage.write('playlists', playlists)
      })
      .catch(() => {})
    return chain
  }

  return {
    async load() {
      const list = await storage.read<Song[]>('songs', [])
      songs = new Map(list.map((s) => [s.id, s]))
      playlists = await storage.read<PlaylistLink[]>('playlists', [])
    },
    songs: () => [...songs.values()],
    get: (id) => songs.get(id),
    playlists: () => [...playlists],

    async addPlaylist(url, now) {
      const parsed = parsePlaylistUrl(url)
      if (!parsed) throw new Error('That doesn’t look like a Spotify playlist link.')
      const existing = playlists.find((p) => p.uri === parsed.uri)
      if (existing) return existing
      const link: PlaylistLink = { ...parsed, addedAt: now }
      playlists = [...playlists, link]
      await save('playlists')
      return link
    },

    async removePlaylist(uri) {
      playlists = playlists.filter((p) => p.uri !== uri)
      await save('playlists')
    },

    async learn(t, now) {
      if (t.isAd || !t.id.startsWith('spotify:track:')) return null
      const prev = songs.get(t.id)
      const song: Song = prev
        ? { ...prev, lastPlayedAt: now, playCount: prev.playCount + 1 }
        : {
            id: t.id,
            title: t.name,
            artist: t.artist,
            album: t.album || undefined,
            durationMs: t.durationMs || undefined,
            firstSeenAt: now,
            lastPlayedAt: now,
            playCount: 1
          }
      songs.set(song.id, song)
      await save('songs')
      return song
    },

    async update(song) {
      if (!songs.has(song.id)) return
      songs.set(song.id, song)
      await save('songs')
    },

    async clear() {
      gen++
      songs = new Map()
      await (chain = chain.then(() => storage.remove('songs')).catch(() => {}))
    },

    forget() {
      gen++
      songs = new Map()
      playlists = []
    }
  }
}
