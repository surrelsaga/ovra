# Phase 3 integration

Branch: `feat/integration`. Test media is read directly from
`/Users/nguyenducanh/Desktop/ovra/test-media/`; Daniel renamed the four `.mp4.mov` files to `.mp4`
during integration. No media or environment files were copied into this worktree.

## Running the end-to-end harness

```sh
OVRA_ENV_PATH=/Users/nguyenducanh/Desktop/ovra/.env \
OVRA_TEST_MEDIA=/Users/nguyenducanh/Desktop/ovra/test-media \
OVRA_DEV_VIDEO=/Users/nguyenducanh/Desktop/ovra/test-media/calm-working.mp4 \
npm run harness:e2e
```

`OVRA_E2E_MODE` is `checkins` (default), `continuous`, or `declined`.
`OVRA_E2E_QUIT_ACTIVE=1` additionally quits from an active video capture to exercise the quit guard.
Tests load the real main, orb, move-card, capture, privacy, storage, state, session, music and moves
modules. The windows stay in the background so these unattended runs do not take desktop focus.

Before Electron is ready, the harness gives both userData and Chromium sessionData new temporary
paths. It presets consent and the absolute dev video path, with music `none`, AI scoring off and
telemetry off. No live camera is used. Test-only timing and state/move overrides live in
`src/main/e2e/config.ts`; shipped defaults are unchanged.

The renderer IPC bridge drives onboarding completion, session start, nudge acceptance, pause/resume,
manual break/return, face/camera consent revocation, end, history and deletion during a second active
session. The continuous run also waits for genuine video-driven automatic away/return. Assertions
cover baseline creation, paired capture events, two check-ins, listening/paused orb state (including
an orb renderer reload), capture shutdown, valid persisted history, and deletion without resurrection.
Every regular file under temporary userData, including Chromium caches, is scanned for raw vital or
face fields. The harness prints one summary line and exits nonzero on failure.

## Run results

Six of the seven latest primary runs passed. The latest calm retry failed only when Presage returned
SDK code 4, "SmartSpectra measurement credits have been exhausted", with HTTP 402 "Insufficient
credits"; no further sensing runs were made after that response, as agreed with the coordinator.

- checkins · `stretch.mp4` · phases: calibration,checkin,checkin,return-check,checkin · situations: focused · nudges/moves: 1/1 · manual break/return: passed; label not logged in this earlier summary; automatic away/return: 0/0 · record: saved and valid · raw scan: clean · camera: stopped · exit: 0.
- checkins · `tense.mp4` · phases: calibration,checkin,checkin,return-check,checkin · situations: focused · nudges/moves: 1/1 · manual break/return: passed; label not logged in this earlier summary; automatic away/return: 0/0 · record: saved and valid · raw scan: clean · camera: stopped · exit: 0.
- checkins · `low-energy.mp4` · phases: calibration,checkin,checkin,return-check,checkin · situations: focused · nudges/moves: 1/1 · manual break/return: passed; label not logged in this earlier summary; automatic away/return: 0/0 · record: saved and valid · raw scan: clean · camera: stopped · exit: 0.
- checkins · `leave-and-return.mp4` · phases: calibration,checkin,checkin,return-check,checkin · situations: focused · nudges/moves: 1/1 · manual break/return: calmer; automatic away/return: 0/0 · record: saved and valid · raw scan: clean · camera: stopped · exit: 0.
- continuous · `leave-and-return.mp4` · phases: calibration,continuous,return-check,continuous,continuous,return-check,continuous · situations: focused · nudges/moves: 2/1 · manual break/return: calmer; automatic away/return: 1/1 · record: saved and valid · raw scan: clean · camera: stopped · exit: 0.
- checkins · `calm-working.mp4` · calibration → check-in → second check-in started, then SDK credits error · situations: focused · nudges: not logged / moves completed: 0 · manual break/return: not reached · record: valid, saved by failure cleanup · raw scan: clean after exit · camera: stopped by awaited cleanup · exit: 1 (SDK code 4 / HTTP 402).
- declined · `calm-working.mp4` · phases: timer · situations: none · nudges/moves: 1/1 · manual break/return: unknown; automatic away/return: 0/0 · record: saved and valid · raw scan: clean · camera: stopped · exit: 0.

All regular files were scanned again after each process exited: 55 files for each of the five passing
sensing runs, 56 for the blocked calm retry, and 144 for the camera-declined dev-server run; all scans
were clean. The failed calm run still saved a schema-valid record during awaited failure cleanup,
then exited 1 without a native quit crash. The successful runs assert a saved record before testing
Delete everything, which intentionally removes that record during their second timer-only session.

An earlier full calm-working run also passed calibration, two check-ins, move/break/return, end,
history, deletion, storage scanning and normal exit 0. It predates the final changes and does not
replace the pending calm repeat and active-capture quit proof on the final implementation.
The first three primary runs logged return-check completion but not its result label; later summaries
include the result label explicitly. All five passing video runs produced a real baseline.

