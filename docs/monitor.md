# Sensing monitor

Run `npm run dev:monitor` from the checkout that contains your `.env`. The normal app opens alongside an always-on-top **Sensing monitor** window. Give camera consent and start a session as usual; the monitor never starts the camera itself. Clear the dev video source in Settings to use the live camera. In a worktree, point `OVRA_ENV_PATH` at the main checkout's `.env` instead of copying keys. The flag is ignored in packaged builds.

Daniel performs the live run. The monitor changes no sensing, calibration, face, away, session, music or classifier decisions. It records counts and flags in memory and prints them to the terminal. It never displays or logs pulse values (except the coarse per-run median below), breathing rates, HRV values, expression scores or landmarks, and it never saves frames or diagnostic data. Existing consent and telemetry settings still apply.

## The window

The two columns cover the rolling last 10 seconds and the time since the current sensing phase began. The header shows phase, actual SDK `processingStatus`, capture lifecycle status, and the latest raw validation code and hint. Refresh is once a second, including when the window is behind another app.

| Row                                    | Meaning                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw SDK payloads / s                   | SDK `metrics` events received in the capture renderer, before reduction, throttling and merging.                                                                                                                                                                                                                                    |
| Snapshots sent / s                     | Actual `capture:metrics` sends after the throttle/merge, counted in the capture renderer.                                                                                                                                                                                                                                           |
| Validation code counts                 | Every raw SDK validation callback in the window, including repeated codes and codes that did not last long enough to become an app hint.                                                                                                                                                                                            |
| Pulse, breathing, HRV                  | `present % / stable % / mean confidence`. Percentages use **all SDK metrics payloads** as the denominator, not just payloads containing that signal. A payload counts as stable if at least one reading has `stable: true`. Confidence averages all finite reading confidences on the SDK's 0–100 scale; missing confidence is `—`. |
| Face object / landmarks / Ovra present | Payloads containing a face object; at least one non-empty landmark list; and the reduced `face.present` flag (face object seen in the merged send). That flag alone is not presence evidence for the state engine.                                                                                                                  |
| Blink / talk / expressions             | Payloads containing blinking/talking fields (even empty lists) or a non-empty expression-score list. This says nothing about whether blinking or talking was detected, or which expression won.                                                                                                                                     |

Buckets arrive once per second, with a final partial bucket on stop. A rolling boundary can include or exclude up to one batch of observations. Since-phase totals keep constant-size counters; no payload history accumulates during a long continuous session. Before the monitor has been open for 10 seconds, the rolling rate uses the elapsed time shown in its header.

The Ovra state panel reads the engine's existing in-memory buffer without changing it. Stable pulse count and span are the calibration readings **accepted by the state engine**, which can differ from raw SDK presence. The final count/span and baseline failure reason remain visible after calibration. Only the baseline's existence is exposed. Thresholds shown are the actual configured values, including Settings overrides.

`Last face` is time since the engine's last presence evidence: a steady pulse, or plausible landmark-derived face geometry with face consent. A bare face object does not refresh it. The away countdown uses the same `lastFace ?? phaseStart` reference and `awayNoFaceSec` threshold as the engine. It is inactive outside continuous mode, when camera-paused, or while already away. Situation confidence is Ovra's 0–100% confidence, separate from SDK reading confidence. `State updated` is the last `state:updated` event time; seated minutes are read live.

Session status changes include their timestamp, reason and source. Sources distinguish `session:start`, baseline result, break/return, sensing unavailability, `ipc/user`, `length elapsed`, `quit`, and `delete-all`. Music shows the service's existing availability, reported title/artist, target word and Leave-alone flag. It does not query or control Spotify independently.

## Pasteable terminal output

Every five seconds a single `[monitor]` line contains the window's data:

- `last10{…}` and `phaseTotal{…}`: rates, pulse/breath/HRV triples (`present % / stable % / confidence`), six face percentages in the window's row order, and validation counts.
- `calibration=count/needed@span/neededSeconds`, `baseline`, `fail`: engine calibration progress and result. `count` is distinct seconds with a steady pulse (the bar is 30 s, same in demo); the span can't be shorter than the bar, so both show it.
- `lastFace`, `awayIn=countdown/threshold`, `away`, `situation`, `confidence`, `seated`, `updated`: Ovra's current state and last push time. `-` means unavailable or inactive.
- `session`, `remaining`, `change`: current status/time and the last reason/source/timestamp.
- `music`, `track`, `artist`, `target`, `leave`: current music status.

Extra `[monitor]` lines announce phase changes, the app's existing debounced validation changes, baseline results, away/returned, and session status changes. Raw validation counts remain unsmoothed in the regular line and window. Quotes and newlines in hint/track text are escaped so each record stays on one terminal line. No API key or raw measurement is included.

## Padded live frame A/B (reliability §5.6)

Next to the regular line, every five seconds a `[monitor] run phase=… seconds=… code0=…% steadyPulse=…s medianPulse=…` line covers the current sensing phase (one run); a final copy marked `(ended)` prints when the phase changes. `code0` is the share of raw validation callbacks at code 0 (one per frame, so roughly share of time), `steadyPulse` counts one-second buckets with at least one stable pulse reading, and `medianPulse` is the median of stable pulse snapshots, whole bpm. This median is the only measured value the monitor prints; it exists for the A/B, stays in the terminal and is never saved (a whole-bpm histogram in memory, dropped at the next phase).

