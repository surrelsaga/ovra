# Sensing monitor

Run `npm run dev:monitor` from the checkout that contains your `.env`. The normal app opens alongside an always-on-top **Sensing monitor** window. Give camera consent and start a session as usual; the monitor never starts the camera itself. Clear the dev video source in Settings to use the live camera. In a worktree, point `OVRA_ENV_PATH` at the main checkout's `.env` instead of copying keys. The flag is ignored in packaged builds.

Daniel performs the live run. The monitor changes no sensing, calibration, face, away, session, music or classifier decisions. It records counts and flags in memory and prints them to the terminal. It never displays or logs pulse values, breathing rates, HRV values, expression scores or landmarks, and it never saves frames or diagnostic data. Existing consent and telemetry settings still apply.

## The window

The two columns cover the rolling last 10 seconds and the time since the current sensing phase began. The header shows phase, actual SDK `processingStatus`, capture lifecycle status, and the latest raw validation code and hint. Refresh is once a second, including when the window is behind another app.

| Row                                    | Meaning                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw SDK payloads / s                   | SDK `metrics` events received in the capture renderer, before reduction, throttling and merging.                                                                                                                                                                                                                                    |
| Snapshots sent / s                     | Actual `capture:metrics` sends after the throttle/merge, counted in the capture renderer.                                                                                                                                                                                                                                           |
| Validation code counts                 | Every raw SDK validation callback in the window, including repeated codes and codes that did not last long enough to become an app hint.                                                                                                                                                                                            |
| Pulse, breathing, HRV                  | `present % / stable % / mean confidence`. Percentages use **all SDK metrics payloads** as the denominator, not just payloads containing that signal. A payload counts as stable if at least one reading has `stable: true`. Confidence averages all finite reading confidences on the SDK's 0–100 scale; missing confidence is `—`. |
| Face object / landmarks / Ovra present | Payloads containing a face object; at least one non-empty landmark list; and the reduced `face.present` flag used by Ovra. Only presence is retained.                                                                                                                                                                               |
| Blink / talk / expressions             | Payloads containing blinking/talking fields (even empty lists) or a non-empty expression-score list. This says nothing about whether blinking or talking was detected, or which expression won.                                                                                                                                     |

Buckets arrive once per second, with a final partial bucket on stop. A rolling boundary can include or exclude up to one batch of observations. Since-phase totals keep constant-size counters; no payload history accumulates during a long continuous session. Before the monitor has been open for 10 seconds, the rolling rate uses the elapsed time shown in its header.

The Ovra state panel reads the engine's existing in-memory buffer without changing it. Stable pulse count and span are the calibration readings **accepted by the state engine**, which can differ from raw SDK presence. The final count/span and baseline failure reason remain visible after calibration. Only the baseline's existence is exposed. Thresholds shown are the actual configured values, including Settings overrides.

`Last face` is time since the engine's `lastFace`, not time since any raw face object. The away countdown uses the same `lastFace ?? phaseStart` reference and `awayNoFaceSec` threshold as the engine. It is inactive outside continuous mode, when camera-paused, or while already away. Situation confidence is Ovra's 0–100% confidence, separate from SDK reading confidence. `State updated` is the last `state:updated` event time; seated minutes are read live.

Session status changes include their timestamp, reason and source. Sources distinguish `session:start`, baseline result, break/return, sensing unavailability, `ipc/user`, `length elapsed`, `quit`, and `delete-all`. Music shows the service's existing availability, reported title/artist, target word and Leave-alone flag. It does not query or control Spotify independently.

## Pasteable terminal output

Every five seconds a single `[monitor]` line contains the window's data:

- `last10{…}` and `phaseTotal{…}`: rates, pulse/breath/HRV triples (`present % / stable % / confidence`), six face percentages in the window's row order, and validation counts.
- `calibration=count/needed@span/neededSeconds`, `baseline`, `fail`: engine calibration progress and result.
- `lastFace`, `awayIn=countdown/threshold`, `away`, `situation`, `confidence`, `seated`, `updated`: Ovra's current state and last push time. `-` means unavailable or inactive.
- `session`, `remaining`, `change`: current status/time and the last reason/source/timestamp.
- `music`, `track`, `artist`, `target`, `leave`: current music status.

Extra `[monitor]` lines announce phase changes, the app's existing debounced validation changes, baseline results, away/returned, and session status changes. Raw validation counts remain unsmoothed in the regular line and window. Quotes and newlines in hint/track text are escaped so each record stays on one terminal line. No API key or raw measurement is included.

## What to look for

- **Pulse is present but rarely stable:** check camera framing, light and stillness, and compare validation codes with the stability percentage. This is an observation guide, not a classifier fix.
- **Face object is common but landmarks and Ovra present are rare:** compare this with the engine's last-face timer. A face object alone currently does not make `face.present` true. This can explain a failed baseline or away detection while someone is still sitting in view.
- **Raw payloads arrive but snapshots/s is near zero:** inspect capture status and the throttle/merge path. The normal send cap is configured in `src/renderer/capture/config.ts`.
- **Raw stable pulse is common but accepted calibration count stays low:** compare Ovra present, last face, the configured count/span requirements and the baseline failure reason.
- **No payloads and repeated validation 7:** follow the chest-in-view hint. The SDK can withhold metrics until framing passes its check.
- **Unknown after calibration:** inspect baseline success first. The monitor does not substitute a baseline or change the classifier.
- **No song in the orb:** compare music available, track/artist, target and Leave-alone here. The monitor only shows what the existing music service reports.
- **Session unexpectedly ends:** keep the `session=ended` line with its source. It distinguishes user/IPC, timer expiry, quit and delete-all.

## Verification without the SDK

Run the fake-event harness:

```sh
OVRA_MONITOR=1 OVRA_HARNESS=monitor OVRA_ENV_PATH=/tmp/ovra-monitor-no-env npm run dev
```

It uses synthetic metrics and the real state/session engines, with mock sensing, music and moves. It never imports the SmartSpectra SDK or constructs a Spotify controller. It isolates Electron userData/sessionData in a temporary directory, keeps session data in memory, and uses music `none`. It exercises failed calibration, raw face object versus reduced presence, continuous away/returned, rates, phase totals and terminal records. It saves two screenshots outside the repo, prints their paths, and quits its own app.

Unit tests cover counter aggregation/expiry, raw-field counting, session end sources, unchanged capture throttle/merge output and unchanged state output with the diagnostic getter in use. A live camera session and SDK-specific timing still need Daniel.
