// Dev only: score real public playlists through the real library + scorer, then simulate picks.
// Sends only title, artist and public tags. Request counts are hard-capped. Never prints keys.
// Score: OVRA_ENV_PATH=/abs/.env npx tsx --tsconfig tsconfig.node.json src/main/music/dev/playlist-eval.ts score out.json <id>:<n> ...
// Picks: npx tsx --tsconfig tsconfig.node.json src/main/music/dev/playlist-eval.ts picks out.json <ownPlaylistName> ...
import { readFileSync, writeFileSync } from 'node:fs'
import type { Activity, Situation, Song } from '@shared/types'
import { getKey } from '../../env'
import { musicConfig } from '../config'
import { createLibrary } from '../library'
import { createScorer } from '../scoring'
import { desiredTarget, effective, pickSong, type PickContext } from '../selector'
import { memoryStorage } from './memory-storage'

const MAX_OPENROUTER = Number(process.env.MAX_OPENROUTER ?? 40)
const MAX_LASTFM = Number(process.env.MAX_LASTFM ?? 500)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

type Scored = Song & { playlist: string }

async function score(out: string, specs: string[]): Promise<void> {
  const count = { lastfm: 0, openrouter: 0, embed: 0 }
  const capped: typeof fetch = (input, init) => {
    const host = new URL(String(input)).hostname
    const k = host.includes('audioscrobbler')
      ? 'lastfm'
      : host.includes('openrouter')
        ? 'openrouter'
        : 'embed'
    if (k === 'lastfm' && count.lastfm >= MAX_LASTFM) return Promise.reject(new Error('cap'))
    if (k === 'openrouter' && count.openrouter >= MAX_OPENROUTER)
      return Promise.reject(new Error('cap'))
    count[k]++
    return fetch(input, init)
  }
  const library = createLibrary(memoryStorage(), capped)
  const all: Scored[] = []
  for (const spec of specs) {
    const [id, n] = spec.split(':')
    const link = await library.addPlaylist(`https://open.spotify.com/playlist/${id}`, Date.now())
    const list = library.songs().filter((s) => s.playlists?.includes(link.uri))
    const step = Math.max(1, list.length / Number(n || list.length))
    const sample = list
      .filter((_, i) => Math.floor(i % step) === 0)
      .slice(0, Number(n || list.length))
    // One scorer per playlist: each gets the app's own daily cap, our wrapper caps the total.
    const scorer = createScorer({
      library,
      aiEnabled: () => true,
      getKey: (k) => getKey(k),
      fetch: capped
    })
    const t = Date.now()
    sample.forEach((s) => scorer.enqueue(s))
    while (scorer.pending()) {
      await sleep(5000)
      console.log(
        `  ${link.name}: ${scorer.pending()} left, ${Math.round((Date.now() - t) / 1000)} s`,
        count
      )
    }
    for (const s of sample) all.push({ ...library.get(s.id)!, playlist: link.name ?? id })
    writeFileSync(out, JSON.stringify({ count, songs: all }, null, 1))
  }
  console.log('requests:', count)
}

// ponytail: copy of the renderer's songTab rule (renderer code isn't in the node tsconfig).
export const tab = (s: Song): string => {
  const e = effective(s)
  if (!e || e.confidence < musicConfig.songs.unsureBelow) return 'Not sure yet'
  return e.energy <= 2 ? 'Calm' : e.energy >= 4 || e.mood === 'bright' ? 'Boost' : 'Focus'
}

const tally = (xs: string[]): Record<string, number> =>
  xs.reduce<Record<string, number>>((o, x) => ((o[x] = (o[x] ?? 0) + 1), o), {})

function spread(songs: Scored[]): void {
  for (const name of [...new Set(songs.map((s) => s.playlist))]) {
    const ps = songs.filter((s) => s.playlist === name)
    console.log(`\n## ${name} (${ps.length})`)
    console.log('source', tally(ps.map((s) => s.scores?.source ?? 'none')))
    console.log('energy', tally(ps.map((s) => String(s.scores?.energy))))
    console.log('mood', tally(ps.map((s) => s.scores?.mood ?? '-')))
    console.log('vocals', tally(ps.map((s) => s.scores?.vocals ?? '-')))
    console.log('tabs', tally(ps.map(tab)))
    for (const s of ps) {
      const x = s.scores!
      console.log(
        `| ${s.title} | ${s.artist.split(/,\u00a0/)[0]} | ${x.energy} ${x.mood} ${x.vocals} ${x.confidence.toFixed(2)} ${x.source} | ${tab(s)} | ${(x.tags ?? []).slice(0, 4).join(', ')} |`
      )
    }
  }
}

const STATES: { name: string; situation: Situation | null; remainingSec?: number }[] = [
  { name: 'focused', situation: 'focused' },
  { name: 'good', situation: 'good' },
  { name: 'tense', situation: 'tense' },
  { name: 'crashing', situation: 'crashing' },
  { name: 'low', situation: 'low' },
  { name: 'wind-down', situation: 'focused', remainingSec: 300 }
]
const ACTIVITIES: Activity[] = ['focus', 'reading', 'creative', 'everyday', 'unwind']

/** Same context the music service builds (src/main/music/index.ts playNext). */
function simulate(songs: Song[], picksPerRun: number): void {
  let seed = 7
  const rng = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (const st of STATES)
    for (const activity of ACTIVITIES) {
      const target = desiredTarget({
        situation: st.situation,
        activity,
        remainingSec: st.remainingSec
      })
      const played = new Map<string, number>()
      let picks = 0
      let fallbackPicks = 0
      let cur: Song | undefined
      const row: string[] = []
      for (let i = 0; i < picksPerRun; i++) {
        const ctx: PickContext = {
          now: Date.now(),
          rng,
          activity:
            (st.situation === null || st.situation === 'focused' || st.situation === 'good') &&
            (target === 'steady' || target === 'lift' || target === 'let-it-ride')
              ? activity
              : undefined,
          currentId: cur?.id,
          currentEnergy: cur ? effective(cur)?.energy : undefined,
          played,
          picks,
          fallbackPicks
        }
        const s = pickSong(songs, target, ctx)
        if (!s) break
        if (played.has(s.id)) row.push('REPEAT')
        played.set(s.id, Date.now())
        picks++
        if (s.origin === 'fallback') fallbackPicks++
        cur = s
        const e = effective(s)!
        row.push(
          `${s.origin === 'fallback' ? '[fb] ' : ''}${s.title.slice(0, 28)} (${e.energy}${e.mood[0]}${e.vocals[0]}${e.confidence < 0.5 ? '?' : ''})`
        )
      }
      console.log(`\n${st.name} × ${activity} → ${target} (fallback ${fallbackPicks}/${picks})`)
      console.log('  ' + row.join(' · '))
    }
}

function picks(file: string, own: string[]): void {
  const songs = (JSON.parse(readFileSync(file, 'utf8')) as { songs: Scored[] }).songs
  spread(songs)
  const pool: Song[] = songs.map((s) => ({
    ...s,
    origin: own.includes(s.playlist) ? 'mine' : 'fallback'
  }))
  console.log(`\n# Picks: own = ${own.join(', ')}; other playlists act as editorial fallback`)
  simulate(pool, Number(process.env.PICKS ?? 10))
}

const [mode, file, ...rest] = process.argv.slice(2)
if (mode === 'score') void score(file, rest)
else picks(file, rest)
