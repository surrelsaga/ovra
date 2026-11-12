# Privacy module notes and DEV post draft

Owner: Agent F (`src/main/privacy/`, `src/main/storage/`).

## How the code enforces it

- **Storage** (`src/main/storage/`) writes only five files in `userData`: `privacy.json`, `settings.json`,
  `sessions.json`, `songs.json`, `playlists.json`. Any other name is refused. Writes are atomic (temp file, then
  rename) and run one at a time per file. A corrupt file is kept as `<name>.json.corrupt` and the app starts
  from defaults.
- **Raw data guard:** before anything touches disk, storage refuses JSON that contains a raw-vitals key at any
  depth: `pulse`, `pulseRate`, `heartRate`, `bpm`, `breathing`, `breathingRate`, `hrv`, `rmssd`, `sdnn`, `meanNn`,
  `baevsky`, `landmarks`, `expression(s)`, `baseline`, `blinkRate`, `headRollDeg`, `metrics` (any case).
  `confidence` is allowed only in `songs.json` (song score confidence). Matching is on exact key names, so state
  threshold names such as `tensePulsePct` in settings still work.
- **History records** are checked with a strict schema: a session record with any field beyond labels and
  counts (mood timeline, moves, snoozes, longest seated time, learned song ids) is rejected, not trimmed.
- **Consent gate:** `canUseCamera()` is true only after "Yes" to the camera question. Sensing calls
  `assertCameraConsent()` before any camera code and it throws otherwise. `canUseFace()` also needs
  "Vitals and face".
- **Delete everything** removes every stored file (including `.corrupt` copies) and resets privacy and
  settings to defaults, so onboarding shows again. It then emits `privacy:changed` and
  `data:deleted-all` so modules holding stored data in memory (music) drop it.
- **Auto-delete** removes sessions that ended more than 30 or 90 days ago (or none with "Never"). It runs on
  app start and daily (`src/main/app.ts`). Song scores and settings are kept until the user clears them.

## Draft: "Consent and Data Handling" (DEV post)

> Draft for Daniel to edit. Wording follows PLAN.md §10. Don't say "nothing leaves your laptop" until Presage
> confirms what the SDK sends (see the last part).

### Consent and Data Handling

Ovra asks before the camera ever turns on. On first launch you answer each question on its own (there is no
"accept all"), and you can change any answer later in Settings → Privacy.

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
When the session ends, the camera is off.

**You can always see it.** Whenever the camera is on, the moon orb shows a ring orbiting it, and it can't be
hidden while the camera runs. Pausing is one click.

**No recording.** Frames go from the camera to the Presage SmartSpectra SDK in memory only. The app never saves
or uploads video: no frames, images or clips are written to disk or sent anywhere. The calibration preview is
display-only.

**Face analysis is opt-in.** With "Vitals only", Ovra never asks the SDK for face metrics. With face analysis on,
face landmarks stay inside the capture window; only simple derived values (face present, blinking, talking,
expression scores, head tilt) are used, in memory, during the session.

**What's stored, and where.** Everything is stored locally in the app's own data folder. No accounts, no cloud.

| Stored | Not stored |
| --- | --- |
| Mood labels with timestamps (e.g. "focused at 10:05") | Pulse, breathing or HRV values |
| Moves done or snoozed, session length, longest seated stretch | Expression scores |
| Song scores and small learned adjustments ("this song tends to calm you") | Face landmarks |
| Your privacy answers and settings | Your personal baseline (built at calibration, dropped when the session ends) |

This isn't just a promise in the docs: the storage code refuses to write any file that contains a raw vital
field, and session history is checked against a strict schema that only allows labels and counts.

**Sharing.** Nothing is shared by default. Spotify only receives play commands on the same machine. "This song
calms you" stays on your computer.

**Optional AI use.** If you opt in, Ovra sends song titles, artists and public Last.fm tags to a language model
(through OpenRouter) to guess each song's energy and mood. It never sends vitals or moods. Presage's LLM Insights
feature is not used.

**SDK telemetry.** The SmartSpectra SDK turns telemetry on by default. Ovra always turns it off
(`enableTelemetry: false`) unless you chose "Share" on the diagnostics question. Per Presage, telemetry contains
no frames, no measured values and no user or device IDs.

**What the SDK itself talks to.** Per Presage's docs, metrics are computed on the device, and the SDK contacts
Presage's backend to check the API key. The SDK's log also shows it downloads its model from Presage when no
local model path is set. We haven't seen a full list of the SDK's network requests yet, so we say "the app never saves
or uploads video" rather than "nothing leaves your laptop".

**Retention.** Session history is deleted automatically after 30 days by default (you can pick 90 days or
never). This runs when the app starts and once a day. Song scores and settings stay until you clear them.

**Deletion.** Delete one session from History, clear the music library from the Music screen, or delete
everything from Settings → Privacy in one click. Delete everything removes every file Ovra stored and resets
the app, so you see the consent questions again.

**Not a medical device.** Ovra offers wellness suggestions ("you seem tense, want to stretch?"). It doesn't
diagnose or treat anything, it doesn't show numbers as medical readings, and it only looks at the person who
started the session.
