// Owner: Agent C (music). Last.fm public tags. Track tags first; artist tags only as a weak fallback.
import { musicConfig } from '../config'

type LastfmTag = { name?: unknown; count?: unknown }

/** Parses a track/artist getTopTags response. Error 6 (not found) = no tags; other errors throw. */
export function parseLastfmTags(json: unknown): string[] {
  const j = (json ?? {}) as { error?: number; toptags?: { tag?: LastfmTag | LastfmTag[] } }
  if (j.error === 6) return []
  if (j.error) throw new Error(`Last.fm error ${j.error}`)
  const raw = j.toptags?.tag
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  return list
    .filter((t) => typeof t?.count !== 'number' || t.count >= musicConfig.lastfm.minTagCount)
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

/** "One Time - Acoustic Version" / "Lonely (with benny blanco)" → "One Time" / "Lonely". */
export function baseTitle(title: string): string {
  return (
    title
      .replace(/\s+[-–—]\s+.*$/, '')
      .replace(/\s*[([][^)\]]*[)\]]/g, '')
      .trim() || title
  )
}

export interface LastfmTags {
  tags: string[]
  /** True when only artist tags were found: a weak hint about this song. */
  artistOnly: boolean
}

/** Track tags (full title, then base title); artist tags only when the track has none. */
export async function fetchLastfmTags(
  artist: string,
  title: string,
  key: string,
  f: typeof fetch = fetch,
  artistCache?: Map<string, string[]>
): Promise<LastfmTags> {
  const track = (t: string): Promise<string[]> =>
    getTags({ method: 'track.gettoptags', artist, track: t }, key, f)
  let tags = await track(title)
  if (!tags.length && baseTitle(title) !== title) tags = await track(baseTitle(title))
  if (tags.length) return { tags, artistOnly: false }
  const art =
    artistCache?.get(artist) ?? (await getTags({ method: 'artist.gettoptags', artist }, key, f))
  artistCache?.set(artist, art)
  return { tags: art, artistOnly: true }
}
