// Owner: Agent C (music). Every tunable number for the music module lives here.
import type { Activity, MusicTarget } from '@shared/types'

export const musicConfig = {
  controller: {
    /** How often onTrackChange polls Spotify. */
    pollMs: 2000,
    /** osascript timeout. */
    osascriptTimeoutMs: 5000
  },
  switching: {
    /** At most one target change per this long. */
    minTargetChangeMs: 3 * 60_000,
    /** Downtime "barely switches": the gap above is multiplied by this. */
    downtimeChangeMultiplier: 3,
    /** Start our pick this long before the current song ends. */
    endLeadMs: 1500,
    /** Last minutes of a session switch the target to wind-down. */
    windDownSec: 10 * 60,
    /** A song played within this window isn't picked again. */
    recentMs: 60 * 60_000,
    /** About 1 in 5 picks in Steady / Let it ride may be an unsure song. */
    unsureShare: 0.2
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
    /** Gap between Last.fm calls (their limit is ~5/s). */
    minIntervalMs: 300,
    timeoutMs: 10_000
  },
  rules: {
    baseConfidence: 0.2,
    perHitConfidence: 0.1,
    maxConfidence: 0.6,
    /** Confidence when no tag matched anything. */
    noMatchConfidence: 0.1
  },
  llm: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    /** Free models only (ids end in :free). Tried in order. */
    models: [
      'nvidia/nemotron-3.5-lightning:free',
      'google/gemma-4-31b-it:free',
      'google/gemma-4-26b-a4b-it:free'
    ],
    batchMax: 50,
    /** Wait this long for more songs before sending a smaller batch. */
    batchWaitMs: 5 * 60_000,
    /** Free reasoning models take ~40 s. */
    timeoutMs: 120_000,
    /** Global gap between OpenRouter requests. */
    minIntervalMs: 60_000,
    /** The account has 50 free requests/day; keep headroom. */
    maxRequestsPerDay: 20,
    backoffBaseMs: 60_000,
    backoffMaxMs: 30 * 60_000,
    /** After this many failed batches a song falls back to keyword rules. */
    maxAttempts: 3
  },
  scoring: {
    /** Failed Last.fm lookups retry this many times, then score with no tags. */
    maxTagAttempts: 3,
    retryMs: 60_000,
    /** Delay before a queue run, so a burst of learned songs is handled together. */
    kickDelayMs: 1000
  }
} as const

/** Activity defaults when the situation is unknown or Focused. */
export const ACTIVITY_DEFAULT_TARGET: Record<Activity, MusicTarget> = {
  'deep-work': 'steady',
  debugging: 'steady',
  writing: 'steady',
  admin: 'lift',
  downtime: 'let-it-ride'
}

/**
 * Public mood playlists used when the library has nothing that fits.
 * TODO(Daniel): replace these placeholders with real public playlist links
 * (https://open.spotify.com/playlist/<22-char id>). Placeholders fail validation and are skipped.
 */
export const FALLBACK_PLAYLISTS: Record<MusicTarget, string[]> = {
  settle: ['https://open.spotify.com/playlist/REPLACE_ME_CALM_PIANO'],
  'ease-down': ['https://open.spotify.com/playlist/REPLACE_ME_CALM'],
  'wind-down': ['https://open.spotify.com/playlist/REPLACE_ME_WIND_DOWN'],
  steady: ['https://open.spotify.com/playlist/REPLACE_ME_FOCUS'],
  'let-it-ride': ['https://open.spotify.com/playlist/REPLACE_ME_FEEL_GOOD'],
  lift: ['https://open.spotify.com/playlist/REPLACE_ME_UPBEAT']
}
