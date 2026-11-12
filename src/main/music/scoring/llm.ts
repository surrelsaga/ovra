// Owner: Agent C (music). OpenRouter scoring (opt-in). Sends only title, artist and public tags.
import { z } from 'zod'
import type { Energy, SongMood, Vocals } from '@shared/types'
import { musicConfig } from '../config'

export interface LlmSong {
  title: string
  artist: string
  tags: string[]
}

export interface LlmScore {
  energy: Energy
  mood: SongMood
  vocals: Vocals
  confidence: number
}

export function buildPrompt(songs: LlmSong[]): string {
  return (
    'Score each song for a focus-music app. Use the tags and what you know about the song. ' +
    'Return ONLY JSON: {"songs":[{"i":number,"energy":1-5,"mood":"dark"|"neutral"|"bright",' +
    '"vocals":"instrumental"|"light"|"heavy","confidence":0-1}]}. ' +
    "If you don't know a song and there are no tags, give confidence below 0.3.\n" +
    songs
      .map((s, i) => `${i}. ${s.artist} - ${s.title} | tags: ${s.tags.join(', ') || 'none'}`)
      .join('\n')
  )
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
          temperature: 0
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
