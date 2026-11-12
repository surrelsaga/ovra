import type { NowPlaying } from '@shared/types'
import { memoryStorage } from '../dev/memory-storage'
import { createLibrary, parsePlaylistUrl } from '.'
import { applyOutcome, judgePlay } from './learning'

const ID = '37i9dQZF1DXcBWIGoYBM5M'

const track = (id: string, extra: Partial<NowPlaying> = {}): NowPlaying => ({
  id,
  uri: id,
  name: 'Song',
  artist: 'Artist',
  album: 'Album',
  durationMs: 200_000,
  positionMs: 0,
  state: 'playing',
  isAd: false,
  ...extra
})

describe('parsePlaylistUrl', () => {
  it('parses a pasted share link with ?si=', () => {
    expect(parsePlaylistUrl(` https://open.spotify.com/playlist/${ID}?si=abc123 `)).toEqual({
      uri: `spotify:playlist:${ID}`,
      url: `https://open.spotify.com/playlist/${ID}?si=abc123`
    })
  })

  it('accepts intl paths and spotify: URIs', () => {
    expect(parsePlaylistUrl(`https://open.spotify.com/intl-de/playlist/${ID}`)?.uri).toBe(
      `spotify:playlist:${ID}`
    )
    expect(parsePlaylistUrl(`spotify:playlist:${ID}`)?.uri).toBe(`spotify:playlist:${ID}`)
  })

  it('rejects everything else', () => {
    for (const bad of [
      '',
      'hello',
      `http://open.spotify.com/playlist/${ID}`,
      `https://evil.com/playlist/${ID}`,
      `https://open.spotify.com/album/${ID}`,
      'https://open.spotify.com/playlist/REPLACE_ME_CALM',
      `https://open.spotify.com/playlist/${ID}/extra`,
      `spotify:playlist:${ID}"`
    ]) {
      expect(parsePlaylistUrl(bad)).toBeNull()
    }
  })
})

describe('library', () => {
  it('learns tracks, skips ads, counts plays and persists', async () => {
    const storage = memoryStorage()
    const lib = createLibrary(storage)
    await lib.load()
    expect(await lib.learn(track('spotify:ad:1', { isAd: true }), 1)).toBeNull()
    expect(await lib.learn(track('spotify:episode:1'), 1)).toBeNull()
    await lib.learn(track('spotify:track:a'), 1)
    const again = await lib.learn(track('spotify:track:a'), 5)
    expect(again).toMatchObject({
      title: 'Song',
      artist: 'Artist',
      playCount: 2,
      firstSeenAt: 1,
      lastPlayedAt: 5
    })
    expect((storage.files.get('songs') as unknown[]).length).toBe(1)
  })

  it('adds, dedupes and removes playlists; rejects bad links', async () => {
    const lib = createLibrary(memoryStorage())
    await lib.load()
    const p = await lib.addPlaylist(`https://open.spotify.com/playlist/${ID}?si=x`, 3)
    await lib.addPlaylist(`spotify:playlist:${ID}`, 4)
    expect(lib.playlists()).toEqual([p])
    await expect(lib.addPlaylist('nope', 1)).rejects.toThrow()
    await lib.removePlaylist(p.uri)
    expect(lib.playlists()).toEqual([])
  })

  it('clear() removes songs but keeps playlists', async () => {
    const storage = memoryStorage()
    const lib = createLibrary(storage)
    await lib.load()
    await lib.addPlaylist(`spotify:playlist:${ID}`, 1)
    await lib.learn(track('spotify:track:a'), 1)
    await lib.clear()
    expect(lib.songs()).toEqual([])
    expect(storage.files.has('songs')).toBe(false)
    expect(lib.playlists()).toHaveLength(1)
  })

  it('forget() drops memory without writing anything back', async () => {
    const storage = memoryStorage()
    const lib = createLibrary(storage)
    await lib.load()
    const song = await lib.learn(track('spotify:track:a'), 1)
    const pending = lib.update({ ...song!, playCount: 9 }) // queued write of old data
    lib.forget()
    await pending
    storage.files.clear()
    storage.writes.length = 0
    await lib.update({ ...song!, playCount: 10 })
    expect(lib.songs()).toEqual([])
    expect(lib.playlists()).toEqual([])
    expect(storage.writes).toEqual([])
  })
})

describe('learning from the body', () => {
  const obs = { before: null, during: [], listenedMs: 200_000, endedByApp: false }

  it('tense → focused during a song is a settle vote that lowers energy', () => {
    const o = judgePlay({ ...obs, before: 'tense', during: ['tense', 'focused'] })
    expect(o).toEqual({ settle: true, steady: false, quickSkip: false })
    const l = applyOutcome(applyOutcome(undefined, o, 1), o, 2)
    expect(l).toMatchObject({ settleVotes: 2, energyDelta: -1, plays: 2, updatedAt: 2 })
    expect(judgePlay({ ...obs, before: 'crashing', during: ['focused'] }).settle).toBe(true)
  })

  it('staying focused is a steady vote', () => {
    expect(judgePlay({ ...obs, before: 'focused', during: ['focused', 'focused'] }).steady).toBe(
      true
    )
    expect(judgePlay({ ...obs, before: 'focused', during: ['focused', 'tense'] }).steady).toBe(
      false
    )
    expect(judgePlay({ ...obs, before: 'focused', during: [] }).steady).toBe(false)
  })

  it('a user skip within 30 s lowers confidence; app switches do not count', () => {
    const skip = judgePlay({ ...obs, listenedMs: 10_000 })
    expect(skip.quickSkip).toBe(true)
    expect(judgePlay({ ...obs, listenedMs: 10_000, endedByApp: true }).quickSkip).toBe(false)
    expect(judgePlay({ ...obs, listenedMs: 40_000 }).quickSkip).toBe(false)
    expect(applyOutcome(undefined, skip, 1)).toMatchObject({ quickSkips: 1, confidenceDelta: -0.1 })
  })

  it('clamps adjustments', () => {
    let l = applyOutcome(undefined, { settle: true, steady: false, quickSkip: true }, 1)
    for (let i = 0; i < 20; i++)
      l = applyOutcome(l, { settle: true, steady: false, quickSkip: true }, 1)
    expect(l.energyDelta).toBe(-2)
    expect(l.confidenceDelta).toBeCloseTo(-0.5)
  })
})
