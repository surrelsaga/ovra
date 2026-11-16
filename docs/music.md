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
  wind-down in the last 10 min (Settle still wins), ≤1 target change per 3 min, steers at the next song by skipping inside the playlist (see "Steering" below;
  Settle fades down, skips early, then fades back to the starting volume), unsure songs never for Settle/Ease down, ~1 in 5 picks in Steady/Let it ride may be
  unsure, Leave-alone stops switching but keeps learning. "Open Spotify to let me pick music" bubble once per session.
  Pauses on `break:away`, resumes on `break:returned`. `data:deleted-all` drops songs, playlists and the queue
  without writing back. Session `config.music === false` or privacy music `none` → does nothing.

## Steering without the Spotify pop-up (decision 61, Job 20)
- `play track` (with or without a context) always brings Spotify to the front; `next track`, pause,
  resume and volume never do. So during a session Ovra sends `play track` only to **start or switch a
  playlist**; everything else is silent skips.
- **Start:** save the user's shuffle/repeat, turn shuffle on, then one `play track <best song> in
  context <playlist>` for the user's playlist with the most fitting unplayed songs (scored fits rank
  first). It runs at session start, while Ovra's calibration window is in front. With no pasted
  playlists the target's editorial playlist is used instead.
- **Steer:** on every new song (track polling), on Quiet, and on every target change in demo
  (`switchNow`): an ad or a paused player is left alone; a song that fits (`fitsNow`: same distance
  as picks, ≤ `steering.fitDistance`, ignoring the cross-session cooldown) and isn't a repeat (same
  id, or same title + lead artist) stays; otherwise `next track` and check again. Unscored songs may
  play (they come from the user's playlists) except for Calm down / Quiet. Normal sessions judge the
  next song after a target change (PLAN §6 "only between tracks").
- **Volume:** a skip chain ducks to 25% of the user's level in one step and comes back after; Quiet
  fades down over 2.5 s, skips to a calm fit, fades back up. Same Job 6 rules (±2 tolerance, always
  restored unless the user changed it, also after errors, breaks, leave-alone, stop).
- **Switch** (the only pop-up mid-session): when a chain reaches 8 skips, or the playlist has no
  fitting unplayed song left, play the best song of the best *other* playlist, at most once per
  3 min (start and the dev simulator's "Switch music now" are exempt). If no switch is allowed or
  possible, the song stays (no pointless skipping). Switches get the decision-58 readiness check.
- **Fast refocus** (inside `SpotifyMacController.play`, so the shared interface is unchanged):
  `lsappinfo front` before the command; if that app isn't Spotify, poll `lsappinfo front` every 50 ms
  (up to 1.5 s) and, once Spotify is in front, `open -a <that app's bundle path>`. LaunchServices
  tools need no Automation/Accessibility permission (System Events would). `open -a <path>` rather
  than `open -b <bundle id>` so a dev Electron.app can't resolve to another copy. If the user moves
  to a third app meanwhile, or was in Spotify, nothing is refocused.
- **Free accounts:** never skip an ad. A skip Spotify refuses (no new song within 3 s, or an error)
  is logged once per session and the current song stays.
- **Session end:** shuffle and repeat go back to what they were, unless the user turned shuffle off
  during the session (they took over).
- **Dropped:** the 1-in-10 Spotify editorial picks during sessions (each would need a pop-up switch).
  App skips are never learned as the user's quick skips.
- Numbers live in `musicConfig.steering`.

## Real-world checks
- `npx tsx --tsconfig tsconfig.node.json src/main/music/dev/spotify-check.ts`: played Never Gonna Give You Up by URI,
  read it 3× (position 1.3 s → 3.6 s → 5.9 s), `next` → onTrackChange fired with the next track, paused at the end.
  12 s total, volume 15 %. A shell-injection URI was rejected.
- `dev/scoring-check.ts`: Last.fm tags for Einaudi and Rick Astley, none for a fake artist (error 6 path).
  **1 OpenRouter request** (nemotron, 35 s) returned valid JSON: Einaudi 2/neutral/instrumental 0.9,
  fake song confidence 0.2.

## Simplified / stubbed
- Settle fades to a low volume over 2.5 s, skips to a calm song, then returns to the starting volume over 2.5 s.
  The fade stops and restores the starting volume when the session ends, a break starts, Leave-alone is enabled,
  data is deleted, or playback fails. If the user changes volume during the fade, it stops and leaves their value.
  Controllers without a volume reader, or with an unreadable volume, switch immediately without fading.
- LLM daily cap is in memory (resets on restart).
- Fallback mood playlists in `src/main/music/config.ts` are placeholders and are skipped until Daniel fills them.

## Needs Daniel
- Real public playlist links in `FALLBACK_PLAYLISTS` (`src/main/music/config.ts`).
- The Electron app will trigger its own macOS Automation prompt for Spotify on first use.

## Notes for integration
- `SessionRecord.learnedSongIds` has no source: `MusicService` doesn't expose which songs it learned from this session.
  Session (B) can't fill it yet; a `learnedSongIds()` method or a bus event would be needed if it matters.
