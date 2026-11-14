// Dev only: offline eval of song scoring on a varied public set with rough expected labels.
// Runs the real Last.fm → rules / LLM steps with the current config and prints spread and accuracy.
// Sends only title, artist and public tags. OpenRouter requests are hard-capped. Never prints keys.
// Run: OVRA_ENV_PATH=/abs/.env npx tsx --tsconfig tsconfig.node.json src/main/music/dev/scoring-eval.ts [out.json]
import { writeFileSync } from 'node:fs'
import type { SongMood, Vocals } from '@shared/types'
import { getKey } from '../../env'
import { musicConfig } from '../config'
import { fetchLastfmTags, type LastfmTags } from '../scoring/lastfm'
import { buildPrompt, parseLlmScores, requestScores, type LlmScore } from '../scoring/llm'
import { scoreFromTags } from '../scoring/rules'

const MAX_OPENROUTER = Number(process.env.MAX_OPENROUTER ?? 20)

type M = SongMood
type V = Vocals
/** [artist, title, energy range, allowed moods, allowed vocals]. Rough, hand-written expectations. */
const SET: [string, string, [number, number], M[], V[]][] = [
  ['Justin Bieber', 'Baby', [3, 4], ['bright'], ['light']],
  ['Justin Bieber', 'One Time - Acoustic Version', [1, 2], ['neutral', 'bright'], ['light']],
  ['Justin Bieber', 'Love Yourself', [2, 2], ['neutral', 'dark'], ['light']],
  ['Justin Bieber', 'Lonely (with benny blanco)', [1, 2], ['dark'], ['light']],
  ['Justin Bieber', 'Sorry', [4, 4], ['bright', 'neutral'], ['light']],
  ['Justin Bieber', 'Ghost', [2, 3], ['dark', 'neutral'], ['light']],
  ['Adele', 'Someone Like You', [1, 2], ['dark'], ['light', 'heavy']],
  ['Adele', 'Rolling in the Deep', [4, 4], ['dark', 'neutral'], ['heavy', 'light']],
  ['Ed Sheeran', 'Shape of You', [4, 4], ['bright'], ['light']],
  ['Ed Sheeran', 'Perfect', [2, 2], ['bright', 'neutral'], ['light']],
  ['Billie Eilish', "when the party's over", [1, 1], ['dark'], ['light']],
  ['Billie Eilish', 'bad guy', [3, 3], ['dark', 'neutral'], ['light']],
  ['Lewis Capaldi', 'Someone You Loved', [2, 2], ['dark'], ['light']],
  ['Dua Lipa', 'Levitating', [4, 4], ['bright'], ['light']],
  ['Pharrell Williams', 'Happy', [4, 4], ['bright'], ['light']],
  ['Taylor Swift', 'Shake It Off', [4, 5], ['bright'], ['light']],
  ['Taylor Swift', 'All Too Well', [2, 3], ['dark'], ['light']],
  ['The Weeknd', 'Blinding Lights', [4, 4], ['bright', 'neutral'], ['light']],
  ['The Weeknd', 'Call Out My Name', [2, 2], ['dark'], ['light']],
  ['Coldplay', 'Fix You', [2, 3], ['dark', 'neutral'], ['light']],
  ['Coldplay', 'Viva La Vida', [4, 4], ['bright', 'neutral'], ['light']],
  ['Radiohead', 'Creep', [3, 4], ['dark'], ['light']],
  ['Radiohead', 'Everything In Its Right Place', [2, 3], ['dark', 'neutral'], ['light']],
  ['Bon Iver', 'Skinny Love', [2, 2], ['dark'], ['light']],
  ['Norah Jones', "Don't Know Why", [1, 2], ['neutral'], ['light']],
  ['Nirvana', 'Smells Like Teen Spirit', [5, 5], ['dark'], ['heavy']],
  ['Nirvana', 'About A Girl - Live', [2, 3], ['neutral', 'dark'], ['light']],
  ['Metallica', 'Enter Sandman', [5, 5], ['dark'], ['heavy']],
  ['Metallica', 'Nothing Else Matters', [2, 3], ['dark', 'neutral'], ['light']],
  ['Rage Against The Machine', 'Killing In the Name', [5, 5], ['dark'], ['heavy']],
  ['Linkin Park', 'Numb', [4, 4], ['dark'], ['heavy', 'light']],
  ['Eminem', 'Lose Yourself', [5, 5], ['dark', 'neutral'], ['heavy']],
  ['Kendrick Lamar', 'HUMBLE.', [4, 4], ['dark', 'neutral'], ['heavy']],
  ['Daft Punk', 'Get Lucky', [4, 4], ['bright'], ['light']],
  ['Avicii', 'Levels', [5, 5], ['bright'], ['instrumental', 'light']],
  ['Ludovico Einaudi', 'Nuvole Bianche', [1, 2], ['neutral', 'dark'], ['instrumental']],
  ['Max Richter', 'On the Nature of Daylight', [1, 1], ['dark', 'neutral'], ['instrumental']],
  ['Brian Eno', 'An Ending (Ascent)', [1, 1], ['neutral', 'bright'], ['instrumental']],
  [
    'Frédéric Chopin',
    'Nocturne in E-Flat Major, Op. 9 No. 2',
    [1, 1],
    ['neutral', 'bright'],
    ['instrumental']
  ],
  ['Miles Davis', 'So What', [2, 3], ['neutral'], ['instrumental']],
  ['Nujabes', 'Aruarian Dance', [2, 2], ['neutral'], ['instrumental']],
  ['Hans Zimmer', 'Time', [2, 3], ['neutral', 'dark'], ['instrumental']]
]

