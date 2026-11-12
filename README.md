# Ovra

Ovra is a macOS desktop companion for timed work and downtime sessions. A small moon orb reflects how your session is going, optional camera check-ins or continuous sensing inform gentle music and break suggestions, and a separate move card guides short movements and a return check. Session history stays in the app’s local data folder. **Ovra is a wellness app, not a medical device; it does not diagnose or treat health conditions.**

- **Moon orb:** shows session state and camera activity.
- **Check-ins or continuous sensing:** check-ins are the default; continuous camera use is opt-in.
- **Spotify that fits your session:** tunes are selected from your library based on how you’re doing.
- **Guided moves:** the move card shows one step at a time.
- **Return check:** see how you feel after a break.
- **Local history:** review session summaries and delete them when you choose.

## Requirements

- macOS on Apple Silicon
- Node.js 20 or newer (Node 24 LTS recommended) and npm
- Spotify desktop app (a free account works)
- Presage SmartSpectra API key
- Optional Last.fm API key for public artist tags
- Optional OpenRouter API key for AI-assisted song scoring; only song titles, artists, and public tags are sent. Vitals and moods are never sent. AI scoring is off unless you opt in.

## Run from source

```sh
git clone https://github.com/surrelsaga/ovra.git
cd ovra
npm ci
cp .env.example .env
```

Add your `PRESAGE_API_KEY` to `.env`. Add `LASTFM_API_KEY` and/or `OPENROUTER_API_KEY` if you want those optional scoring sources. Keep `.env` private; it is ignored by git. Then start the app:

```sh
npm run dev
```

On first use, macOS asks you to allow camera access if you choose to use sensing. When Ovra first controls Spotify, macOS may ask for Automation permission. The app does not launch Spotify if it is not already running.

## Packaged app

See [packaging instructions](docs/packaging.md).

## How it works

Ovra uses Electron, TypeScript, and React. The main process owns session timing, state interpretation, music selection and scoring, privacy, storage, and the event bus. React renderers provide the main window, moon orb, and move card; a hidden capture renderer passes camera frames to the SmartSpectra SDK only after camera consent. Typed events connect the main process and windows. Spotify control is isolated in the macOS music controller.

## Privacy and data handling

Consent is asked one question at a time before camera code can run, and can be changed later in Privacy settings. You choose whether to allow camera use, check-ins or continuous mode, face metrics or vitals only, Spotify or no music, optional AI song scoring, anonymous Presage diagnostics, and session-history retention. Camera use is limited to sessions you start. In check-in mode, it runs for about 90 seconds every few minutes and stops between check-ins. The orb indicates when sensing is active, and you can pause it.

**The app never saves or uploads video.** Camera frames are processed in memory. With “Vitals only,” face metrics are not requested; with face analysis enabled, derived face signals are used in memory during the session. Ovra does not store raw pulse, breathing, or HRV values, expression scores, face landmarks, or the session baseline. Local history contains mood labels and timestamps, moves, and session summaries; song scores and settings are also stored locally.

**Ovra is not a medical device.** It provides wellness suggestions only, not diagnoses or treatment advice.

- SmartSpectra telemetry is off by default in Ovra (the SDK default is on); you may opt in to anonymous diagnostics.
- If you opt into AI scoring, OpenRouter receives song titles, artists, and public tags only. Presage LLM Insights is not used.
- Session history is auto-deleted after 30 days by default; you can choose 90 days or never. Delete individual sessions, clear the music library, or delete all app data in Privacy settings.
- Spotify receives playback commands on your Mac. Song scores and learned adjustments stay local.

For details, see [privacy notes](docs/privacy.md).

## Development

```sh
npm run ci                 # typecheck, lint, and unit tests
npm test                   # Vitest unit tests
npm run harness:shell      # shell harness
npm run harness:moves      # move-card harness
npm run harness:sensing    # sensing harness — uses Presage credits
npm run harness:e2e        # end-to-end harness — uses Presage credits
```

Most logic is checked with Vitest and mocks. **Sensing and end-to-end harnesses start the SmartSpectra SDK and consume Presage credits.** Do not run them casually. The harnesses use dev video files where configured; the standard app requires camera permission only after consent.

## Known limitations

- Breathing measurements need shoulders and chest in view and may be unavailable at normal laptop framing.
- State and movement thresholds need personal tuning.
- Last.fm track tags were empty in testing; artist tags are used instead.
- OpenRouter web search is not included; it is a paid add-on.
- Calibration shows progress and SDK hints, but has no live camera preview.
- Windows is not supported yet; this MVP targets macOS Apple Silicon.
- Shipped fallback playlist links are placeholders and need real public Spotify playlists before that fallback can work.

## License

TBD
