import type { Song } from '@shared/types'
import { memoryStorage } from '../dev/memory-storage'
import { createLibrary } from '../library'
import { createScorer } from '.'
import { baseTitle, fetchLastfmTags, parseLastfmTags } from './lastfm'
import { buildPrompt, parseLlmScores } from './llm'
import { scoreFromTags } from './rules'

describe('parseLastfmTags', () => {
  it('reads tags, lowercased and capped', () => {
    const tags = Array.from({ length: 12 }, (_, i) => ({ name: `Tag${i}`, count: 100 - i }))
    expect(parseLastfmTags({ toptags: { tag: tags } })).toHaveLength(8)
    expect(parseLastfmTags({ toptags: { tag: [{ name: ' Piano ' }] } })).toEqual(['piano'])
  })
  it('handles empty tags, a single tag object and junk', () => {
    expect(parseLastfmTags({ toptags: { tag: [], '@attr': {} } })).toEqual([])
    expect(parseLastfmTags({ toptags: { tag: { name: 'jazz' } } })).toEqual(['jazz'])
    expect(parseLastfmTags({ toptags: { tag: [{ name: 5 }, {}, null] } })).toEqual([])
    expect(parseLastfmTags(null)).toEqual([])
  })
  it('error 6 (not found) is no tags; other errors throw', () => {
    expect(
      parseLastfmTags({ error: 6, message: 'The artist you supplied could not be found' })
    ).toEqual([])
    expect(() => parseLastfmTags({ error: 29, message: 'Rate limit' })).toThrow('29')
  })
})

describe('keyword rules', () => {
  it('scores calm instrumental tags', () => {
    const s = scoreFromTags(['piano', 'classical', 'ambient', 'instrumental'], 1)
    expect(s).toMatchObject({
      energy: 2,
      vocals: 'instrumental',
      mood: 'neutral',
      source: 'lastfm'
    })
    expect(s.confidence).toBeCloseTo(0.6)
  })
  it('scores loud, bright and heavy tags', () => {
    expect(scoreFromTags(['Hard-Rock', 'metal'], 1)).toMatchObject({ energy: 5, vocals: 'heavy' })
    expect(scoreFromTags(['dance', 'happy', 'disco'], 1)).toMatchObject({
      energy: 4,
      mood: 'bright'
    })
    expect(scoreFromTags(['sad', 'melancholy', 'indie'], 1)).toMatchObject({
      mood: 'dark',
      energy: 3
    })
  })
  it('matches whole words only and falls back to unsure rules', () => {
    expect(scoreFromTags(['rockabilly'], 1)).toMatchObject({ source: 'rules', confidence: 0.1 })
    expect(scoreFromTags([], 1)).toMatchObject({
      source: 'rules',
      energy: 3,
      mood: 'neutral',
      vocals: 'light'
    })
  })
})

describe('LLM JSON', () => {
  it('builds a prompt with only title, artist and tags', () => {
    const p = buildPrompt([
      { title: 'Nuvole Bianche', artist: 'Ludovico Einaudi', tags: ['piano'] }
    ])
    expect(p).toContain('0. Ludovico Einaudi - Nuvole Bianche | track tags: piano')
  })
  it('parses valid output, also inside a code fence', () => {
    const m = parseLlmScores(
      '```json\n{"songs":[{"i":0,"energy":2,"mood":"bright","vocals":"instrumental","confidence":0.9}]}\n```',
      1
    )
    expect(m.get(0)).toEqual({ energy: 2, mood: 'bright', vocals: 'instrumental', confidence: 0.9 })
  })
  it('returns nothing for bad JSON or the wrong shape', () => {
    expect(parseLlmScores('not json', 2).size).toBe(0)
    expect(parseLlmScores('{"songs": [', 2).size).toBe(0)
    expect(parseLlmScores('{"items":[]}', 2).size).toBe(0)
    expect(parseLlmScores('', 2).size).toBe(0)
  })
  it('drops items with missing fields, out-of-range values or bad indexes', () => {
    const ok = { energy: 3, mood: 'neutral', vocals: 'light', confidence: 0.5 }
    const m = parseLlmScores(
      JSON.stringify({
        songs: [
          { i: 0, ...ok },
          { i: 1, energy: 3, mood: 'neutral', vocals: 'light' },
          { i: 2, ...ok, energy: 7 },
          { i: 3, ...ok, confidence: 1.5 },
          { i: 4, ...ok, mood: 'angry' },
          { i: 5, ...ok, energy: 2.5 },
          { i: 99, ...ok },
          { i: 0, ...ok, energy: 1 },
          'junk'
        ]
      }),
      6
    )
    expect([...m.keys()]).toEqual([0])
    expect(m.get(0)?.energy).toBe(3)
  })
})

