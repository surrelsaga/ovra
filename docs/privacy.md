# Privacy: what Ovra stores, sends and does

Owner: Agent F (`src/main/privacy/`, `src/main/storage/`).

This file is the full, plain list. It's checked against the code and the SDK package (Nov 14, 2026). If a module
starts storing, sending or doing something new, add it here in the same change.

## How the code enforces it

- **Storage** (`src/main/storage/`) writes only five files in the data folder: `privacy.json`, `settings.json`,
  `sessions.json`, `songs.json`, `playlists.json`. Any other name is refused. Writes are atomic (a temp file
  `.<name>.<random>.tmp`, then rename) and run one at a time per file. A corrupt file is kept as
  `<name>.json.corrupt` and the app starts from defaults.
- **Owner-only files:** every file is written with mode `0600` (only your user account can read it), and on
  startup Ovra resets any older file to `0600`. On Windows this is a no-op; the files sit in your own profile.
- **Raw data guard:** before anything touches disk, storage refuses JSON that contains a raw-vitals key at any
  depth: `pulse`, `pulseRate`, `heartRate`, `bpm`, `breathing`, `breathingRate`, `hrv`, `rmssd`, `sdnn`, `meanNn`,
  `baevsky`, `landmarks`, `expression(s)`, `baseline`, `blinkRate`, `headRollDeg`, `metrics` (any case).
  `confidence` is allowed only in `songs.json` (song score confidence). Matching is on exact key names, so state
  threshold names such as `tensePulsePct` in settings still work.
- **History records** are checked with a strict schema: a session record with any field beyond labels and
  counts is rejected, not trimmed. Privacy answers and settings use strict schemas too
  (`src/main/privacy/schemas.ts`).
- **Consent gate:** `canUseCamera()` is true only after "Yes" to the camera question. Sensing calls
  `assertCameraConsent()` before any camera code and it throws otherwise. `canUseFace()` also needs
  "Vitals and face". Both camera permission handlers (capture window and calibration preview) also check it.
- **Delete everything** removes Ovra's five files (and `.corrupt` copies), resets privacy and settings to
  defaults so onboarding shows again, emits `privacy:changed` and `data:deleted-all` so modules holding data in
  memory (music) drop it, then clears Chromium's browser storage and HTTP cache for the app
  (`session.defaultSession.clearStorageData()` + `clearCache()`).
- **Auto-delete** removes sessions that ended more than 30 or 90 days ago (or none with "Never"). It runs on
  app start and daily (`src/main/app.ts`).
- **Show the folder:** IPC `data:show-folder` opens the data folder in Finder / Explorer (for the Privacy screen).

## What's stored on your computer

### The data folder

