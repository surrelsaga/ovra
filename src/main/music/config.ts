// Owner: Agent C (music). Every tunable number for the music module lives here.
import type { Activity, MusicTarget } from '@shared/types'

export const musicConfig = {
  controller: {
    /** How often onTrackChange polls Spotify. */
    pollMs: 2000,
    restartSlackMs: 1000,
    /** osascript timeout. */
    osascriptTimeoutMs: 5000,
    /** Spotify wasn't running at session start: check again this often and start once it is. */
    unavailableRetryMs: 10_000
  },
  switching: {
    /** At most one target change per this long. */
    minTargetChangeMs: 3 * 60_000,
    /** Start our pick this long before the current song ends. */
    endLeadMs: 1500,
    /** Settle fades down and back up over this duration each. */
    settleFadeMs: 2500,
    settleFadeSteps: 5,
    settleVolumeFloor: 8,
    /** Spotify may round its volume readback; only larger changes count as user input. */
    settleVolumeTolerance: 2,
    /** Last minutes of a session switch the target to wind-down. */
    windDownSec: 10 * 60
  },
  catalog: {
    embedUrl: 'https://open.spotify.com/embed/playlist/',
    timeoutMs: 15_000,
    refreshMs: 24 * 3600_000,
    userAgent: 'Mozilla/5.0 (Ovra)'
  },
  selection: {
    cooldownMs: 4 * 3600_000,
    cooldownPenalty: 1,
    darkPenalty: 2,
    moodPenalty: 1,
    unsurePenalty: 0.5,
    unsurePenaltyCalm: 2,
    voteBonus: 0.5,
    maxVoteBonus: 1,
    votesToTrust: 3,
    skipPenalty: 0.5,
    playlistHint: 0.2,
    pickSlack: 0.5,
    topK: 5,
    fallbackMinDistance: 1.5,
    fallbackEvery: 10
  },
  activityLean: {
    focus: { min: 2, max: 3, bright: false, vocals: { instrumental: 0, light: 0.75, heavy: 1.5 } },
    reading: { min: 1, max: 2, bright: false, vocals: { instrumental: 0, light: 1, heavy: 2 } },
    creative: { min: 3, max: 3, bright: false, vocals: { instrumental: 0, light: 0, heavy: 0 } },
    everyday: { min: 3, max: 4, bright: true, vocals: { instrumental: 0, light: 0, heavy: 0 } },
    unwind: { min: 1, max: 5, bright: true, vocals: { instrumental: 0, light: 0, heavy: 0 } }
  },
  songs: {
    /** Effective confidence below this = "Not sure yet". */
    unsureBelow: 0.5,
    /** Steady wants energy within this of what's been working. */
    steadyEnergyRange: 1,
    /** Energy used for Steady before anything has worked. */
    steadyDefaultEnergy: 3,
    /** Ease down's ceiling when the current song's energy is unknown. */
    easeDownDefaultMax: 3
  },
  learning: {
    /** A skip within this long counts as a quick skip. */
    quickSkipMs: 30_000,
    energyStep: 0.5,
    minEnergyDelta: -2,
    confidenceStep: 0.1,
    minConfidenceDelta: -0.5
  },
  lastfm: {
    baseUrl: 'https://ws.audioscrobbler.com/2.0/',
    tagsPerCall: 8,
    /** Drop tags fewer than this share of taggers used (Last.fm count is 0–100); noise and troll tags. */
    minTagCount: 5,
    /** Gap between Last.fm calls (their limit is ~5/s). */
    minIntervalMs: 300,
    timeoutMs: 10_000
  },
  rules: {
    baseConfidence: 0.2,
    perHitConfidence: 0.1,
    maxConfidence: 0.6,
    /** Confidence when no tag matched anything. */
    noMatchConfidence: 0.1,
    /** Cap when only artist tags were found: they say little about this one song. */
    artistOnlyMaxConfidence: 0.4
  },
  llm: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    /** Free models only (ids end in :free). Tried in order. */
    models: [
      'nvidia/nemotron-3.5-lightning:free',
      'google/gemma-4-31b-it:free',
      'google/gemma-4-26b-a4b-it:free'
    ],
    /** Small batches: 50 songs timed out on free models; 10 take ~45–60 s and stay accurate. */
    batchMax: 10,
    /** Wait this long for more songs before sending a smaller batch. */
    batchWaitMs: 5 * 60_000,
    /** Free reasoning models take ~45–120 s for a batch of 10 with the rubric. */
    timeoutMs: 180_000,
    /** Global gap between OpenRouter requests. */
    minIntervalMs: 60_000,
    /** The account has 50 free requests/day; keep headroom. */
    maxRequestsPerDay: 20,
    backoffBaseMs: 60_000,
    backoffMaxMs: 30 * 60_000,
    /** After this many failed batches a song falls back to keyword rules. */
    maxAttempts: 3
  },
  devCheck: { picks: 3, listenMs: 2000, volume: 15 },
  scoring: {
    /** Bump when scoring changes enough to redo old AI scores once (in the background). */
    version: 2,
    /** Failed Last.fm lookups retry this many times, then score with no tags. */
    maxTagAttempts: 3,
    retryMs: 60_000,
    /** Delay before a queue run, so a burst of learned songs is handled together. */
    kickDelayMs: 1000
  }
} as const

/** Activity defaults when Focused. Unknown stays Steady with the activity's song lean. */
export const ACTIVITY_DEFAULT_TARGET: Record<Activity, MusicTarget> = {
  focus: 'steady',
  reading: 'steady',
  creative: 'steady',
  everyday: 'lift',
  unwind: 'let-it-ride'
}

/** Spotify editorial lists, each verified with one public embed read on 2026-11-14. */
export const FALLBACK_PLAYLISTS: Record<MusicTarget, string[]> = {
  settle: ['https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO'],
  'ease-down': ['https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO'],
  'wind-down': ['https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO'],
  steady: ['https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ'],
  'let-it-ride': ['https://open.spotify.com/playlist/37i9dQZF1DX3rxVfibe1L0'],
  lift: ['https://open.spotify.com/playlist/37i9dQZF1DXdPec7aLTmlC']
}