describe('scorer', () => {
  const lastfmOk = (url: string): unknown =>
    url.includes('artist.gettoptags')
      ? { toptags: { tag: [{ name: 'piano' }, { name: 'classical' }, { name: 'ambient' }] } }
      : { toptags: { tag: [] } }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture, inferred
  async function setup(opts: { ai: boolean; llm?: (body: { model: string }) => Response }) {
    const lib = createLibrary(memoryStorage())
    await lib.load()
    const calls: string[] = []
    const f = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('openrouter')) {
        const body = JSON.parse(String(init?.body))
        calls.push(`llm:${body.model}`)
        // Privacy: only titles, artists and tags go out.
        expect(body.messages[0].content).not.toMatch(/pulse|tense|focused|situation/i)
        return opts.llm!(body)
      }
      calls.push('lastfm')
      return new Response(JSON.stringify(lastfmOk(url)))
    }) as typeof fetch
    const scorer = createScorer({
      library: lib,
      aiEnabled: () => opts.ai,
      getKey: () => 'k',
      fetch: f
    })
    const add = async (id: string): Promise<Song> => {
      const s = await lib.learn(
        {
          id,
          uri: id,
          name: id,
          artist: 'Einaudi',
          album: '',
          durationMs: 1,
          positionMs: 0,
          state: 'playing',
          isAd: false
        },
        Date.now()
      )
      scorer.enqueue(s!)
      return s!
    }
    return { lib, scorer, calls, add }
  }

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('AI off: skips Last.fm and AI, scores locally once, cached', async () => {
    const { lib, scorer, calls, add } = await setup({ ai: false })
    await add('spotify:track:a')
    await vi.advanceTimersByTimeAsync(5000)
    expect(lib.get('spotify:track:a')?.scores).toMatchObject({ source: 'rules', energy: 3 })
    expect(calls).toEqual([])
    scorer.enqueue(lib.get('spotify:track:a')!) // already scored: ignored
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls).toHaveLength(0)
    expect(scorer.pending()).toBe(0)
  })

  it('AI on: waits to batch, then one LLM request scores all; rescore() re-runs', async () => {
    const llm = (): Response =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  songs: [
                    { i: 0, energy: 1, mood: 'bright', vocals: 'instrumental', confidence: 0.9 },
                    { i: 1, energy: 9, mood: 'bright', vocals: 'instrumental', confidence: 0.9 }
                  ]
                })
              }
            }
          ]
        })
      )
    const { lib, scorer, calls, add } = await setup({ ai: true, llm })
    await add('spotify:track:a')
    await add('spotify:track:b')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls.filter((c) => c.startsWith('llm'))).toHaveLength(0) // still collecting
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(calls.filter((c) => c.startsWith('llm'))).toEqual([
      'llm:nvidia/nemotron-3.5-lightning:free'
    ])
    expect(lib.get('spotify:track:a')?.scores).toMatchObject({
      source: 'llm',
      energy: 1,
      tags: ['piano', 'classical', 'ambient']
    })
    expect(lib.get('spotify:track:b')?.scores?.source).toBe('lastfm') // invalid item → rules
    await scorer.rescore('spotify:track:a')
    expect(lib.get('spotify:track:a')?.scores).toBeUndefined()
    expect(scorer.pending()).toBe(1)
  })

  it('on 429 tries the next free model, backs off, then falls back to rules', async () => {
    const { lib, calls, add } = await setup({
      ai: true,
      llm: () => new Response('{}', { status: 429 })
    })
    await add('spotify:track:a')
    await vi.advanceTimersByTimeAsync(6 * 60_000)
    expect(calls.filter((c) => c.startsWith('llm'))).toHaveLength(3)
    expect(lib.get('spotify:track:a')?.scores?.source).toBe('lastfm') // usable while waiting on backoff
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000)
    expect(lib.get('spotify:track:a')?.scores?.source).toBe('lastfm')
    expect(calls.filter((c) => c.startsWith('llm'))).toHaveLength(9) // 3 attempts × 3 models
  })
})

