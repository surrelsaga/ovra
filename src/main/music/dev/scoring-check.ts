// Dev only: one real pass of the scoring pipeline. Last.fm for 3 songs, then ONE OpenRouter batch.
// OpenRouter requests are hard-capped (the account shares 50 free requests/day). Never prints keys.
// Run: OVRA_ENV_PATH=/abs/.env npx tsx --tsconfig tsconfig.node.json src/main/music/dev/scoring-check.ts
import { getKey } from '../../env'
import { fetchLastfmTags } from '../scoring/lastfm'
import { buildPrompt, parseLlmScores, requestScores, type LlmSong } from '../scoring/llm'
import { scoreFromTags } from '../scoring/rules'

const MAX_OPENROUTER = Number(process.env.MAX_OPENROUTER ?? 1)

const songs = [
  { artist: 'Ludovico Einaudi', title: 'Nuvole Bianche' },
  { artist: 'Rick Astley', title: 'Never Gonna Give You Up' },
  { artist: 'Nonexistent Artist Zzq', title: 'Fake Song Qqq' }
]

async function main(): Promise<void> {
  const lastfm = getKey('LASTFM_API_KEY')
  const openrouter = getKey('OPENROUTER_API_KEY')
  console.log('keys present:', { lastfm: !!lastfm, openrouter: !!openrouter })
  if (!lastfm) return

  const withTags: LlmSong[] = []
  for (const s of songs) {
    const t = Date.now()
    const tags = await fetchLastfmTags(s.artist, s.title, lastfm)
    const rules = scoreFromTags(tags, Date.now())
    console.log(`lastfm ${Date.now() - t}ms ${s.artist} - ${s.title}:`, tags.join(', ') || '(none)')
    console.log('  rules →', JSON.stringify({ ...rules, tags: undefined }))
    withTags.push({ ...s, tags })
  }

  if (!openrouter || MAX_OPENROUTER < 1) return
  let used = 0
  const take = (): boolean => (used < MAX_OPENROUTER ? (used++, true) : false)
  const t = Date.now()
  try {
    const text = await requestScores(buildPrompt(withTags), openrouter, take)
    const parsed = parseLlmScores(text, withTags.length)
    console.log(`openrouter ok in ${Date.now() - t}ms, requests used: ${used}`)
    withTags.forEach((s, i) =>
      console.log(`  llm → ${s.artist} - ${s.title}:`, JSON.stringify(parsed.get(i) ?? '(dropped)'))
    )
  } catch (e) {
    console.log(
      `openrouter failed in ${Date.now() - t}ms, requests used: ${used}:`,
      (e as Error).message
    )
  }
}

void main()