// ponytail: copy of the renderer's songTab rule (renderer code isn't in the node tsconfig).
const tab = (s: LlmScore): string =>
  s.confidence < musicConfig.songs.unsureBelow
    ? 'Not sure'
    : s.energy <= 2
      ? 'Calm'
      : s.energy >= 4 || s.mood === 'bright'
        ? 'Boost'
        : 'Focus'

function report(name: string, scores: (LlmScore | undefined)[]): unknown {
  const count = (f: (s: LlmScore) => string): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const s of scores) if (s) out[f(s)] = (out[f(s)] ?? 0) + 1
    return out
  }
  let e = 0
  let m = 0
  let v = 0
  let all = 0
  let n = 0
  SET.forEach(([, , [lo, hi], moods, vocals], i) => {
    const s = scores[i]
    if (!s) return
    n++
    const okE = s.energy >= lo - 1 && s.energy <= hi + 1
    const okM = moods.includes(s.mood)
    const okV = vocals.includes(s.vocals)
    e += +okE
    m += +okM
    v += +okV
    all += +(okE && okM && okV)
  })
  const pct = (x: number): string => `${Math.round((100 * x) / SET.length)}%`
  const out = {
    name,
    scored: `${n}/${SET.length}`,
    energy: count((s) => String(s.energy)),
    mood: count((s) => s.mood),
    vocals: count((s) => s.vocals),
    tabs: count(tab),
    accuracy: { energyWithin1: pct(e), mood: pct(m), vocals: pct(v), allThree: pct(all) }
  }
  console.log(JSON.stringify(out))
  return out
}

async function main(): Promise<void> {
  const lastfm = getKey('LASTFM_API_KEY')
  const openrouter = getKey('OPENROUTER_API_KEY')
  console.log('keys present:', { lastfm: !!lastfm, openrouter: !!openrouter })
  let lastfmCalls = 0
  const counting: typeof fetch = (input, init) => {
    lastfmCalls++
    return fetch(input, init)
  }
  const none: LastfmTags = { tags: [], artistOnly: false }
  const found: LastfmTags[] = []
  const artistCache = new Map<string, string[]>()
  for (const [artist, title] of SET) {
    found.push(
      lastfm
        ? await fetchLastfmTags(artist, title, lastfm, counting, artistCache).catch(() => none)
        : none
    )
    await new Promise((r) => setTimeout(r, musicConfig.lastfm.minIntervalMs))
  }
  const tags = found.map((t) => t.tags)
  const rules = SET.map(([, title], i) =>
    scoreFromTags(tags[i], Date.now(), title, found[i].artistOnly)
  )
  const results: Record<string, unknown> = { rules: report('rules', rules) }

  let used = 0
  const llm: (LlmScore | undefined)[] = []
  if (openrouter) {
    const take = (): boolean => (used < MAX_OPENROUTER ? (used++, true) : false)
    const size = musicConfig.llm.batchMax
    for (let start = 0; start < SET.length; start += size) {
      const batch = SET.slice(start, start + size).map(([artist, title], j) => ({
        artist,
        title,
        ...found[start + j]
      }))
      const t = Date.now()
      const parsed = await requestScores(buildPrompt(batch), openrouter, take)
        .then((text) => parseLlmScores(text, batch.length))
        .catch((e: Error) => (console.log('  batch failed:', e.message), new Map()))
      console.log(`  batch @${start}: ${parsed.size}/${batch.length} in ${Date.now() - t}ms`)
      batch.forEach((_, j) => (llm[start + j] = parsed.get(j)))
    }
    results.llm = report('llm', llm)
  }
  console.log('requests:', { lastfm: lastfmCalls, openrouter: used })
  const rows = SET.map(([artist, title, energy, moods, vocals], i) => ({
    song: `${artist} - ${title}`,
    expected: { energy, moods, vocals },
    tags: (found[i].artistOnly ? 'artist: ' : '') + tags[i].join(', '),
    rules: rules[i] && { e: rules[i].energy, m: rules[i].mood, v: rules[i].vocals },
    llm: llm[i]
  }))
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ results, rows }, null, 1))
}

void main()
