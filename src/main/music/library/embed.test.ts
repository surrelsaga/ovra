import { readFileSync } from 'node:fs'
import { parseEmbed } from './embed'
import { createLibrary } from '.'
import { memoryStorage } from '../dev/memory-storage'
import { musicConfig } from '../config'
import { applyOutcome, judgePlay } from './learning'
import { playlistSchema, songSchema } from '../../privacy/schemas'

const html = readFileSync(new URL('./fixtures/piano.html', import.meta.url), 'utf8')
const url = 'https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO'
const bad = readFileSync(new URL('./fixtures/not-found.html', import.meta.url), 'utf8')

it('parses a trimmed public Peaceful Piano page and preserves NBSP multi-artists', () => {
  const result = parseEmbed(html)
  expect(result.name).toBe('Peaceful Piano')
  expect(result.trackList).toHaveLength(3)
  const edited = html.replace('Dalby', 'Tyler, The Creator,\u00a0Dalby')
  expect(parseEmbed(edited).trackList[0].subtitle).toBe('Tyler, The Creator,\u00a0Dalby')
})

it('handles HTTP-200 not-found, malformed JSON, non-tracks and unavailable songs', () => {
  expect(() => parseEmbed(bad)).toThrow('This playlist is private or empty')
  expect(() => parseEmbed('<script id="__NEXT_DATA__">{</script>')).toThrow("Couldn't read")
  const json = JSON.parse(/>([\s\S]*)<\/script>/.exec(html)![1])
  const tracks = json.props.pageProps.state.data.entity.trackList
  tracks[0].isPlayable = false
  tracks[1].entityType = 'episode'
  tracks[2].uri = 'spotify:local:x:y'
  const result = parseEmbed(`<script id="__NEXT_DATA__">${JSON.stringify(json)}</script>`)
  expect(result.trackList).toHaveLength(1)
  expect(result.trackList[0].isPlayable).toBe(false)
})

it('reads on paste, merges membership, refreshes after 24h, and retains the old catalog on failure', async () => {
  const f = vi.fn(async () => new Response(html))
  const lib = createLibrary(memoryStorage(), f)
  const first = await lib.addPlaylist(url, 1)
  expect(first).toMatchObject({ name: 'Peaceful Piano', trackCount: 3, fetchedAt: 1 })
  expect(lib.songs()).toHaveLength(3)
  expect(lib.songs()[0]).toMatchObject({
    origin: 'mine',
    playlists: [first.uri],
    playCount: 0,
    scores: { source: 'rules' }
  })
  expect(f.mock.calls[0]).toBeDefined()
  await lib.refresh(musicConfig.catalog.refreshMs)
  expect(f).toHaveBeenCalledTimes(1)
  await lib.refresh(musicConfig.catalog.refreshMs + 1)
  expect(f).toHaveBeenCalledTimes(2)
  const old = lib.songs()
  f.mockRejectedValueOnce(new Error('offline'))
  await lib.refresh(2 * musicConfig.catalog.refreshMs + 1)
  expect(lib.songs()).toEqual(old)
  expect(lib.playlists()[0].readError).toContain("Couldn't read this playlist's songs")
  const second = await lib.addPlaylist('spotify:playlist:37i9dQZF1DWZeKCadgRdKQ', 2)
  expect(lib.songs()).toHaveLength(3)
  expect(lib.songs()[0].playlists).toEqual([first.uri, second.uri])
  await lib.removePlaylist(first.uri)
  expect(lib.songs()[0].playlists).toEqual([second.uri])
})

it('keeps failed links with plain errors and removes only unplayed orphan songs', async () => {
  const f = vi.fn(async () => new Response(html))
  const lib = createLibrary(memoryStorage(), f)
  const link = await lib.addPlaylist(url, 1)
  const known = lib.songs()[0]
  await lib.learn(
    {
      id: known.id,
      uri: known.id,
      name: known.title,
      artist: '',
      album: '',
      durationMs: 1,
      positionMs: 0,
      state: 'playing',
      isAd: false
    },
    3
  )
  expect(lib.get(known.id)?.artist).toBe(known.artist)
  await lib.removePlaylist(link.uri)
  expect(lib.songs()).toHaveLength(1)
  expect(lib.songs()[0]).toMatchObject({ origin: 'heard', playlists: [], playCount: 1 })
  f.mockResolvedValueOnce(new Response(bad))
  expect(await lib.addPlaylist(url, 4)).toMatchObject({
    readError: 'This playlist is private or empty'
  })
  await expect(lib.addPlaylist('hello', 4)).rejects.toThrow('Not a Spotify playlist link')
})

it('resolves Windows synthetic IDs and missing Mac artists against the catalog', async () => {
  const lib = createLibrary(memoryStorage(), async () => new Response(html))
  await lib.addPlaylist(url, 1)
  const s = lib.songs()[0]
  const t = {
    id: 'spotify:local:Dalby:New%20Light',
    uri: '',
    name: s.title,
    artist: s.artist,
    album: '',
    durationMs: 1,
    positionMs: 0,
    state: 'playing' as const,
    isAd: false
  }
  expect(lib.resolve(t).id).toBe(s.id)
  expect((await lib.learn(t, 2))?.playCount).toBe(1)
  expect(lib.resolve({ ...t, id: s.id, artist: '' }).artist).toBe(s.artist)
})

it('cannot write a late catalog response after clear/delete', async () => {
  let release!: (r: Response) => void
  const lib = createLibrary(
    memoryStorage(),
    () =>
      new Promise<Response>((r) => {
        release = r
      })
  )
  const adding = lib.addPlaylist(url, 1)
  await vi.waitFor(() => expect(release).toBeDefined())
  lib.forget()
  release(new Response(html))
  await adding
  expect(lib.songs()).toEqual([])
  expect(lib.playlists()).toEqual([])
})

it('records lift and good votes without readings and validates old and new saved records', async () => {
  const o = judgePlay({
    before: 'low',
    during: ['focused', 'good'],
    listenedMs: 60_000,
    endedByApp: false
  })
  expect(o).toMatchObject({ lift: true, good: true })
  const learned = applyOutcome(undefined, o, 1)
  expect(learned).toMatchObject({ liftVotes: 1, goodVotes: 1 })
  const lib = createLibrary(memoryStorage(), async () => new Response(html))
  const p = await lib.addPlaylist(url, 1)
  expect(playlistSchema.safeParse(p).success).toBe(true)
  expect(songSchema.safeParse({ ...lib.songs()[0], learned }).success).toBe(true)
  expect(songSchema.safeParse({ ...lib.songs()[0], pulse: 80 }).success).toBe(false)
})
