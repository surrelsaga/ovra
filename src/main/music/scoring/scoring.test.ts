import type { Song } from '@shared/types'
import { memoryStorage } from '../dev/memory-storage'
import { createLibrary } from '../library'
import { createScorer } from '.'
import { parseLastfmTags } from './lastfm'
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
    expect(p).toContain('0. Ludovico Einaudi - Nuvole Bianche | tags: piano')
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

  it('AI off: scores from Last.fm tags with rules, once, cached', async () => {
    const { lib, scorer, calls, add } = await setup({ ai: false })
    await add('spotify:track:a')
    await vi.advanceTimersByTimeAsync(5000)
    expect(lib.get('spotify:track:a')?.scores).toMatchObject({ source: 'lastfm', energy: 2 })
    expect(calls).toEqual(['lastfm'])
    scorer.enqueue(lib.get('spotify:track:a')!) // already scored: ignored
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls).toHaveLength(1)
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

it('upgrades existing rules scores in a full batch immediately, caches artist tags, and never sends empty artists', async () => {
  vi.useFakeTimers()
  try {
    const lib = createLibrary(memoryStorage())
    const songs: Song[] = []
    for (let i = 0; i < 51; i++) {
      songs.push(
        (await lib.learn(
          {
            id: `spotify:track:${i}`,
            uri: '',
            name: `Piano ${i}`,
            artist: i === 50 ? '' : 'Tyler, The Creator,\u00a0Dalby',
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
        expect(prompt).toContain('Tyler, The Creator - Piano 0')
        expect(prompt).not.toContain('Piano 50')
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    songs: Array.from({ length: 50 }, (_, i) => ({
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
    expect(scorer.pending()).toBe(50)
    expect(lib.songs()[0].scores?.source).toBe('rules')
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.mock.calls.filter(([u]) => String(u).includes('audioscrobbler'))).toHaveLength(1)
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