it('upgrades existing rules scores in a full batch immediately, uses track tags, and never sends empty artists', async () => {
  vi.useFakeTimers()
  try {
    const lib = createLibrary(memoryStorage())
    const songs: Song[] = []
    for (let i = 0; i < 11; i++) {
      songs.push(
        (await lib.learn(
          {
            id: `spotify:track:${i}`,
            uri: '',
            name: `Piano ${i}`,
            artist: i === 10 ? '' : 'Tyler, The Creator,\u00a0Dalby',
            album: '',
            durationMs: 1,
            positionMs: 0,
            state: 'playing',
            isAd: false
          },
          Date.now()
        ))!
      )
    }
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('openrouter')) {
        const prompt = JSON.parse(String(init?.body)).messages[0].content
        expect(prompt).toContain('0. Tyler, The Creator - Piano 0 | track tags: piano')
        expect(prompt).not.toContain('Piano 10')
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    songs: Array.from({ length: 10 }, (_, i) => ({
                      i,
                      energy: 2,
                      mood: 'neutral',
                      vocals: 'instrumental',
                      confidence: 0.9
                    }))
                  })
                }
              }
            ]
          })
        )
      }
      return new Response(JSON.stringify({ toptags: { tag: [{ name: 'piano' }] } }))
    })
    const scorer = createScorer({
      library: lib,
      aiEnabled: () => true,
      getKey: () => 'mock',
      fetch: f
    })
    songs.forEach(scorer.enqueue)
    expect(scorer.pending()).toBe(10)
    expect(lib.songs()[0].scores?.source).toBe('rules')
    await vi.advanceTimersByTimeAsync(5000)
    const lastfm = f.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('audioscrobbler'))
    expect(lastfm).toHaveLength(10)
    expect(lastfm.every((u) => u.includes('track.gettoptags'))).toBe(true)
    expect(f.mock.calls.filter(([u]) => String(u).includes('openrouter'))).toHaveLength(1)
    expect(lib.songs()[0].scores?.source).toBe('llm')
    expect(scorer.pending()).toBe(0)
    lib.songs().forEach(scorer.enqueue)
    expect(scorer.pending()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

it('can refine a rules score after AI consent changes in the same run', async () => {
  vi.useFakeTimers()
  try {
    const lib = createLibrary(memoryStorage())
    const song = (await lib.learn(
      {
        id: 'spotify:track:x',
        uri: '',
        name: 'Piano',
        artist: 'Dalby',
        album: '',
        durationMs: 1,
        positionMs: 0,
        state: 'playing',
        isAd: false
      },
      Date.now()
    ))!
    let ai = false
    const f = vi.fn(
      async (url: string | URL | Request) =>
        new Response(
          JSON.stringify(
            String(url).includes('openrouter')
              ? {
                  choices: [
                    {
                      message: {
                        content:
                          '{"songs":[{"i":0,"energy":2,"mood":"neutral","vocals":"instrumental","confidence":0.9}]}'
                      }
                    }
                  ]
                }
              : { toptags: { tag: [{ name: 'piano' }] } }
          )
        )
    )
    const scorer = createScorer({
      library: lib,
      aiEnabled: () => ai,
      getKey: () => 'mock',
      fetch: f
    })
    scorer.enqueue(song)
    await vi.advanceTimersByTimeAsync(5000)
    ai = true
    scorer.enqueue(lib.get(song.id)!)
    expect(scorer.pending()).toBe(1)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(lib.get(song.id)?.scores?.source).toBe('llm')
  } finally {
    vi.useRealTimers()
  }
})

it('keeps the per-run daily request cap even across explicit rescores', async () => {
  vi.useFakeTimers()
  // Local midday: the ~2 h run below must not cross midnight, when the daily cap resets.
  vi.setSystemTime(new Date(2026, 10, 15, 12, 0, 0))
  try {
    const lib = createLibrary(memoryStorage())
    const song = (await lib.learn(
      {
        id: 'spotify:track:budget',
        uri: '',
        name: 'Piano',
        artist: 'Dalby',
        album: '',
        durationMs: 1,
        positionMs: 0,
        state: 'playing',
        isAd: false
      },
      Date.now()
    ))!
    let requests = 0
    const f = vi.fn(async () => {
      requests++
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"songs":[{"i":0,"energy":2,"mood":"neutral","vocals":"instrumental","confidence":0.9}]}'
              }
            }
          ]
        })
      )
    })
    const scorer = createScorer({
      library: lib,
      aiEnabled: () => true,
      getKey: (name) => (name === 'OPENROUTER_API_KEY' ? 'mock' : null),
      fetch: f
    })
    for (let i = 0; i < 23; i++) {
      await scorer.rescore(song.id)
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000)
    }
    expect(requests).toBe(20)
    scorer.reset()
  } finally {
    vi.useRealTimers()
  }
})

