# Music module (Agent C) report

## What works
- `SpotifyMacController` (`src/main/music/controller/`): every command is `execFile('osascript', ['-e', …])`, guarded by
  `if application "Spotify" is running` so it never launches Spotify. Strict URI regex before any script.
  Parses `,`/`.` positions, ads (`spotify:ad:` → `isAd`), empty fields. `onTrackChange` polls every 2 s
  (fires on track or play-state change). No-op controller off macOS.
- Library: songs + playlists in storage `songs` / `playlists`; pasted playlist links parsed to `spotify:playlist:<id>`;
  learns every non-ad track that plays during a session; `clearLibrary()` keeps playlists.
- Scoring: Last.fm track + artist tags (error 6 = no tags) → keyword rules (`lastfm`/`rules`), or, only if
  `privacy.get().aiScoring`, one OpenRouter batch (≤50, waits up to 5 min to fill, zod-validated, free models in order,
  backoff on 429/failure, 60 s global gap, 20/day cap, 120 s timeout; falls back to rules after 3 failed batches).
  Cached on the song; only `rescore()` scores again.
- Learning: tense/crashing → focused during a song = settle vote + energy −0.5; focused throughout = steady vote;
  user skip within 30 s = quick skip + confidence −0.1. Source becomes `learned`.
- Selector + switching: §6 targets, activity defaults (admin → Lift, downtime → Let it ride with 3× longer change gap),
  wind-down in the last 10 min (Settle still wins), ≤1 target change per 3 min, switches at the end of the current track
  (Settle switches right away), unsure songs never for Settle/Ease down, ~1 in 5 picks in Steady/Let it ride may be
  unsure, Leave-alone stops switching but keeps learning. "Open Spotify to let me pick music" bubble once per session.
  Pauses on `break:away`, resumes on `break:returned`. `data:deleted-all` drops songs, playlists and the queue
  without writing back. Session `config.music === false` or privacy music `none` → does nothing.

## Real-world checks
- `npx tsx --tsconfig tsconfig.node.json src/main/music/dev/spotify-check.ts`: played Never Gonna Give You Up by URI,
  read it 3× (position 1.3 s → 3.6 s → 5.9 s), `next` → onTrackChange fired with the next track, paused at the end.
  12 s total, volume 15 %. A shell-injection URI was rejected.
- `dev/scoring-check.ts`: Last.fm tags for Einaudi and Rick Astley, none for a fake artist (error 6 path).
  **1 OpenRouter request** (nemotron, 35 s) returned valid JSON: Einaudi 2/neutral/instrumental 0.9,
  fake song confidence 0.2.

## Simplified / stubbed
- Settle switches early without a fade: the `MusicController` interface has no volume read, so a fade couldn't
  restore the user's volume.
- LLM daily cap is in memory (resets on restart).
- Fallback mood playlists in `src/main/music/config.ts` are placeholders and are skipped until Daniel fills them.

## Needs Daniel
- Real public playlist links in `FALLBACK_PLAYLISTS` (`src/main/music/config.ts`).
- The Electron app will trigger its own macOS Automation prompt for Spotify on first use.

## Notes for integration
- `SessionRecord.learnedSongIds` has no source: `MusicService` doesn't expose which songs it learned from this session.
  Session (B) can't fill it yet; a `learnedSongIds()` method or a bus event would be needed if it matters.