| System | Folder |
| --- | --- |
| macOS (installed app) | `~/Library/Application Support/Ovra/` |
| macOS (run from source) | `~/Library/Application Support/ovra/` (the same folder on a normal, case-insensitive Mac disk) |
| Windows | `%APPDATA%\Ovra\` (e.g. `C:\Users\<you>\AppData\Roaming\Ovra\`). Windows isn't packaged or tested yet. |
| Linux | `~/.config/Ovra/` (not packaged or tested) |

The folder itself is owner-only (`drwx------`, created by Electron). The Privacy screen will have a button that
opens it.

### Ovra's own files (in the data folder)

| File | What's in it | Kept until |
| --- | --- | --- |
| `privacy.json` | Your consent answers: `camera` (yes / not now), `cameraMode` (check-ins / whole session), `face` (vitals and face / vitals only), `music` (Spotify / none), `aiScoring` (yes/no), `telemetry` (share/don't), `autoDelete` (30 / 90 / never), `answeredAt` (when you answered). | You change it or delete everything |
| `settings.json` | `checkinIntervalMin`, `nudgeMinIntervalMin`, `leaveMusicAlone`, `orbPosition` (x, y on screen), `thresholdOverrides` (advanced tuning numbers), `cameraTeachCount` (how many camera tips you've seen). Dev builds only: `devVideoSource` (a test video file path) and `devFramingPad`. | You change it or delete everything |
| `sessions.json` | One record per finished session: `id`, `activity` (deep work, debugging…), `startedAt`, `endedAt`, `lengthMin`, `cameraMode`, `moodTimeline` (time + label such as "focused", "tense", "away"), `moves` (time + move + done/snoozed/skipped), `snoozes`, `longestSeatedMin`, `learnedSongIds`. | Auto-delete (30 days by default), deleting the session, or delete everything |
| `songs.json` | Every song Ovra has heard play during a session: Spotify id, `title`, `artist`, `album`, `durationMs`, `firstSeenAt`, `lastPlayedAt`, `playCount`; its scores (`energy`, `mood`, `vocals`, `confidence`, `source`, `scoredAt`, public Last.fm `tags`); and small learned adjustments (`energyDelta`, `confidenceDelta`, `settleVotes`, `steadyVotes`, `quickSkips`, `plays`, `updatedAt`). | "Clear music library" or delete everything |
| `playlists.json` | Playlist links you pasted: `uri`, `url`, `name`, `addedAt`. | Removing the playlist or delete everything (clearing the library keeps playlists) |

Plainly: `songs.json` is a small listening history (what played during sessions, and when last). The learned
votes are Ovra's guesses about how a song tends to suit you ("this one seems to calm you"), worked out from your
readings at the time. The readings themselves are never written.

**Never stored:** camera frames, images or video; pulse, breathing or HRV values; expression scores; face
landmarks; your baseline. The baseline is built at calibration and kept in memory only until the session ends.

### API keys (installed app)

The installed app reads API keys from a `.env` file you create in the data folder (see `docs/packaging.md`). Ovra
only reads it and never logs the keys. It's your file: Delete everything doesn't remove it. Make it owner-only
with `chmod 600 ~/Library/Application\ Support/Ovra/.env`.

### Electron's own browser files (in the data folder)

Ovra's windows are web pages run by Electron (Chromium), and Chromium keeps its usual files next to Ovra's:
`Cache`, `Code Cache`, `GPUCache`, `GPUPersistentCache`, `DawnGraphiteCache`, `DawnWebGPUCache`,
`GraphiteDawnCache` (cached app files, compiled code and graphics shaders), `Cookies`, `Local Storage`,
`Session Storage`, `blob_storage`, `Shared Dictionary`, `shared_proto_db`, `DIPS`, `Trust Tokens`,
`VideoDecodeStats`, `declarative_performance_observer.db`, `Network Persistent State`, `Preferences` and
`Local State` (browser settings). They're owner-only (`0600`).

Ovra puts no personal data there: its code never uses cookies, local or session storage, IndexedDB or blobs, and
all its web requests (Last.fm, OpenRouter) go from Node in the main process, not through Chromium. The camera
window uses a separate in-memory browser session, so it leaves nothing on disk. The e2e test scans every file in
the data folder, Chromium files included, for raw vitals. Delete everything clears these files' contents too
(Chromium may recreate empty ones while the app runs).

### Outside the data folder

| What | Where | Who writes it | How to remove |
| --- | --- | --- | --- |
| SmartSpectra SDK folder | macOS: `~/Library/Caches/Ovra/SmartSpectraSDK/` (created `0700`). Windows: inside Electron's cache path (probably `%APPDATA%\Ovra\SmartSpectraSDK\`; not checked on Windows). | The SDK, on its first camera start. Location set by the SDK (`app.getPath('cache')` + app name), not Ovra. | Delete the folder while Ovra is closed. Delete everything doesn't touch it. |
| macOS privacy permissions | macOS's own database | macOS, when you allow Camera or Automation (Spotify) | System Settings → Privacy & Security → Camera / Automation |
| App preferences | `~/Library/Preferences/com.ovra.app.plist` (may exist) | macOS / Electron (standard app defaults; Ovra's code writes nothing there) | Delete the file |
| Spotify listening history | Your Spotify account | Spotify, as with any song you play | In Spotify |

The SDK folder is for the SDK's device keys and encrypted model cache, which it needs only for metrics Ovra
doesn't request (arterial pressure, EDA, micromotion). On Daniel's Mac it's empty. The SDK's face and pose models
ship inside the app, and its native code can also store a device key in the macOS Keychain; none was found in the
login keychain here.

**Not written anywhere:** log files (Ovra logs to the terminal only, and never logs keys or readings), crash
dumps (no crash reporter is started), camera frames, screenshots (dev test harnesses only, never in the app).

## What leaves your computer

Every request goes over HTTPS. Every service you contact sees your IP address, as any website does.

| Service | When | What it receives | Never receives |
| --- | --- | --- | --- |
| **Presage** (SmartSpectra SDK: `cont-api.physiology.presagetech.com`, Amazon Cognito `cognito-idp.us-east-1.amazonaws.com` for sign-in) | Each time the camera starts (calibration, check-in, return check), only after camera consent | Your Presage API key and sign-in, the list of metrics requested (`/metrics/authorize`), a usage count for measurement credits (`/available-usage`, `/v2/sync-usage`), and device pairing/keys if the SDK needs them (`/device/pair`, `/device_keys`). Telemetry (`/v2/telemetry`) only if you chose "Share". | Video or frames (processed on your computer per Presage; we can't fully verify it). Moods, history, songs. Ovra never calls `/insights` (Presage LLM Insights). |
| **Last.fm** (`ws.audioscrobbler.com`) | When a song Ovra hasn't scored yet needs tags. Not behind a consent question today; skipped if no Last.fm key is set or music is off. | Artist and song title (plus Ovra's Last.fm API key) | Vitals, moods, anything about you |
| **OpenRouter** (`openrouter.ai`) and the free AI model it routes to | Only if you said yes to "Can an AI help score your songs?" Batches of up to 50 songs, at most about 20 requests a day. | Song titles, artists and public Last.fm tags (plus Ovra's OpenRouter key) | Vitals, moods, history, anything about you |
| **Spotify embed page** (`open.spotify.com/embed/playlist/<id>`), being added by the music job | When you paste a playlist link, and at session start if that playlist was read over 24 hours ago | The playlist id, with a generic browser User-Agent | Anything about you; Ovra doesn't sign in to Spotify |
| **Spotify app** | Ovra sends it local commands only (see below). Spotify itself talks to its servers as usual. | Songs Ovra plays show up in your Spotify listening history and may shape your recommendations, like any song you play | Vitals, moods |

**SDK telemetry.** The SDK turns telemetry on by default; Ovra always passes `enableTelemetry: false` unless you
chose "Share". Presage says telemetry has no frames and no measured values. The SDK's own type docs add that
reports "can contain free text, paths and platform context, and authenticated requests can correlate them with an
account/device". So with "Share" on, expect diagnostics that may be linkable to the API key's account.

**What we can't confirm yet.** The endpoint list above comes from strings in the SDK's native library, not from
watching traffic. We haven't seen exactly what each request carries. So we say "Ovra never saves or uploads
video", not "nothing leaves your laptop".

## What Ovra does on your computer

- **Camera.** Only inside a session you start, only after you said yes. Check-ins (default) run about 90 seconds
  every 3, 5 or 10 minutes and fully stop the camera in between, so its light goes off. "Whole session" keeps it
  on. A hidden window does the capture; the main window shows a live preview during calibration only. No
  microphone is ever requested (audio requests are refused).
- **Permission prompts (macOS).** Camera, the first time a session uses it. Automation ("Ovra wants to control
  Spotify"), the first time it controls Spotify. Nothing else: no microphone, screen recording, accessibility,
  files, contacts or location.
- **Spotify on macOS** (AppleScript via `osascript`). Checks whether Spotify is running and never launches it.
  During a session with music on: reads the current song every 2 seconds; plays a song or playlist; pause, play,
  next; and for "Calm" can fade Spotify's volume down step by step, then back to where it was (it stops if you
  touch the volume).
- **Spotify on Windows** (PowerShell, not yet tested on a real PC). Reads the current song from Windows' media
  controls; plays by opening a `spotify:` link (which can open Spotify); pause, play, next. If Windows' media
  controls fail, it presses the system media keys, which could reach another player. No volume control.
- **Windows on screen.** The moon orb floats above other windows, on every desktop and over full-screen apps, and
  clicks pass through its empty area. The move card also floats on top. Neither gets its own taskbar entry on Windows.
  The orb's position is saved.
- **Quitting** waits for the camera to stop and history to save (forced exit after a timeout).
- **Not done:** no start at login, no global keyboard shortcuts, no notifications, no menu-bar or tray icon, no
  clipboard access, no auto-updates (no updater code; the build config's update URL is a placeholder), no crash
  reports, no analytics.
- **Installers.** macOS: an unsigned `.dmg` you drag to Applications. Windows (not shipped yet): the installer
  config adds desktop and Start menu shortcuts and an uninstaller entry.

## How to delete each thing

| What | How |
| --- | --- |
| One session | History → delete |
| All session history after a while | Auto-delete (30 days by default) |
| Songs and scores | Music → Clear music library |
| A playlist link | Music → remove |
| Everything Ovra stored + browser files | Privacy → Delete everything |
| API keys file | Delete `.env` in the data folder |
| SDK folder | Delete `~/Library/Caches/Ovra/` with Ovra closed |
| Camera / Spotify permissions | System Settings → Privacy & Security |
| The app | Quit, move Ovra to the Trash, then delete the data folder and the SDK folder |

## Draft: "Consent and Data Handling" (DEV post)

> Draft for Daniel to edit. Wording follows PLAN.md §10 and the sections above. Don't say "nothing leaves your
> laptop".

### Consent and Data Handling

Ovra asks before the camera ever turns on. On first launch you answer each question on its own (there is no
"accept all"), and you can change any answer later on the Privacy screen.

| Question | Options | Default |
| --- | --- | --- |
| Can Ovra use your camera during sessions you start? | Yes / Not now | You must answer |
| How often can it look? | Check-ins every few minutes / The whole session | Check-ins |
| Can it read your face too? | Vitals and face / Vitals only | You must pick |
| Where's your music? | Spotify desktop app / No music | Spotify |
| Can an AI help score your songs? (sends song titles, artists and public tags, never vitals) | Yes / No | No |
| Share anonymous diagnostics with Presage? | Share / Don't share | Don't share |
| Auto-delete old session history? | 30 days / 90 days / Never | 30 days |

Saying "Not now" to the camera still gives you a working app: the timer, music and timed move reminders, just
without sensing. Until you say yes, the camera code doesn't run at all.

**Camera use.** The camera is only used inside a session you started. In check-in mode (the default), Ovra looks
for about 90 seconds every few minutes and fully stops the camera in between, so the camera light goes off.
When the session ends, the camera is off. Ovra never asks for the microphone.

**You can always see it.** Whenever the camera is on, the moon orb shows a ring orbiting it, and it can't be
hidden while the camera runs. Pausing is one click.

**No recording.** Frames go from the camera to the Presage SmartSpectra SDK in memory only. Ovra never saves or
uploads video: no frames, images or clips are written to disk or sent anywhere. The calibration preview is
display-only.

**Face analysis is opt-in.** With "Vitals only", Ovra never asks the SDK for face metrics. With face analysis on,
face landmarks stay inside the capture window; only simple derived values (face present, blinking, talking,
expression scores, head tilt) are used, in memory, during the session.

**What's stored, and where.** Everything Ovra keeps is in one folder on your computer
(`~/Library/Application Support/Ovra/` on a Mac), in five small files only your user account can read. No
accounts, no cloud.

| Stored | Not stored |
| --- | --- |
| Mood labels with timestamps (e.g. "focused at 10:05") | Pulse, breathing or HRV values |
| Moves done or snoozed, session length, longest seated stretch | Expression scores |
| Songs that played, their scores and small learned adjustments ("this song tends to calm you") | Face landmarks |
| Playlist links you pasted, your privacy answers and settings | Your personal baseline (built at calibration, dropped when the session ends) |

The storage code refuses to write any file that contains a raw vital field, and session history is checked
against a strict schema that only allows labels and counts. Electron, which Ovra is built on, also keeps its usual
browser cache files in that folder; Ovra puts nothing personal there. The Presage SDK may create an (on our Mac,
empty) folder in `~/Library/Caches/Ovra/`.

**What leaves your computer.** Ovra never sends vitals, moods or history anywhere.
- *Presage:* the SDK checks your API key and counts usage with Presage's servers each time the camera starts.
- *Last.fm:* artist and song title, to look up public genre tags.
- *OpenRouter (only if you opt in):* song titles, artists and those public tags, so an AI model can guess each
  song's energy and mood. Presage's LLM Insights feature is not used.
- *Spotify:* when you paste a playlist (and at most once a day after that, at session start), Ovra reads its
  public track list from Spotify's website, sending only the playlist id with a generic browser identifier and no
  cookies. Ovra controls the Spotify app on your computer with local commands. Songs it plays appear in your
  Spotify history like any other.

**SDK telemetry.** The SmartSpectra SDK turns telemetry on by default. Ovra always turns it off unless you chose
"Share". Per Presage, telemetry contains no frames and no measured values, but it can include platform details and
be linked to the API key's account.

**What the SDK itself talks to.** Per Presage's docs, metrics are computed on the device; the SDK contacts
Presage's backend to sign in, authorize the requested metrics and count usage. We haven't watched every request
it makes, so we say "Ovra never saves or uploads video" rather than "nothing leaves your laptop".

**Retention.** Session history is deleted automatically after 30 days by default (you can pick 90 days or
never). This runs when the app starts and once a day. Songs, playlists and settings stay until you clear them.

**Deletion.** Delete one session from History, clear the music library from the Music screen, or press Delete
everything on the Privacy screen. Delete everything removes every file Ovra stored, clears Electron's browser
files, and resets the app, so you see the consent questions again.

**Not a medical device.** Ovra offers wellness suggestions ("you seem tense, want to stretch?"). It doesn't
diagnose or treat anything, it doesn't show numbers as medical readings, and it only looks at the person who
started the session.