The shrunk (padded) frame is **on by default** since the live A/B on 2026-11-15 (decision 48: code 0 went from 7–27% to ~75% of frames, and calibration passed): `liveScale: 0.8` in `src/renderer/capture/config.ts`. The capture renderer opens the camera itself and draws it at that scale, padded at the bottom, into the same 1280×720 canvas as the dev video source. Breathing readings are dropped from snapshots while shrunk. To compare against the normal frame, turn it off with the dev override: `RENDERER_VITE_OVRA_LIVE_SCALE=1 npm run dev:monitor` (any other value sets the scale).

A/B steps, from the main checkout (its `.env` is found automatically; in a worktree add `OVRA_ENV_PATH=<main checkout>/.env`). Leave Settings → dev video source empty. Use the same desk, light and seat for both runs, and work normally.

1. **Run A, unpadded:** `RENDERER_VITE_OVRA_LIVE_SCALE=1 npm run dev:monitor`. Start a session in Continuous camera mode. Let calibration finish, then work for 10 min (short variant: 5 min) of the continuous phase. End the session and keep the `[monitor] run phase=continuous … (ended)` line.
2. **Run B, padded (the default):** quit the app (Cmd+Q), then `npm run dev:monitor`. Same session settings and the same length as run A. Keep its `(ended)` line.
3. **Decide:** padding stays on if B's `steadyPulse` is at least 2× A's (compare per minute if the run lengths differ) and B's `medianPulse` is within ±3 bpm of A's. Otherwise set the default `liveScale` back to `1`.

## SDK errors and crash recovery

Every SDK error prints once in the dev terminal (`[sensing] SDK error code=… retryable=… message=…`) and as `[monitor] sdk-error code=… message=…`, with the API key redacted if the SDK ever echoes it. A `kError` processing status shows as code `sdk-status`, and the SDK's own "not in a valid state" dropped-frame log as `frames-refused`.

When the SDK dies (a non-retryable error, `kError`, a failed start, or refused frames), sensing restarts the same stream without ending the phase: `[monitor] sdk=reconnecting reason="…"`, then `sdk=reconnected`. It tries up to 3 times, waiting 1, 3 and 5 s (`restartBackoffMs` in `src/main/sdk/config.ts`); a stream that ran 60 s since its last start gets a fresh set. While reconnecting, nothing counts toward away, no windows are judged, and the orb's why line says "Camera reconnecting" (the calibration hint says the same). When the attempts run out: `sdk-error code=sdk-lost`, the orb says why and the session carries on with the timer, music and break reminders. If any error in that run looked like network or auth (SDK codes 2/5/6, or words like "network", "auth", "usage verification"), the reason is "Couldn't reach Presage. Check your internet or VPN." During calibration the failure screen shows that reason with Try again instead of "0 of 30 s".

In a continuous session the calibration stream keeps running into continuous mode (no `capture=starting` between them), so the pulse warm-up isn't repeated. Check-in sessions still turn the camera off after calibration.

## What to look for

- **Pulse is present but rarely stable:** check camera framing, light and stillness, and compare validation codes with the stability percentage. This is an observation guide, not a classifier fix.
- **Face objects are common while nobody is seated:** the SDK can emit empty face objects. Presence requires a steady pulse or a plausible face box near the calibrated position and size. Code 1 is **no face found** and clears incoming evidence immediately; code 2 is **multiple faces found** and blocks face-only evidence. Away begins after 20 s without evidence in normal continuous mode; waking needs a steady pulse or face evidence in 3 of the last 4 one-second buckets. Compare landmark/pulse counts and the engine's last-face timer; `face.present` alone does not prove presence.
- **Raw payloads arrive but snapshots/s is near zero:** inspect capture status and the throttle/merge path. The normal send cap is configured in `src/renderer/capture/config.ts`.
- **Raw stable pulse is common but accepted calibration count stays low:** compare Ovra present, last face, the steady-seconds bar and the baseline failure reason. Per-window lines say `signal=noread` when a window had under 10 s of steady pulse (holds paused, situation kept).
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

## Live check after the calibration and pill fixes (2026-11-14)

Run for about 5 minutes with the live camera, music on, check-in mode first:

1. **Calibration:** while the SDK asks you to reposition, the moon should not wax and big hints should show. The 90 s window starts once readings are good; it may finish later but stops at 180 s. Expect `baseline` to be set afterwards.
2. **Presence:** sit still, look away or down for a while. `away` should stay off. Leave the frame for 20 s+ in continuous mode; `away` should turn on, then off when you return.
3. **Orb pill:** the song stays visible, with a camera dot (lit on, dim off, paused badge when you pause). A short "camera on / off" note shows for 3 s at each switch. The first three camera turn-ons show a satellite lesson; the fourth stays quiet.
4. Note anything odd with the terminal `[monitor]` line next to it.