The declined run used `OVRA_HARNESS=e2e OVRA_E2E_MODE=declined npm run dev`: zero SDK metrics and zero
capture starts, with timed nudge/move, return result `unknown`, history, and deletion working.

## Bugs fixed

- Quit could outlive native SDK teardown: `before-quit` now defers exit until session saving, stream
  stop, capture-window destruction and outstanding N-API work complete; a configured deadline forces
  a nonzero exit rather than hanging forever.
- Stopping sensing returned before the capture window closed or its native tasks finished.
- A cancelled start emitted an unmatched phase-ended event and could prematurely finish calibration
  or a return check; superseded starts now leave the actual capture's events intact.
- Camera consent revocation did not stop an active session's sensing or switch moves to timed nudges.
  Late media permission requests are also denied after revocation.
- Terminal SDK failures (including exhausted credits) left the session trying sensing again; they now
  stop sensing/scheduling, drop the baseline and keep the timer and timed move nudges running.
- Face consent changes now restart active capture with the permitted metric bundle, immediately
  filter in-flight face data, and drop face-derived buffers/baseline values and move references. Telemetry opt-out also restarts the
  active native session with telemetry disabled.
- Continuous away/return never entered the session's break/return-check flow; both manual and
  automatic breaks now return to the configured sensing schedule.
- Nudges could appear during calibration; they now wait for a running session.
- A new session could inherit the prior session's camera pause; startup now clears that session pause.
- Delete-everything during an active or ending session could save history again after deletion; a
  deletion generation now discards the pending record and cancels the active session. History also
  remembers that the camera was used when consent is revoked before the session ends.
- Deletion also stops music selection, forgets its library/queue and clears stale now-playing state.
  In-flight Spotify availability checks, library loads and session starts cannot restore deleted music
  or issue a play after deletion or music opt-out.
- Window pushes could arrive before React subscribed, or be lost on renderer reload; the window layer
  replays its snapshot and the preload replays early pushes to late subscribers.
- Settings changes were never pushed to other windows; they now broadcast current settings.
- The orb now remains available as the camera indicator during calibration.
- Reopening from the dock now shows the existing main window without registering duplicate services.

## Remaining limits and Daniel's checks

- Calibration preview was deliberately left out: adding another consumer of camera frames late in
  integration would expand the capture/privacy surface. Calibration still shows live progress/hints.
- The SDK's public Electron binding has no awaited destroy operation. The quit barrier uses supported
  Node `async_hooks` to observe Koffi's N-API `generic` work completions, rather than a fixed delay or
  edits to the SDK. Recheck this resource name on SDK/Koffi upgrades, and replace the observer if
  Presage exposes an awaited bridge teardown. A truly hung native operation reaches the quit timeout.
- These acted clips do not reliably change physiology; observed situations are reported as measured,
  without changing shipped classifier thresholds to force their filenames' moods.
- Real camera acceptance, state/move threshold tuning and fuller chest framing still need Daniel.
- Real Spotify was not used in these seven runs; its unavailable/disabled paths and orb forwarding are
  covered by tests. Daniel still needs to supply valid fallback playlist links and approve Electron's
  Spotify Automation prompt when testing music.
- No OpenRouter calls, SDK Insights, frame/video recording, or new dependencies were introduced.

## Validation and final revision

Final implementation SHA: `1061bb640c607f479c17bbc78680fe095d726669` (the following documentation-only
commit adds this report). Branch was rebased with `git rebase main`; it was already current with
main `8127483`. Nothing was merged or pushed.

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npx vitest run`: 233 tests passed in 23 files.
- `npx electron-vite build`: passed.
- Post-exit scans of all seven temporary userData directories: clean.
- No test app or test-runner process remains running.

## Pending Daniel: restore measurement credits, then run only the remaining proof

The final calm retry and quitting while native capture is active remain unverified because the SDK
quota is exhausted. Normal post-session quit completed without a native crash on all passing runs;
the quit guard and native-work drain are covered by unit tests. The new terminal-SDK-error fallback
was unit-tested with code 4; the no-camera app flow was tested after that change, without requesting
more measurements.

After restoring credits, this single run covers the calm repeat and active-capture quit proof:

```sh
OVRA_ENV_PATH=/Users/nguyenducanh/Desktop/ovra/.env \
OVRA_TEST_MEDIA=/Users/nguyenducanh/Desktop/ovra/test-media \
OVRA_DEV_VIDEO=/Users/nguyenducanh/Desktop/ovra/test-media/calm-working.mp4 \
OVRA_E2E_QUIT_ACTIVE=1 npm run harness:e2e
```

Daniel's live-camera acceptance, threshold tuning and fallback playlist links remain the other
manual follow-ups. Calibration preview remains intentionally omitted.