it('uses playlist name hints for local rules with consent off, even when a Last.fm key exists', async () => {
  vi.useFakeTimers()
  try {
    const storage = memoryStorage()
    const playlist = 'spotify:playlist:local'
    await storage.write('playlists', [{ uri: playlist, url: '', name: 'Calm Piano', addedAt: 0 }])
    await storage.write('songs', [
      {
        id: 'spotify:track:local',
        title: 'A song',
        artist: 'An artist',
        firstSeenAt: 0,
        playCount: 0,
        playlists: [playlist]
      }
    ])
    const lib = createLibrary(storage)
    await lib.load()
    const f = vi.fn()
    const scorer = createScorer({
      library: lib,
      aiEnabled: () => false,
      getKey: () => 'mock',
      fetch: f
    })
    scorer.enqueue(lib.songs()[0])
    await vi.advanceTimersByTimeAsync(5000)
    expect(f).not.toHaveBeenCalled()
    expect(lib.songs()[0].scores).toMatchObject({
      source: 'rules',
      energy: 2,
      vocals: 'instrumental',
      tags: []
    })
  } finally {
    vi.useRealTimers()
  }
})

it('rechecks consent after waiting between Last.fm requests', async () => {
  vi.useFakeTimers()
  try {
    const songs: Song[] = ['First', 'Second'].map((artist) => ({
      id: `spotify:track:${artist}`,
      title: 'Song',
      artist,
      firstSeenAt: 0,
      playCount: 0
    }))
    const storage = memoryStorage()
    await storage.write('songs', songs)
    const library = createLibrary(storage)
    await library.load()
    let consent = true
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ toptags: { tag: [{ name: 'piano' }] } }))
    )
    const scorer = createScorer({ library, aiEnabled: () => consent, getKey: () => 'mock', fetch })
    songs.forEach(scorer.enqueue)
    await vi.advanceTimersByTimeAsync(1100)
    expect(fetch).toHaveBeenCalledOnce()
    consent = false
    await vi.advanceTimersByTimeAsync(65_000)
    expect(fetch).toHaveBeenCalledOnce()
    expect(scorer.pending()).toBe(0)
    expect(library.songs().every((song) => song.scores?.source === 'rules')).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})

