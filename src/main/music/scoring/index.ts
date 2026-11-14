// Owner: Agent C (music). Background scoring queue: Last.fm tags → keyword rules or LLM (opt-in).
// Once per song, cached on the song by Spotify id. Never blocks anything; failures retry later.
import type { Song, SongScores } from '@shared/types'
import { musicConfig } from '../config'
import type { Library } from '../library'
import { fetchLastfmTags } from './lastfm'
import { buildPrompt, LlmError, parseLlmScores, requestScores } from './llm'
import { scoreFromTags } from './rules'

export interface ScorerDeps {
  library: Library
  /** privacy.get().aiScoring, read on every run. */
  aiEnabled: () => boolean
  getKey: (name: 'OPENROUTER_API_KEY' | 'LASTFM_API_KEY') => string | null
  fetch?: typeof fetch
  now?: () => number
  onChange?: () => void
}

export interface Scorer {
  enqueue(song: Song): void
  /** The user asked: drop the cached score and score again. */
  rescore(songId: string): Promise<void>
  pending(): number
  /** Drop the queue (library cleared or everything deleted). */
  reset(): void
}

interface Item {
  id: string
  title: string
  artist: string
  queuedAt: number
  tags?: string[]
  artistOnly?: boolean
  tagAttempts: number
  llmAttempts: number
  notBefore: number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function createScorer(d: ScorerDeps): Scorer {
  const cfg = musicConfig
  const now = d.now ?? Date.now
  const f: typeof fetch = (input, init) =>
    d.aiEnabled()
      ? (d.fetch ?? fetch)(input, init)
      : Promise.reject(new Error('Song lookup consent is off'))
  const queue = new Map<string, Item>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  const artistTags = new Map<string, string[]>()
  const attempted = new Set<string>()
  const llmAttempted = new Set<string>()
  let lastfmAt = 0
  let llmNextAt = 0
  let llmFailures = 0
  // shortcut: daily budget resets on restart, persist when a shared scoring-budget storage contract exists.
  let day = ''
  let dayCount = 0

  const takeLlm = (): boolean => {
    const today = new Date(now()).toDateString()
    if (today !== day) {
      day = today
      dayCount = 0
    }
    if (dayCount >= cfg.llm.maxRequestsPerDay) return false
    dayCount++
    return true
  }

  const save = async (item: Item, scores: SongScores): Promise<void> => {
    queue.delete(item.id)
    const song = d.library.get(item.id)
    if (song) await d.library.update({ ...song, scores })
    d.onChange?.()
  }

  const kick = (delay: number = cfg.scoring.kickDelayMs): void => {
    if (timer || running || !queue.size) return
    timer = setTimeout(() => void run(), Math.max(cfg.scoring.kickDelayMs, delay))
  }

  async function fetchTags(): Promise<void> {
    const key = d.getKey('LASTFM_API_KEY')
    for (const item of [...queue.values()]) {
      if (!d.aiEnabled()) {
        item.tags = []
        continue
      }
      if (item.tags || item.notBefore > now()) continue
      if (!key) {
        item.tags = []
        continue
      }
      // Up to three calls per song (title, base title, artist), each spaced out.
      const throttled: typeof fetch = async (input, init) => {
        const wait = lastfmAt + cfg.lastfm.minIntervalMs - now()
        if (wait > 0) await sleep(wait)
        lastfmAt = now()
        return f(input, init)
      }
      try {
        const r = await fetchLastfmTags(item.artist, item.title, key, throttled, artistTags)
        item.tags = r.tags
        item.artistOnly = r.artistOnly
      } catch {
        item.tagAttempts++
        if (item.tagAttempts >= cfg.scoring.maxTagAttempts) item.tags = []
        else item.notBefore = now() + cfg.scoring.retryMs
      }
    }
  }

  const rules = (item: Item): SongScores => {
    const song = d.library.get(item.id)
    const names = d.library
      .playlists()
      .filter((p) => song?.playlists?.includes(p.uri))
      .map((p) => p.name ?? '')
    return scoreFromTags(
      d.aiEnabled() ? (item.tags ?? []) : [],
      now(),
      [item.title, ...names].join(' '),
      item.artistOnly
    )
  }

  /** AI failed or is off: keep an older AI score (rescore by version) rather than downgrade it. */
  const fallback = async (item: Item): Promise<void> => {
    if (d.library.get(item.id)?.scores?.source !== 'llm') return save(item, rules(item))
    queue.delete(item.id)
    d.onChange?.()
  }

  async function scoreReady(): Promise<number | null> {
    const ready = [...queue.values()].filter((i) => i.tags)
    if (!ready.length) return null
    for (const item of ready) {
      const song = d.library.get(item.id)
      if (
        song &&
        (!song.scores || song.scores.source === 'rules' || song.scores.source === 'lastfm')
      )
        await d.library.update({
          ...song,
          scores: rules(item)
        })
    }
    d.onChange?.()
    const key = d.getKey('OPENROUTER_API_KEY')
    if (!d.aiEnabled() || !key) {
      for (const i of ready) await fallback(i)
      return null
    }
    const oldest = Math.min(...ready.map((i) => i.queuedAt))
    const dueAt = ready.length >= cfg.llm.batchMax ? 0 : oldest + cfg.llm.batchWaitMs
    const at = Math.max(dueAt, llmNextAt)
    if (now() < at) return at
    const batch = ready.slice(0, cfg.llm.batchMax)
    batch.forEach((i) => llmAttempted.add(i.id))
    const songs = batch.map((i) => ({
      title: i.title,
      artist: i.artist,
      tags: i.tags ?? [],
      artistOnly: i.artistOnly
    }))
    try {
      const text = await requestScores(buildPrompt(songs), key, takeLlm, f)
      llmFailures = 0
      llmNextAt = now() + cfg.llm.minIntervalMs
      const parsed = parseLlmScores(text, batch.length)
      for (const [n, item] of batch.entries()) {
        const s = parsed.get(n)
        if (!s) await fallback(item)
        else
          await save(item, {
            ...s,
            source: 'llm',
            scoredAt: now(),
            tags: item.tags,
            scorer: cfg.scoring.version
          })
      }
    } catch (e) {
      llmFailures++
      const backoff = Math.min(cfg.llm.backoffMaxMs, cfg.llm.backoffBaseMs * 2 ** (llmFailures - 1))
      llmNextAt = now() + (e instanceof LlmError && e.rateLimited ? backoff * 2 : backoff)
      for (const item of batch) {
        item.llmAttempts++
        // ponytail: an old AI score that keeps failing stays and is retried next launch.
        if (item.llmAttempts >= cfg.llm.maxAttempts) await fallback(item)
      }
    }
    return queue.size ? llmNextAt : null
  }

  async function run(): Promise<void> {
    timer = null
    running = true
    let wakeAt: number | null = null
    try {
      await fetchTags()
      wakeAt = await scoreReady()
    } catch {
      // never let scoring crash the app
    } finally {
      running = false
    }
    if (!queue.size) return
    const tagWait = [...queue.values()].filter((i) => !i.tags).map((i) => i.notBefore)
    const next = Math.min(...tagWait, wakeAt ?? Infinity)
    kick(Number.isFinite(next) ? next - now() : cfg.scoring.retryMs)
  }

  return {
    enqueue(song) {
      if (!song.artist.trim() || queue.has(song.id) || llmAttempted.has(song.id)) return
      const refine = d.aiEnabled() && !!d.getKey('OPENROUTER_API_KEY')
      if (attempted.has(song.id) && !refine) return
      const s = song.scores
      // Older AI scores are redone once per run, only when AI can run; learned/web scores are kept.
      const stale = s?.source === 'llm' && (s.scorer ?? 1) < cfg.scoring.version
      if (stale && !refine) return
      if (s && !stale && !['rules', 'lastfm'].includes(s.source)) return
      attempted.add(song.id)
      queue.set(song.id, {
        id: song.id,
        title: song.title,
        artist: song.artist.split(/,\u00a0/)[0].trim(),
        queuedAt: now(),
        tagAttempts: 0,
        llmAttempts: 0,
        notBefore: 0
      })
      d.onChange?.()
      kick()
    },
    async rescore(songId) {
      const song = d.library.get(songId)
      if (!song) return
      queue.delete(songId)
      attempted.delete(songId)
      llmAttempted.delete(songId)
      const fresh = { ...song, scores: undefined }
      await d.library.update(fresh)
      this.enqueue(fresh)
    },
    pending: () => queue.size,
    reset() {
      queue.clear()
      attempted.clear()
      llmAttempted.clear()
      artistTags.clear()
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}
