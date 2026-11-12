# Ovra: build plan

Entry for the DEV Presage SmartSpectra SDK challenge.

- **Deadline:** Nov 22, 11:59 PM PST (Nov 23, 3:59 PM Singapore time). Winners announced Dec 10.
- **Solo entry.** One entry per person, 18+.
- **Name:** Ovra. Repo, package and app name: `ovra`.
- **Build target for the MVP:** an Electron app, built and tested on macOS (Apple Silicon). Windows comes after the MVP (see section 9).

This file is the source of truth for Claude Code. Read it fully before writing code.

---

## 0. The idea in one paragraph

A desktop app where you start a timed session (deep work, debugging, writing, admin, downtime). While it runs, a small **moon orb** sits on your screen and reads your vitals (and optionally your face) through the webcam using the Presage SmartSpectra SDK. From those signals the app:

1. plays music from **your own Spotify** that fits how you're doing,
2. tells you when to **stand up and move**, for how long, and **shows you exactly what to do** on a move card, and
3. checks whether the break helped.

Privacy choices are asked upfront, before the camera ever turns on. Nothing is recorded.

Prize targets: Best Overall Human-Sensing Experience, and Most Creative or Delightful Use.

---

## 1. Decisions already made

| Topic | Decision |
| --- | --- |
| App type | **Electron + TypeScript**, one codebase. MVP built and tested on macOS Apple Silicon. |
| Platform-specific parts | Only the **music controller** is platform-specific. Mac version now, Windows version after the MVP, behind the same interface. |
| Sensing | `@smartspectra/node-sdk` (Node 20+, Electron 28+). Telemetry off unless the user opts in. |
| Camera mode | **Check-ins by default** (~90s every 5 min, camera fully stopped in between). **Continuous mode** as an opt-in. |
| Face analysis | Opt-in. With "vitals only", face metrics are never requested. |
| Character | **Moon orb.** Shows state through color, brightness and pulse. Guides breathing. Does not demonstrate moves. |
| Moves | Shown on a separate **move card**: line-figure animation, one step at a time, countdown, live feedback. |
| Music source | **Spotify desktop app, controlled by script** (AppleScript on Mac). Works with free accounts, no Spotify login or API key. |
| Music library | Built from **pasted playlist links** + songs **learned as they play**. Fallback: a shipped list of **public mood playlists**. |
| Song scoring | **Last.fm tags → LLM (OpenRouter) → web search only if needed.** Cached once per song with confidence and source. Refined over time by the user's vitals. |
| No fixed buckets | Songs get scores (energy, mood, vocals, confidence). Six music targets pick songs from scores. UI shows only Calm / Focus / Boost. |
| Storage | Local only. No accounts, no cloud. |
| Auto-delete | Session history removed after 30 days by default. |
| UI style | **Dark, simple, minimal, cool.** Looks like a real app, not over-polished. Reference: [Introducing Stocklabs Collaboration](https://dribbble.com/shots/12575677-Introducing-Stocklabs-Collaboration) (https://dribbble.com/shots/12575677-Introducing-Stocklabs-Collaboration) |
| Flow mockups | Design canvas: https://claude.ai/artifact/RduPkHRRWoU88n5JeWYURu. Use it for **flow and content only**. It's light-themed with an old blob character. The real app is dark with the moon orb. |

---

## 2. Setup checklist (Daniel does this before building starts)

Claude Code agents can build mostly unattended once these are done.

### Accounts and keys

- [ ] **Presage**: sign up for the SmartSpectra free trial at the physiology portal, create an API key.
- [ ] **OpenRouter**: create an API key. Free models are fine for song scoring. Check whether web search is free or paid on the account.
- [ ] **Last.fm**: create a free API account to get an API key (used for track tags).
- [ ] **Spotify**: desktop app installed on the Mac and logged in (free account is fine).

### Machine

- [ ] macOS on Apple Silicon (confirmed).
- [ ] Node.js 20+ (24 LTS recommended), npm.
- [ ] git, GitHub account, and a new empty **public** repo named `ovra`.
- [ ] Claude Code installed and logged in.
- [ ] Claude Code permission mode set so agents can run commands and edit files without asking each time (inside the project folder only).

### Files to put in the repo before the first prompt

- [ ] `PLAN.md`: this file.
- [ ] `CLAUDE.md`: the rules in section 12.
- [ ] `.env` (git-ignored) with:
  ```
  PRESAGE_API_KEY=...
  OPENROUTER_API_KEY=...
  LASTFM_API_KEY=...
  ```
- [ ] `.env.example` with the same names and no values (committed).
- [ ] `test-media/` (git-ignored) with test videos of Daniel (see below).

### Test videos (the biggest unlock for unattended building)

Agents can't sit in front of the webcam. Record these with the Mac's camera, in normal desk lighting, and put them in `test-media/`:

| File | Length | What's in it |
| --- | --- | --- |
| `calm-working.mp4` | 3 min | Sitting and working normally, face in view |
| `tense.mp4` | 2 min | Acting stressed: fast breathing, frowning, muttering |
| `stretch.mp4` | 1.5 min | Neck tilts left and right, shoulder rolls, looking up |
| `leave-and-return.mp4` | 2 min | Working, standing up and leaving frame for ~40s, coming back |
| `low-energy.mp4` | 2 min | Slumped, slow, blinking a lot |

The app gets a **dev-only "video source" mode** that feeds one of these into the SDK instead of the live camera, so the whole sensing and state pipeline can be tested without a person present.

### Things that will still need Daniel during the build

- **macOS permission prompts** (first run only): camera access for the Electron app, and "allow to control Spotify" (Automation). These need a click.
- **One live test** with the real camera before submitting.
- **Tuning thresholds** ("does tense feel right?").
- **Reviewing the UI**, then recording the demo video and writing the DEV post.

---

## 3. Architecture

### Processes and windows

| Window | Kind | Purpose |
| --- | --- | --- |
| **Main window** | Normal window, sidebar layout | Onboarding/privacy, session setup, calibration, music library, history, settings |
| **Orb window** | Small, frameless, transparent, always on top, draggable | The moon orb + speech bubble + mini controls during a session |
| **Move card window** | Small, frameless, always on top, shown near the orb | Guided moves, nudge prompts, break and return screens |

- **Main process (Node):** session engine, state engine, music controller, song scoring, storage, scheduler. Owns the SDK instance through `bindSmartSpectraIpc(window)` from `@smartspectra/node-sdk/main`.
- **Renderer (React + TypeScript):** UI only. Camera capture runs in a renderer through `@smartspectra/node-sdk/renderer`, which sends frames to the main process. A hidden or offscreen renderer can own capture so the camera isn't tied to a visible window.

### Suggested stack

- Electron 28+ with **electron-vite** (or Electron Forge + Vite), TypeScript, React.
- Styling: plain CSS variables or Tailwind. Dark theme tokens defined once.
- Storage: JSON files in Electron's `userData` folder, written through one storage module. No native database (fewer build problems).
- Tests: Vitest for logic (state engine, music targets, scoring parser).
- Spotify control (Mac): `osascript` via Node `child_process`.

### Module map

```
src/
  main/
    sdk/            SmartSpectra setup, start/stop, check-in scheduler, dev video source
    state/          baseline, smoothing, situation classifier, seated time, away detection
    session/        session lifecycle, timer, activity defaults, event bus
    music/
      controller/   MusicController interface + SpotifyMacController (+ later SpotifyWindowsController)
      library/      song store, playlist links, learning from playback
      scoring/      Last.fm → LLM → web search pipeline, cache
      selector/     picks next track from state + targets
    moves/          move library, nudge rules, move verification
    privacy/        settings, consent, deletion, auto-delete
    storage/        JSON read/write in userData
    ipc/            typed IPC channels between main and renderers
  renderer/
    main-window/    onboarding, setup, calibration, library, history, settings
    orb/            moon orb + bubble + mini controls
    move-card/      nudge, guided move, break, return check
  shared/
    types.ts        all shared types and event names (written first, see section 11)
    theme.css       dark theme tokens
```

### Event bus (main process)

Everything talks through typed events so modules can be built in parallel:

- `session:started`, `session:ended`, `session:tick`
- `sdk:checkin-started`, `sdk:checkin-ended`, `sdk:metrics`, `sdk:validation`, `sdk:error`
- `state:updated` (situation, confidence, seatedMinutes, away)
- `music:track-changed`, `music:target-changed`
- `move:nudge`, `move:started`, `move:step`, `move:completed`, `move:snoozed`
- `break:away`, `break:returned`
- `privacy:camera-paused`, `privacy:camera-resumed`

---

## 4. Sensing (SDK)

### What the Node SDK gives us

| Bundle | Metrics | Notes |
| --- | --- | --- |
| `cardioMetrics` | Pulse rate, HRV (RMSSD, mean NN, SDNN, Baevsky stress index), arterial pressure trace | Pulse is a 12s average. HRV needs a full 60s window before it has confidence. Valid at pulse 40 to 110 bpm. |
| `breathingMetrics` (default) | Breathing rate, chest and abdomen traces | 30s average. Talking and big movement throw it off. |
| `faceMetrics` | 478 face landmarks, blinking, talking, expressions (angry, contempt, disgust, fear, happy, neutral, sad, surprise) | Opt-in only. Presage publishes no accuracy data for expressions. |
| `edaMetrics` | EDA trace | Not used in the MVP. |
| `micromotionMetrics` | Glutes and knees micromotion | Not used in the MVP. |

- Every reading has `confidence` (0 to 100) and `stable`. **Only act on stable readings.**
- Read fields from the `metrics` event: `cardio.pulseRate`, `cardio.hrv`, `breathing.rate`, `face.landmarks`, `face.blinking`, `face.talking`, `face.expression`.
- Use `validationStatus` events (code + hint) for "no face", "too dark", "move closer". This is also the **away detection** signal.
- Do **not** request any of these, or `start()` fails: `BREATHING_AMPLITUDE`, `APNEA`, `RESPIRATORY_LINE_LENGTH`, `BASELINE`, `INHALE_EXHALE_RATIO`.
- Set `enableTelemetry = false` unless the user opted in.
- Do **not** use Presage LLM Insights (`requestInsight()`).

### Camera modes

- **Check-in mode (default):** every 5 minutes (user can pick 3, 5 or 10), run the SDK for ~90 seconds, then fully stop the camera stream so the Mac's camera light goes off.
- **Continuous mode (opt-in):** SDK runs the whole session.
- **Calibration:** ~90 seconds continuous at session start, to build today's baseline.
- **Return check:** 30 seconds after a break.

### Dev video source

- A dev-only setting (hidden in production builds) that feeds a file from `test-media/` into the SDK.
- Approach: play the file in a hidden `<video>` element, call `video.captureStream()`, and pass that stream to the renderer SDK with `useMediaStream()`.
- Confirm this works in the spike (section 13). If it doesn't, check the SDK docs for a video file input option.

---

## 5. State engine (the app's own logic)

The SDK only measures. This module turns measurements into decisions.

### Baseline

- Built during calibration from stable readings: median pulse, median breathing rate, median RMSSD, median Baevsky.
- Kept in memory only. Dropped when the session ends.

### Situations

| Situation | Signals (relative to baseline) | Rough starting rule (tune later) |
| --- | --- | --- |
| **Focused** | Near baseline, steady | Pulse within ±8% of baseline, breathing within ±15% |
| **Tense** | Pulse up, RMSSD down, Baevsky up, faster breathing | Pulse +10% or more AND (RMSSD −15% or more OR breathing +20% or more), held for 2+ check-ins (or 3+ min in continuous mode) |
| **Crashing out** | Tense, plus more | Tense for 10+ min, OR pulse +20% with face showing angry/sad/disgust for most of the window (face only if opted in) |
| **Low energy** | Pulse below baseline, slow breathing, lots of blinking | Pulse −8% or more AND breathing −15% or more, OR blink rate well above baseline (face only) |
| **Good mood** | Near baseline + happy expression | Focused AND happy is the top expression for most of the window (face only) |

Rules:

- **Vitals lead, the face only supports.** Expressions never trigger a situation alone.
- **Smooth over time.** Decide from several readings, never from one spike.
- **Talking breaks breathing.** When `talking` is detected, ignore breathing for that window.
- Put all thresholds in one config file so they're easy to tune.

### Seated time and away detection

- **Seated time:** minutes the face has been in frame without a gap of over ~60 seconds. In check-in mode, a check-in with no face counts as a gap.
- **Away:** in continuous mode, no face for 20+ seconds. In check-in mode, the user clicks "I'm going" and later "I'm back".

### Output

Emit `state:updated` with: `situation`, `confidence`, `seatedMinutes`, `away`, `trend` (rising, steady, falling).

### Acceptance

- Unit tests with fake metric streams for each situation.
- Running the dev video source on `calm-working.mp4` gives Focused, and `tense.mp4` gives Tense (after tuning).

---

## 6. Music

### How it works with a free Spotify account

The app controls the **Spotify desktop app** with AppleScript (`osascript`). It works with free accounts and needs no Spotify login or API key. What it can do:

- Play a track, album or playlist by link or URI
- Play, pause, next, previous, set volume
- Read the current track: name, artist, album, Spotify ID, player state

What it **can't** do: search Spotify or read the user's library or playlists. So the library is built like this:

1. **Pasted playlist links.** In setup, the user pastes one or more of their playlist links. The app plays those playlists.
2. **Learning as it plays.** Every time a new song plays (from our app or the user's own clicking), the app records title, artist and Spotify ID, then scores it in the background.
3. **Exact picks once known.** When a mood switch is needed, the app plays a known song by its ID.
4. **Public mood playlists as fallback.** A shipped config file maps each target to a few public Spotify playlist links (calm piano, focus, upbeat). Used when the user has no playlists or the library doesn't have enough scored songs yet. **Daniel fills in the actual links** (agents can't verify them), with placeholders until then.

Things to test on day 1 (section 13):

- Free accounts on desktop can play an exact track on demand.
- Reading the current track works reliably on the current Spotify version (it has broken in past versions).
- Ads on free accounts: detect them (no track ID, or "ad" metadata) and don't score them.

### Song scores

| Score | Values | Why it matters |
| --- | --- | --- |
| Energy | 1 (very soft) to 5 (very intense) | Main lever for calming down or lifting up |
| Mood | dark / neutral / bright | Bright helps when low, dark can worsen tension |
| Vocals | instrumental / light / heavy | Some people focus worse with lyrics |
| Confidence | 0 to 1 | Low-confidence songs are kept out of moments that matter |
| Source | lastfm / llm / web / learned | Shown in the music library as "why it's here" |

### Scoring pipeline (once per song, background, cached)

1. **Last.fm tags.** Call `track.getTopTags` (artist + track). Tags like "chill", "energetic", "sad", "upbeat", "instrumental" are real crowd data about the song. If the track has no tags, also try the artist's top tags.
2. **LLM via OpenRouter.** Send title, artist and the Last.fm tags. Ask for energy, mood, vocals and confidence as strict JSON. The LLM uses the tags plus what it knows about the song. Batch up to ~50 songs per request.
3. **Web search, only if needed.** If confidence is still low (no tags and the LLM isn't sure), use OpenRouter's web search on that song. This is the last resort because it's slower and may cost money.
4. **Cache** the result keyed by Spotify ID: scores, confidence, source, timestamp. Never re-score unless the user asks.

Rules:

- Send only title and artist (and tags). **Never send vitals or moods** to any service.
- The LLM and web steps are **opt-in** on the privacy screen. If declined, songs are scored from Last.fm tags with simple keyword rules, then learned from the body.
- Rate-limit calls and retry with backoff. Never block a session on scoring.

### Learning from the body

- For each song that plays during a session, record the state before and after (e.g. pulse change vs baseline, whether the user stayed Focused, whether they skipped within 30s).
- Over a few plays, nudge the scores:
  - The pulse keeps settling: lower effective energy, mark it as good for Settle.
  - The user stays steady: good for Steady.
  - Quick skips: lower confidence.
- Store these as small adjustments on top of the base scores, so the source shows "learned".

### Music targets

| Target | When | Songs it pulls |
| --- | --- | --- |
| **Settle** | Crashing out | Energy 1 to 2, neutral or bright, high confidence only |
| **Ease down** | Tense | One energy step below the current song, stepping down over a few songs, high confidence only |
| **Steady** | Focused | Energy close to what's been working; includes learned "steady" songs |
| **Lift** | Low energy | Energy 3 to 4, bright |
| **Let it ride** | Good mood | Keep it bright, don't switch |
| **Wind down** | Last ~10 min of the session | Drift lower |

- **UI words:** Calm (Settle, Ease down, Wind down), Focus (Steady, Let it ride), Boost (Lift).
- **Activity defaults:** deep work, debugging and writing lean Steady. Admin leans Lift. Downtime lets anything bright play and barely switches.
- **Unsure songs:** never used for Settle or Ease down. About 1 in 5 songs during Steady or Let it ride may be an unsure one, so it can be learned.

### Switching rules

- Pick the next song while the current one plays.
- Only change between tracks (wait for the current song to end), except Settle, which can fade into the next song early.
- No more than one target change every ~3 minutes.
- "Leave my music alone" toggle turns off all switching but keeps learning.
- If Spotify isn't running, show a quiet hint in the orb bubble ("Open Spotify to let me pick music") and carry on without music.

### Interface (for Mac now, Windows later)

```ts
interface MusicController {
  isAvailable(): Promise<boolean>;
  play(uri: string, contextUri?: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  next(): Promise<void>;
  setVolume(pct: number): Promise<void>;
  current(): Promise<NowPlaying | null>; // { id, uri, name, artist, album, durationMs, positionMs, state, isAd }
  onTrackChange(cb: (t: NowPlaying) => void): () => void; // implemented by polling every ~2s
}
```

---

## 7. Moves

### Move library (MVP)

| Move | Suggested when | Length | How the app checks it |
| --- | --- | --- | --- |
| Breathe along | Tense, early | 1 to 2 min | Orb grows and shrinks at ~6 breaths/min; breathing rate trends toward it |
| Neck and shoulder stretch | Tense, or seated 45+ min | ~90s | Head tilt from face landmarks (if face opted in), otherwise not checked |
| Stand and stretch | Seated 60+ min, or low energy | 2 to 3 min | Face moves up and out of the usual spot, then back (continuous mode) |
| Walk / get water | Crashing out, or seated 90+ min | 5 min | Away, then return |
| Step outside | Tense or crashing out for 15+ min | 10 min | Away, then return |

All lengths and triggers are starting values in a config file.

### Nudge rules

- At most **one nudge every 20 minutes**.
- Choices: **Let's go / 5 more min / Skip.** Snoozes are counted in the session summary.
- Wording is always a wellness suggestion: "You seem tense", never a health claim.

### Move card UI

- Pops up next to the orb.
- Shows a **simple line-figure animation** of the current step (SVG or CSS animation, one per step), the step title, one line of how-to, a **countdown ring**, and the step list.
- **Live feedback** when the app can check the move: "I can see the tilt", "Your breathing is slowing down".
- During **Breathe along**, the orb itself does the guiding (grows on inhale, shrinks on exhale), and the card shows "in" and "out".

### Breaks and the return check

- **Check-in mode:** the user clicks "Okay, going". The camera stays off. The orb dims and shows the time away. The user clicks "I'm back", then a 30s return check runs.
- **Continuous mode:** the orb dims when the face leaves and wakes when it returns, then runs the 30s check.
- **After the check:** "You're calmer than before" (back near baseline) or "Still a bit tense. Want a 1 min breathing round?"
- Music pauses during away breaks and resumes after.

---

## 8. The moon orb

### Look

- A soft glowing circle on a transparent background, ~96 to 128 px, with a gentle idle pulse.
- **Color and brightness carry the state.** No face, no eyes. Must stay readable on light and dark desktops.

### States

| State | When | Look |
| --- | --- | --- |
| Calm | Focused | Cool soft white-blue, slow gentle pulse |
| Uneasy | Tense | Warmer amber, slightly faster pulse |
| Stormy | Crashing out | Orange-red edge, flickery pulse |
| Dim | Low energy | Low brightness, grey-blue, slow |
| Bright | Good mood | Brighter, warm white, soft sparkle |
| Listening | Camera on (calibration or check-in) | A thin ring orbits the moon. **This is the camera indicator and can't be hidden.** |
| Away | User is on a break | Crescent / eclipsed look, very dim, shows time away |
| Breathing | Breathe along | Grows and shrinks with the breath |

### Around the orb

- **Speech bubble:** short messages ("You seem tense, easing into calmer songs").
- **Mini controls** on hover: pause camera, leave my music alone, end session, open main window.
- **Now playing chip:** song, artist, and the current target word (Calm / Focus / Boost).

---

## 9. Platforms

- **MVP:** Electron app on macOS Apple Silicon. Everything except music control is cross-platform already: Electron, React UI, and the Presage Node SDK (which also supports Windows x64).
- **After the MVP: Windows.** Add `SpotifyWindowsController` behind the same `MusicController` interface:
  - Play by opening `spotify:` URIs through the OS.
  - Play, pause and next through system media keys.
  - Read the current track through Windows' media session API (System Media Transport Controls), via a small native helper or a Node package.
- Nothing outside `src/main/music/controller/` may call `osascript` or other Mac-only APIs.

---

## 10. Privacy and security

### Consent (asked on first launch, before any camera code runs)

Each question is separate, with no "accept all". Changeable later in Settings → Privacy.

| Question | Options | Default |
| --- | --- | --- |
| Can the app use your camera during sessions you start? | Yes / Not now | Must answer |
| How often can it look? | Check-ins every few minutes / The whole session | Check-ins |
| Can it read your face too? | Vitals and face / Vitals only | No default, must pick |
| Where's your music? | Spotify desktop app / No music | Spotify |
| Can an AI help score your songs? (sends song titles, artists and public tags, never vitals) | Yes / No | No |
| Share anonymous diagnostics with Presage? | Share / Don't share | Don't share |
| Auto-delete old session history? | 30 days / 90 days / Never | 30 days |

Saying "Not now" to the camera still gives a working app: timer, music, and timed move nudges without sensing.

### What the app guarantees

| Topic | What the app does |
| --- | --- |
| **Camera use** | Only inside a session the user started. Check-in mode fully stops the stream between check-ins so the Mac's camera light goes off. Off when the session ends. |
| **Visibility** | The orb shows Listening whenever the camera is on, and it can't be hidden while it is. Pause is one click. |
| **No recording** | Frames go from the camera to the SDK in memory only. The app never writes a frame, image or video to disk, and never uploads one. The calibration preview is display-only. |
| **Face analysis** | With "vitals only", `faceMetrics` is never requested. |
| **Storage** | Local only, in `userData`: mood labels with timestamps, moves done, session length, song scores and learned adjustments, settings. **Not stored:** raw pulse, breathing or HRV values, expression scores, landmarks, the baseline. |
| **Sharing** | Nothing by default. Spotify only receives play commands on the same machine. "This song calms you" stays local. |
| **AI services** | Opt-in. Sends titles, artists and public tags only. Presage LLM Insights not used. |
| **SDK telemetry** | `enableTelemetry = false` unless opted in. Per Presage, telemetry has no frames, no measured values, no user or device IDs. |
| **Deletion** | Delete one session, or delete everything, in one click. "Clear music library" removes song scores. |
| **Auto-delete** | Session history older than the chosen period is deleted on app start and daily. Song scores and settings are kept until the user clears them. |
| **Secrets** | API keys from `.env` in dev. Never committed. Never shown in logs. |
| **Not medical** | "Not a medical device" on the consent screen and in the README. No diagnosis, no treatment advice, no numbers presented as medical readings. Only monitors the person who started the session. |

### Wording we can't use yet

Presage's docs don't clearly say all vitals processing stays on the device, and they mention other server requests without listing them. Until Presage confirms (ask in their Discord), say **"the app never saves or uploads video"**, not "nothing leaves your laptop".

### DEV post: Consent and Data Handling section

The challenge requires this section (camera consent, storage, sharing, retention, deletion, SDK telemetry, optional AI use). Write it from the two tables above.

---

## 11. UI and screens

### Style

- **Dark theme**, simple, minimal, cool. Looks like a real app. Reference: https://dribbble.com/shots/12575677-Introducing-Stocklabs-Collaboration
- Near-black background, slightly lighter panels, soft borders, one accent color, rounded corners, clean sans-serif (Inter or similar).
- The orb is the main spot of color and glow.
- Accessible: real buttons and labels, text contrast at least 4.5:1, 44px touch targets.

### Main window (sidebar layout)

Sidebar: Session · Music · History · Privacy · Settings.

1. **Onboarding / privacy**: the consent questions from section 10, with the orb greeting. Shown once.
2. **New session**: activity (Deep work, Debugging, Writing, Admin, Downtime), length (45 min, 1 h, 2 h, 3 h, custom), camera mode, music on/off. Start button.
3. **Calibration**: live preview (not recorded) with SDK hints, a 90s progress bar, and a "getting to know your music" progress line if scoring is running. Then the main window hides and the orb appears.
4. **Music**: paste playlist links, a list of known songs with energy dots, mood, vocals and "why it's here", tabs for Calm / Focus / Boost / Not sure yet, a "Leave my music alone" toggle, and a clear library button.
5. **History**: past sessions with a mood timeline bar, moves done, and a delete button.
6. **Privacy**: all consent answers, editable. Delete everything. Auto-delete period.
7. **Settings**: check-in interval, nudge frequency, thresholds (advanced), dev video source (dev builds only).

### Orb window

Orb, speech bubble, now playing chip, mini controls. Draggable, remembers position.

### Move card window

The nudge prompt, guided move, away timer, and return check, as described in section 7.

### Session end

Summary in the main window:
- the mood timeline
- moves done and snoozed
- songs the app learned something about
- longest seated stretch
- what's saved, with a delete button

The camera is off.

---


## 12. Build order for Claude Code

### Phase 0: spike (one agent, do this first)

Goal: prove the risky parts work before building on them.

1. Scaffold the Electron + TypeScript + React app with electron-vite.
2. Install `@smartspectra/node-sdk`, wire `bindSmartSpectraIpc` and the renderer capture, and log pulse, breathing and HRV from the **live camera**.
3. Get the **dev video source** working with `test-media/calm-working.mp4`.
4. Request `faceMetrics` and log landmarks, blinking and expressions. Check what `validationStatus` says when no face is in view.
5. AppleScript test against the Spotify app:
    - play a track by URI on a free account
    - read the current track repeatedly over a few songs
    - detect an ad
6. Call Last.fm `track.getTopTags` and one OpenRouter request with a test song.
7. Write findings to `docs/spike-notes.md`: what works, what doesn't, and any changes to the plan.

**Stop and let Daniel review the spike notes before Phase 1.**

### Phase 1: contracts (one agent)

- Write `src/shared/types.ts`: all types (Metrics snapshot, Baseline, Situation, StateUpdate, Song, SongScores, MusicTarget, NowPlaying, Move, MoveStep, Session, PrivacySettings, etc.), all event names and payloads, and all IPC channel names.
- Write the `MusicController` interface and empty module folders with stub exports.
- Write the dark theme tokens in `src/shared/theme.css`.
- Set up Vitest and a basic CI script (typecheck, lint, tests).

### Phase 2: parallel agents (each in its own git worktree and branch)

| Agent | Owns | Done when |
| --- | --- | --- |
| **A. Sensing** | `main/sdk/`: check-in scheduler, continuous mode, calibration, return check, dev video source, camera start/stop | Emits `sdk:*` events; the camera light goes off between check-ins; works on all test videos |
| **B. State engine** | `main/state/`: baseline, smoothing, classifier, seated time, away detection, config | Unit tests pass for every situation; correct situation on the test videos |
| **C. Music** | `main/music/`: SpotifyMacController, library, scoring pipeline, learning, selector, mood playlist config | Plays and reads tracks; scores and caches songs; the selector picks the right target per situation (tests) |
| **D. Moves** | `main/moves/` + `renderer/move-card/`: move library, nudge rules, line-figure animations, verification, break and return flow | Every move plays end to end; nudges respect the 20 min limit |
| **E. Orb + shell** | `renderer/orb/`, windows setup, main window shell and sidebar, onboarding/privacy, session setup, calibration, music, history, settings screens | All screens render in the dark style; the orb shows every state |
| **F. Privacy + storage** | `main/privacy/`, `main/storage/`: settings, consent gate (camera code can't run before consent), deletion, auto-delete | Tests show nothing raw is stored; delete everything works; auto-delete runs |

Agents only touch their own folders plus additions to `shared/types.ts`, coordinated through Phase 1's contracts. If a contract has to change, note it in `docs/contract-changes.md`.

### Phase 3: integration (one agent)

- Wire everything through the event bus. Run full sessions on each test video.
- Fix cross-module bugs. Make sure a session with the camera declined still works.

### Phase 4: polish and submission (agent + Daniel)

- README: what it is, setup (Presage key, Spotify desktop, optional keys), how to run, the privacy section, and "not a medical device".
- Package a macOS build (unsigned is fine) if time allows. Otherwise "run from source" instructions.
- Daniel: live test, threshold tuning, demo video, DEV post with the Consent and Data Handling section, and the `#presagechallenge` tag.

### Must ship vs nice to have

| Must ship | Nice to have |
| --- | --- |
| Consent + privacy screens | Windows support |
| Session setup, calibration, check-in and continuous modes | Web search in scoring |
| State engine with the five situations, seated time, away | All five moves (MVP needs at least Breathe along, Neck stretch, Walk) |
| Moon orb with all states | Body learning beyond simple skip/settle signals |
| Spotify control + pasted playlists + learning + Last.fm/LLM scoring | Packaged signed app |
| Music targets and switching rules | Extra widgets |
| Move card with at least 3 moves and the return check | |
| History, delete, auto-delete | |
| README, demo video, DEV post | |

---

## 13. Open questions to answer in the spike

1. Does the dev video source (`captureStream` → `useMediaStream`) work with the SDK?
2. How does `validationStatus` report "no face"? Is it reliable enough for away detection?
3. Do face landmarks give a usable head tilt for the neck stretch check?
4. How long until pulse, breathing and HRV are stable on the Mac's camera in normal light?
5. CPU and memory use while the SDK runs.
6. Spotify free on desktop: can AppleScript play an exact track on demand? Is current-track reading reliable? How do ads show up?
7. Does the SDK make network calls at runtime beyond auth? (Ask Presage on Discord for the privacy wording.)
8. Is OpenRouter web search available and affordable on the account?

---

## Sources

- [DEV challenge post](https://dev.to/devteam/join-the-presage-smartspectra-sdk-challenge-3000-in-prizes-across-10-winners-1370)
- [SmartSpectra Node.js / Electron docs](https://smartspectra.presagetech.com/docs/nodejs.md)
- [SmartSpectra Node.js metrics](https://smartspectra.presagetech.com/docs/nodejs/metrics.md)
- [SmartSpectra data types](https://smartspectra.presagetech.com/docs/data-types.md)
- [SmartSpectra model cards and limitations](https://smartspectra.presagetech.com/docs/model-cards-and-limitations.md)
- [SmartSpectra telemetry and privacy](https://smartspectra.presagetech.com/docs/telemetry-and-privacy.md)
- [SmartSpectra docs index for agents](https://smartspectra.presagetech.com/llms.txt)
- [Spotify AppleScript control notes](https://ohmyopenclaw.pages.dev/skill/spotify-applescript)
- [Spotify: Feb 2026 Web API dev mode changes](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Spotify: Nov 2024 Web API changes](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)
- [UI reference: Stocklabs Collaboration on Dribbble](https://dribbble.com/shots/12575677-Introducing-Stocklabs-Collaboration)
- [Flow mockups (design canvas)](https://claude.ai/artifact/RduPkHRRWoU88n5JeWYURu)
