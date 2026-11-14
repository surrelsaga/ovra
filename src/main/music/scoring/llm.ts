// Owner: Agent C (music). OpenRouter scoring (opt-in). Sends only title, artist and public tags.
import { z } from 'zod'
import type { Energy, SongMood, Vocals } from '@shared/types'
import { musicConfig } from '../config'

export interface LlmSong {
  title: string
  artist: string
  tags: string[]
  /** Tags are the artist's, not this song's: a weak hint. */
  artistOnly?: boolean
}

export interface LlmScore {
  energy: Energy
  mood: SongMood
  vocals: Vocals
  confidence: number
}

const RUBRIC = `You label songs for a music app that picks calm, focus or upbeat music.
Return ONLY JSON: {"songs":[{"i":number,"energy":1-5,"mood":"dark"|"neutral"|"bright","vocals":"instrumental"|"light"|"heavy","confidence":0-1}]} with one item per song.

energy = how energetic THIS recording feels (tempo, loudness, drive):
1 very soft, slow, sparse (ambient, solo piano, lullaby)
2 gentle (acoustic or slow ballad, soft jazz)
3 moderate, mid-tempo (relaxed pop, R&B groove, chill hip-hop)
4 upbeat, driving (dance-pop, rock, club rap)
5 very loud and fierce (metal, punk, hard EDM, aggressive rap)
mood = emotional tone of THIS recording, not the genre:
dark: sad, heartbroken, lonely, longing, angry, menacing, brooding
neutral: calm, reflective, cool, or truly mixed
bright: happy, joyful, playful, euphoric, warmly in love
A love song is not automatically bright: a sad or longing one is dark. Pop is not automatically bright.
vocals = how much the voice demands attention:
instrumental: no vocals, or only wordless or sampled voice
light: sung vocals that sit inside the music
heavy: dense or forceful vocals that dominate (rap verses, shouting, belting)

Judge each song on its own. Don't copy the artist's usual genre or the other songs in this list.
Acoustic, piano, live, slowed, sped up, remix and instrumental versions differ from the original: score the version in the title.
Track tags describe the song. Artist tags are only a weak hint.
confidence: 0.8-1 only if you know this exact recording; 0.5-0.7 if you infer it from the artist, title and tags; below 0.4 if you are guessing.

Songs:
`

const tagLine = (s: LlmSong): string =>
  !s.tags.length
    ? 'tags: none'
    : `${s.artistOnly ? 'artist tags only' : 'track tags'}: ${s.tags.join(', ')}`

export function buildPrompt(songs: LlmSong[]): string {
  return RUBRIC + songs.map((s, i) => `${i}. ${s.artist} - ${s.title} | ${tagLine(s)}`).join('\n')
}

const Item = z.object({
  i: z.number().int(),
  energy: z.number().int().min(1).max(5),
  mood: z.enum(['dark', 'neutral', 'bright']),
  vocals: z.enum(['instrumental', 'light', 'heavy']),
  confidence: z.number().min(0).max(1)
})
const Reply = z.object({ songs: z.array(z.unknown()) })

/** Strict parse. Bad JSON → empty map; invalid or out-of-range items are dropped one by one. */
export function parseLlmScores(text: string, count: number): Map<number, LlmScore> {
  const out = new Map<number, LlmScore>()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return out
  let json: unknown
  try {
    json = JSON.parse(text.slice(start, end + 1))
  } catch {
    return out
  }
  const reply = Reply.safeParse(json)
  if (!reply.success) return out
  for (const raw of reply.data.songs) {
    const r = Item.safeParse(raw)
    if (!r.success || r.data.i < 0 || r.data.i >= count || out.has(r.data.i)) continue
    const { i, energy, ...rest } = r.data
    out.set(i, { energy: energy as Energy, ...rest })
  }
  return out
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly rateLimited: boolean
  ) {
    super(message)
  }
}

/**
 * Tries each free model in order until one returns content. `take()` is asked before every
 * request (the global rate limit / daily budget); it returns false to stop.
 */
export async function requestScores(
  prompt: string,
  key: string,
  take: () => boolean,
  f: typeof fetch = fetch
): Promise<string> {
  const c = musicConfig.llm
  let rateLimited = false
  for (const model of c.models) {
    if (!model.endsWith(':free')) continue // never spend money
    if (!take()) break
    try {
      const res = await f(c.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0,
          // Free reasoning models think long on a rubric; low effort keeps a batch under the timeout.
          reasoning: { effort: 'low' }
        }),
        signal: AbortSignal.timeout(c.timeoutMs)
      })
      if (res.status === 429) rateLimited = true
      if (!res.ok) continue
      const j = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
      const content = j.choices?.[0]?.message?.content
      if (typeof content === 'string' && content.trim()) return content
    } catch {
      // timeout or network: try the next model
    }
  }
  throw new LlmError('No free model returned scores', rateLimited)
}
