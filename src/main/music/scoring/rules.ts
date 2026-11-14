// Owner: Agent C (music). Keyword rules: public tags → scores, used when AI scoring is off or fails.
import type { Energy, SongScores } from '@shared/types'
import { musicConfig } from '../config'

const ENERGY: Record<string, Energy> = {
  ambient: 1,
  sleep: 1,
  meditation: 1,
  drone: 1,
  relaxing: 1,
  calm: 1,
  piano: 2,
  classical: 2,
  'lo fi': 2,
  lofi: 2,
  chillout: 2,
  chill: 2,
  acoustic: 2,
  folk: 2,
  'neo classical': 2,
  soundtrack: 2,
  jazz: 2,
  downtempo: 2,
  'singer songwriter': 3,
  indie: 3,
  pop: 3,
  soul: 3,
  rnb: 3,
  'hip hop': 3,
  rap: 3,
  electronic: 3,
  'post rock': 3,
  rock: 4,
  dance: 4,
  house: 4,
  funk: 4,
  disco: 4,
  edm: 4,
  techno: 4,
  'hard rock': 5,
  punk: 5,
  metal: 5,
  'drum and bass': 5,
  hardstyle: 5
}

const BRIGHT = [
  'happy',
  'upbeat',
  'feel good',
  'summer',
  'fun',
  'uplifting',
  'dance',
  'disco',
  'funk'
]
// ponytail: "pop" is a genre, not a tone; it made every pop song bright.
const DARK = [
  'dark',
  'sad',
  'melancholy',
  'melancholic',
  'gothic',
  'doom',
  'depressive',
  'emo',
  'heartbreak',
  'breakup',
  'grunge'
]
/** Version cues in a title beat the tags: tags describe the original recording. */
const TITLE_ENERGY: Record<string, Energy> = {
  lullaby: 1,
  acoustic: 2,
  unplugged: 2,
  stripped: 2,
  piano: 2,
  slowed: 2,
  'sped up': 4,
  remix: 4
}
const INSTRUMENTAL = [
  'instrumental',
  'ambient',
  'classical',
  'piano',
  'post rock',
  'soundtrack',
  'lo fi',
  'lofi',
  'neo classical'
]
const HEAVY = ['rap', 'hip hop', 'metal', 'screamo', 'punk']

const norm = (t: string): string =>
  t.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
/** Whole-word match: "hard rock" contains "rock", "rockabilly" doesn't. */
const has = (tag: string, kw: string): boolean => ` ${tag} `.includes(` ${kw} `)
const anyHit = (tags: string[], kws: string[]): number =>
  tags.filter((t) => kws.some((k) => has(t, k))).length

export function scoreFromTags(
  rawTags: string[],
  now: number,
  title = '',
  artistOnly = false
): SongScores {
  const c = musicConfig.rules
  const tags = [...rawTags, title].filter(Boolean).map(norm)
  const energies = tags.flatMap((t) => {
    // Prefer the longest keyword in a tag ("hard rock" over "rock").
    const kw = Object.keys(ENERGY)
      .filter((k) => has(t, k))
      .sort((a, b) => b.length - a.length)[0]
    return kw ? [ENERGY[kw]] : []
  })
  const bright = anyHit(tags, BRIGHT)
  const dark = anyHit(tags, DARK)
  const instrumental = anyHit(tags, INSTRUMENTAL)
  const heavy = anyHit(tags, HEAVY)
  const hits = energies.length + bright + dark + instrumental + heavy
  const cue = Object.keys(TITLE_ENERGY).find((k) => has(norm(title), k))
  const energy = cue
    ? TITLE_ENERGY[cue]
    : energies.length
      ? (Math.round(energies.reduce((a, b) => a + b, 0) / energies.length) as Energy)
      : 3
  const confidence = hits
    ? Math.min(c.maxConfidence, c.baseConfidence + c.perHitConfidence * hits)
    : c.noMatchConfidence
  return {
    energy,
    mood: bright > dark ? 'bright' : dark > bright ? 'dark' : 'neutral',
    vocals: instrumental > heavy ? 'instrumental' : heavy > instrumental ? 'heavy' : 'light',
    confidence: artistOnly ? Math.min(c.artistOnlyMaxConfidence, confidence) : confidence,
    source: hits && rawTags.length ? 'lastfm' : 'rules',
    scoredAt: now,
    tags: rawTags,
    scorer: musicConfig.scoring.version
  }
}
