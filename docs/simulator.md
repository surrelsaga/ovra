# Dev sensing simulator

Run `npm run dev:simulate`. The small **SIMULATED — no camera** panel replaces sensing with
synthetic readings. The real state engine, sessions, moves and music service run; the SmartSpectra
SDK is never loaded, no camera opens, and no Presage credits are used. Packaged builds ignore
`OVRA_SIMULATE`.

**Music uses the real Spotify desktop app if you enable it.** The simulator never launches Spotify.
For a sensing-only walkthrough, start a session with music off. Automated checks use mocks only.

## Quick walkthrough

1. Complete consent as usual. Camera consent is still required for synthetic sensing. Choose
   **Vitals and face** to try Good mood, angry-face support for Very stressed, blinks and move feedback.
2. Start a session. Simulator sessions default to **The whole session** (continuous), in memory only.
   You can still choose **Check-ins** on the session form. Stored preferences and shipped defaults
   stay unchanged.
3. Leave speed on **Instant**. Calibration always receives Steady readings, regardless of the selected
   scenario, and takes about five seconds. Then pick **Stressed** or **Tired**: the current mood
   normally changes within five to ten seconds.
4. **What the app decided** shows the current mood, confidence, sensing phase, exact music target
   and last break reminder. **Building toward** uses the engine's actual hold progress, for example
   “Stressed in ~4 s”. A low-signal window pauses progress; this is an estimate, not a promise.
5. Try **Tilt left**, **Tilt right**, **Stand up**, or **Breathing slows** during a guided move. Actions
   last about eight seconds and only register while a sensing phase is active.
6. **Switch music now** asks the existing music service to play its pick for the current target,
   without waiting for the song to end. Spotify must already be open, session music enabled and
   “Leave my music alone” off. Breaks and other playback guards still apply. In **Instant**, a target
   change is heard at once (demo's switch-now: silent skips to a fitting song), so the button is rarely
   needed after a scenario change. In Fast and Normal a target change waits for the track boundary
   (except Quiet's early fade).

Scenario identifiers remain `calm`, `good`, `tense`, `crashing`, `low`, `away`; visible names are
**Steady, Good mood, Stressed, Very stressed, Tired, Away**. Panel labels and `[sim]` mood/music
logs use the current app wording.

## Speeds

All simulator values live in `src/main/simulator/config.ts`. Instant and Fast shorten time-based
waits only; pulse, HRV and expression thresholds still come from the real engine.

| Wait                                 | Instant (default) | Fast           | Normal                                           |
| ------------------------------------ | ----------------- | -------------- | ------------------------------------------------ |
| Calibration                          | 5 s               | 10 s           | 35 s synthetic phase, real 30 s steady-pulse bar |
| Continuous window / update           | 5 s / 1 s         | 20 s / 3 s     | 60 s / 30 s                                      |
| Minimum steady pulse per window      | 3 s               | 5 s            | 10 s                                             |
| Minimum face time for Good mood      | 3 s               | 5 s            | 10 s                                             |
| Stressed / Tired hold                | 5 s               | 15 s           | 3 min / 2 min                                    |
| Stressed becomes Very stressed       | 30 s              | 3 min          | 10 min                                           |
| Automatic Away                       | 5 s               | 8 s            | 20 s                                             |
| Check-in duration / start interval   | 5 s / 10 s        | 15 s / 30 s    | 90 s / chosen 3, 5 or 10 min                     |
| Return check                         | 5 s               | 10 s           | 30 s                                             |
| Minimum reminder interval            | 10 s              | 30 s           | your setting (default 20 min)                    |
| Seated neck / stand / walk reminders | 30 / 60 / 90 s    | 3 / 6 / 10 min | 45 / 60 / 90 min                                 |
| Music target gap                     | 5 s               | 15 s           | 3 min                                            |
| Move step maximum                    | 5 s               | 15 s           | original move lengths                            |

Check-in holds need one qualifying check-in in Instant/Fast. With Check-ins selected, readings stop
between phases: scenario changes wait until a check-in runs and ends. The panel reports qualifying
check-ins rather than an inaccurate seconds countdown. Automatic Away needs continuous mode; check-in
breaks still use **Okay, going / I'm back**.

Speed changes update the in-memory thresholds, reminders, move definitions and music gap immediately.
Sensing phase lengths and check-in scheduling take effect on the next phase or session. Normal
restores the user's original threshold overrides and reminder interval. Existing moves keep their
already-started step timer. If Demo hints are enabled for the session, the simulator's selected speed
still owns the waits.

## Synthetic signals and safety

- Stressed: pulse about +20%, RMSSD −25%; clears the current +15% pulse-only bar as well as the
  +10% HRV-backed bar. Very stressed: pulse about +25%, RMSSD −25%, angry expression support.
- Tired: pulse about −12%, slower breathing and more blinks; clears the −8% pulse bar. Good mood:
  near-baseline pulse and happy expression support. Face consent is still required for face support.
- Steady calibration stays calm even if another scenario is selected. The baseline and readings live
  only in memory. No synthetic readings or raw vitals are saved or sent to a service.
- The missing dev video path `/ovra-simulator-no-camera` prevents the calibration preview from opening
  a live camera. Its “preview isn't available” message is expected. This path is an in-memory overlay.
- Speed selection broadcasts settings to the windows without calling the settings writer. Neither
  simulator thresholds nor its continuous default are saved. Legacy simulator values left by older
  versions are still cleaned up by the existing startup migration.

## Mock verification

The simulator tests drive these synthetic readings through the real state engine with fake timers,
including all six Instant scenarios within ten seconds, calm calibration, consent, face opt-out,
Stressed escalation, labels and hold countdowns. Panel tests mock the bridge; music tests mock the
controller and verify immediate switching and closed-Spotify/leave-alone guards. No SDK, camera or
real Spotify is needed for the checks.