describe('job F: deliberate scoring', () => {
  it('drops low-count noise tags from Last.fm', () => {
    const tags = [
      { name: 'pop', count: 100 },
      { name: 'black metal', count: 58 },
      { name: 'Brutal Death Metal', count: 1 }
    ]
    expect(parseLastfmTags({ toptags: { tag: tags } })).toEqual(['pop', 'black metal'])
  })

  it('looks up track tags by full then base title, and uses artist tags only as a cached fallback', async () => {
    expect(baseTitle('One Time - Acoustic Version')).toBe('One Time')
    expect(baseTitle('Lonely (with benny blanco)')).toBe('Lonely')
    expect(baseTitle('Nuvole Bianche')).toBe('Nuvole Bianche')
    const urls: URL[] = []
    const f = (async (input: string | URL) => {
      const u = new URL(String(input))
      urls.push(u)
      const p = u.searchParams
      const tags =
        p.get('method') === 'artist.gettoptags'
          ? ['pop']
          : p.get('track') === 'One Time'
            ? ['acoustic', 'love']
            : []
      return new Response(JSON.stringify({ toptags: { tag: tags.map((name) => ({ name })) } }))
    }) as typeof fetch
    const cache = new Map<string, string[]>()
    const track = (u: URL): string | null => u.searchParams.get('track')
    expect(await fetchLastfmTags('JB', 'One Time - Acoustic Version', 'k', f, cache)).toEqual({
      tags: ['acoustic', 'love'],
      artistOnly: false
    })
    expect(urls.map(track)).toEqual(['One Time - Acoustic Version', 'One Time'])
    urls.length = 0
    expect(await fetchLastfmTags('JB', 'Unknown', 'k', f, cache)).toEqual({
      tags: ['pop'],
      artistOnly: true
    })
    expect(await fetchLastfmTags('JB', 'Other', 'k', f, cache)).toMatchObject({ artistOnly: true })
    expect(urls.map((u) => u.searchParams.get('method'))).toEqual([
      'track.gettoptags',
      'artist.gettoptags',
      'track.gettoptags' // artist tags cached
    ])
  })

  it('rules: genre "pop" is not bright, title cues beat tags, artist-only tags stay unsure', () => {
    expect(scoreFromTags(['pop', 'rnb'], 1).mood).toBe('neutral')
    expect(scoreFromTags(['dance', 'house'], 1, 'Baby - Acoustic Version').energy).toBe(2)
    expect(scoreFromTags(['ballad'], 1, 'Song - Sped Up').energy).toBe(4)
    expect(scoreFromTags(['piano', 'classical', 'ambient'], 1, '', true).confidence).toBe(0.4)
    expect(scoreFromTags(['sad'], 1).scorer).toBe(2)
  })

  it('prompt has a rubric and marks weak artist tags', () => {
    const p = buildPrompt([
      { title: 'One Time - Acoustic Version', artist: 'JB', tags: ['acoustic'] },
      { title: 'Lonely', artist: 'JB', tags: ['pop'], artistOnly: true },
      { title: 'X', artist: 'Y', tags: [] }
    ])
    expect(p).toMatch(/energy = .*\n1 very soft/)
    expect(p).toContain("Don't copy the artist's usual genre")
    expect(p).toContain('A love song is not automatically bright')
    expect(p).toContain('0. JB - One Time - Acoustic Version | track tags: acoustic')
    expect(p).toContain('1. JB - Lonely | artist tags only: pop')
    expect(p).toContain('2. Y - X | tags: none')
  })

  describe('rescore by version', () => {
    const reply = (energy: number): Response =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  songs: [{ i: 0, energy, mood: 'dark', vocals: 'light', confidence: 0.7 }]
                })
              }
            }
          ]
        })
      )
    const learned = {
      energyDelta: -0.5,
      confidenceDelta: 0,
      settleVotes: 2,
      steadyVotes: 1,
      goodVotes: 1,
      quickSkips: 0,
      plays: 3,
      updatedAt: 5
    }
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture, inferred
    async function setup(scorer: number | undefined, ai: boolean, ok: boolean) {
      const storage = memoryStorage()
      await storage.write('songs', [
        {
          id: 'spotify:track:old',
          title: 'Song',
          artist: 'Artist',
          firstSeenAt: 0,
          playCount: 3,
          learned,
          scores: {
            energy: 4,
            mood: 'bright',
            vocals: 'light',
            confidence: 0.9,
            source: 'llm',
            scoredAt: 0,
            ...(scorer ? { scorer } : {})
          }
        }
      ])
      const lib = createLibrary(storage)
      await lib.load()
      const f = vi.fn(async (url: string | URL | Request) =>
        String(url).includes('openrouter')
          ? ok
            ? reply(2)
            : new Response('{}', { status: 500 })
          : new Response(JSON.stringify({ toptags: { tag: [{ name: 'sad' }] } }))
      )
      const s = createScorer({ library: lib, aiEnabled: () => ai, getKey: () => 'k', fetch: f })
      s.enqueue(lib.songs()[0])
      return { lib, s, f }
    }

    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('redoes an old AI score once in the background and keeps learned votes', async () => {
      const { lib, s, f } = await setup(undefined, true, true)
      expect(s.pending()).toBe(1)
      expect(lib.songs()[0].scores?.source).toBe('llm') // old score stays while waiting
      await vi.advanceTimersByTimeAsync(6 * 60_000)
      expect(lib.songs()[0].scores).toMatchObject({ energy: 2, mood: 'dark', scorer: 2 })
      expect(lib.songs()[0].learned).toEqual(learned)
      const calls = f.mock.calls.length
      s.enqueue(lib.songs()[0]) // current version: not again
      await vi.advanceTimersByTimeAsync(6 * 60_000)
      expect(f.mock.calls.length).toBe(calls)
    })

    it('leaves current-version scores, and old ones when AI is off', async () => {
      expect((await setup(2, true, true)).s.pending()).toBe(0)
      const off = await setup(undefined, false, true)
      expect(off.s.pending()).toBe(0)
      expect(off.lib.songs()[0].scores).toMatchObject({ source: 'llm', energy: 4 })
    })

    it('never downgrades an old AI score to rules when the AI keeps failing', async () => {
      const { lib, s } = await setup(undefined, true, false)
      await vi.advanceTimersByTimeAsync(3 * 60 * 60_000)
      expect(s.pending()).toBe(0)
      expect(lib.songs()[0]).toMatchObject({
        scores: { source: 'llm', energy: 4, mood: 'bright' },
        learned
      })
    })
  })
})
