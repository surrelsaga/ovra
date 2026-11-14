// Owner: Agent C (music). Songs learned as they play + pasted playlist links. See PLAN.md §6.
import type { NowPlaying, PlaylistLink, Song, Storage } from '@shared/types'
import { musicConfig } from '../config'
import { scoreFromTags } from '../scoring/rules'
import { fetchPlaylist } from './embed'

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
  refresh(now: number): Promise<void>
  readPlaylist(link: PlaylistLink, now: number, origin?: Song['origin']): Promise<PlaylistLink>
  resolve(t: NowPlaying): NowPlaying
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

export function createLibrary(storage: Storage, f: typeof fetch = fetch): Library {
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

  const resolve = (t: NowPlaying): NowPlaying => {
    const norm = (s: string): string => s.normalize('NFKC').toLowerCase().trim()
    const known =
      songs.get(t.id) ??
      (t.id.startsWith('spotify:local:') && t.artist.trim()
        ? [...songs.values()].find(
            (s) => norm(s.title) === norm(t.name) && norm(s.artist) === norm(t.artist)
          )
        : undefined)
    return known
      ? {
          ...t,
          id: known.id,
          uri: known.id,
          name: t.name.trim() || known.title,
          artist: t.artist.trim() || known.artist
        }
      : t
  }

  async function readPlaylist(
    link: PlaylistLink,
    now: number,
    origin: Song['origin'] = 'mine'
  ): Promise<PlaylistLink> {
    const g = gen
    let result: PlaylistLink
    try {
      const e = await fetchPlaylist(link.uri, f)
      if (g !== gen || (origin === 'mine' && !playlists.some((p) => p.uri === link.uri)))
        return link
      const ids = new Set(e.trackList.map((t) => t.uri))
      for (const [id, song] of songs) {
        if (!song.playlists?.includes(link.uri) || ids.has(id)) continue
        const remaining = song.playlists.filter((uri) => uri !== link.uri)
        if (!remaining.length && !song.playCount) songs.delete(id)
        else
          songs.set(id, {
            ...song,
            playlists: remaining,
            origin: remaining.some((uri) => playlists.some((p) => p.uri === uri))
              ? 'mine'
              : song.playCount
                ? 'heard'
                : 'fallback'
          })
      }
      for (const t of e.trackList) {
        const prev = songs.get(t.uri)
        songs.set(t.uri, {
          ...prev,
          id: t.uri,
          title: t.title,
          artist: t.subtitle,
          durationMs: t.duration,
          firstSeenAt: prev?.firstSeenAt ?? now,
          playCount: prev?.playCount ?? 0,
          playable: t.isPlayable,
          origin: origin === 'mine' || prev?.origin === 'mine' ? 'mine' : (prev?.origin ?? origin),
          playlists: [...new Set([...(prev?.playlists ?? []), link.uri])],
          scores: prev?.scores ?? scoreFromTags([], now, t.title)
        })
      }
      result = {
        ...link,
        name: e.name,
        trackCount: e.trackList.length,
        fetchedAt: now,
        readError: undefined
      }
      await save('songs')
    } catch (error) {
      result = {
        ...link,
        readError:
          error instanceof Error && error.message === 'This playlist is private or empty'
            ? error.message
            : "Couldn't read this playlist's songs. I'll learn them as they play."
      }
    }
    if (g !== gen) return link
    if (origin === 'mine') {
      playlists = playlists.map((p) => (p.uri === link.uri ? result : p))
      await save('playlists')
    }
    return result
  }

  return {
    async load() {
      const g = gen
      const list = await storage.read<Song[]>('songs', [])
      const links = await storage.read<PlaylistLink[]>('playlists', [])
      if (g !== gen) return
      songs = new Map(list.map((s) => [s.id, s]))
      playlists = links
    },
    songs: () => [...songs.values()],
    get: (id) => songs.get(id),
    playlists: () => [...playlists],

    async addPlaylist(url, now) {
      const parsed = parsePlaylistUrl(url)
      if (!parsed) throw new Error('Not a Spotify playlist link')
      const existing = playlists.find((p) => p.uri === parsed.uri)
      if (existing) return readPlaylist(existing, now)
      const link: PlaylistLink = { ...parsed, addedAt: now }
      playlists = [...playlists, link]
      await save('playlists')
      return readPlaylist(link, now)
    },
    readPlaylist,
    resolve,
    async refresh(now) {
      await Promise.all(
        playlists
          .filter(
            (p) => p.fetchedAt === undefined || now - p.fetchedAt >= musicConfig.catalog.refreshMs
          )
          .map((p) => readPlaylist(p, now))
      )
    },

    async removePlaylist(uri) {
      playlists = playlists.filter((p) => p.uri !== uri)
      for (const [id, song] of songs) {
        if (!song.playlists?.includes(uri)) continue
        const remaining = song.playlists.filter((p) => p !== uri)
        if (!remaining.length && !song.playCount) songs.delete(id)
        else
          songs.set(id, {
            ...song,
            playlists: remaining,
            origin: remaining.some((uri) => playlists.some((p) => p.uri === uri))
              ? 'mine'
              : song.playCount
                ? 'heard'
                : 'fallback'
          })
      }
      await save('songs')
      await save('playlists')
    },

    async learn(t, now) {
      t = resolve(t)
      if (t.isAd || !t.id.startsWith('spotify:track:')) return null
      const prev = songs.get(t.id)
      const song: Song = prev
        ? {
            ...prev,
            title: prev.title || t.name,
            artist: prev.artist || t.artist,
            lastPlayedAt: now,
            playCount: prev.playCount + 1
          }
        : {
            id: t.id,
            title: t.name,
            artist: t.artist,
            album: t.album || undefined,
            durationMs: t.durationMs || undefined,
            firstSeenAt: now,
            lastPlayedAt: now,
            playCount: 1,
            origin: 'heard',
            scores: scoreFromTags([], now, t.name)
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
      playlists = playlists.map((p) => ({ ...p, fetchedAt: undefined }))
      await save('playlists')
      await (chain = chain.then(() => storage.remove('songs')).catch(() => {}))
    },

    forget() {
      gen++
      songs = new Map()
      playlists = []
    }
  }
}
