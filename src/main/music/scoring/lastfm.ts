// Owner: Agent C (music). Last.fm public tags. Track tags are often empty, so artist tags are always added.
import { musicConfig } from '../config'

type LastfmTag = { name?: unknown }

/** Parses a track/artist getTopTags response. Error 6 (not found) = no tags; other errors throw. */
export function parseLastfmTags(json: unknown): string[] {
  const j = (json ?? {}) as { error?: number; toptags?: { tag?: LastfmTag | LastfmTag[] } }
  if (j.error === 6) return []
  if (j.error) throw new Error(`Last.fm error ${j.error}`)
  const raw = j.toptags?.tag
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  return list
    .map((t) => (typeof t?.name === 'string' ? t.name.trim().toLowerCase() : ''))
    .filter(Boolean)
    .slice(0, musicConfig.lastfm.tagsPerCall)
}

async function getTags(
  params: Record<string, string>,
  key: string,
  f: typeof fetch
): Promise<string[]> {
  const q = new URLSearchParams({ ...params, autocorrect: '1', api_key: key, format: 'json' })
  // Never include the URL in errors: it carries the key.
  const res = await f(`${musicConfig.lastfm.baseUrl}?${q}`, {
    signal: AbortSignal.timeout(musicConfig.lastfm.timeoutMs)
  })
  const json = await res.json().catch(() => null)
  if (!res.ok && (json as { error?: number } | null)?.error !== 6) {
    throw new Error(`Last.fm HTTP ${res.status}`)
  }
  return parseLastfmTags(json)
}

/** Track tags plus artist tags, deduplicated. */
export async function fetchLastfmTags(
  artist: string,
  title: string,
  key: string,
  f: typeof fetch = fetch
): Promise<string[]> {
  const track = await getTags({ method: 'track.gettoptags', artist, track: title }, key, f)
  const art = await getTags({ method: 'artist.gettoptags', artist }, key, f)
  return [...new Set([...track, ...art])]
}
