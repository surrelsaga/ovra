# Progress

## Phase 0: spike — done (2026-11-12)

- **Works:** SDK pulse, HRV and face metrics from the test videos. Dev video source via canvas
  `captureStream()` → `useMediaStream()` in a hidden Electron window. Spotify play/read/skip/ad detection by
  AppleScript on a free account. Last.fm artist tags. OpenRouter free models with strict JSON.
- **Doesn't work / changed:** the SDK emits nothing until it sees the chest. The test videos need a framing pad,
  and breathing rate never shows up at this framing (now optional everywhere). Last.fm track tags are empty
  (we use artist tags). OpenRouter web search is paid (dropped). `useFile()` doesn't work with these videos.
- **Needs Daniel:** see the list at the bottom of `docs/spike-notes.md` and the final summary. Most useful now:
  re-record one or two test videos sitting back with shoulders and chest in view, so breathing can be tested.

## Phase 1: contracts — done (2026-11-12)

- `src/shared/types.ts`: all shared types, bus events, IPC channels, service interfaces.
- Typed bus, IPC helpers, preload bridges (main windows + capture window with the SDK bridge), multi-window
  electron-vite config (main window, orb, move card, hidden capture), dark theme tokens, module stubs with
  factory signatures, dev harness hooks, Vitest + `npm run ci`.
- All dependencies installed up front. `docs/ownership.md` says who owns what.
- **Stubbed:** every module (Phase 2).

## Phase 2: parallel build — started (2026-11-12)

Six Claude Code workers via Orca (run `run_e94a5d3d429a`), each in its own worktree under
`~/orca/workspaces/ovra/` and branch off main `b814591`:

| Agent | Branch | Dispatch |
| --- | --- | --- |
| A. Sensing | feat/sensing | ctx_2c2520d64481 |
| B. State + session | feat/state | ctx_2bd3ef5b8428 |
| C. Music | feat/music | ctx_bf1239978b8f |
| D. Moves | feat/moves | ctx_046fd6134722 |
| E. Orb + shell | feat/shell | ctx_add8dec41d2f |
| F. Privacy + storage | feat/privacy | ctx_0118162b82a0 |

### Merged
- **F. Privacy + storage** → main `25247c1` (40 tests). Notes for Phase 3: changing camera consent mid-session must
  stop sensing (listen to `privacy:changed`); the storage guard matches exact key names; `docs/privacy.md` has the
  DEV "Consent and Data Handling" draft for Daniel to edit.
- **B. State engine + session** → main `dfeb683` (38 module tests, 78 total). Expected on test videos: calm →
  focused; tense and low-energy probably also focused (vitals barely differ in the acted clips) until Daniel tunes
  thresholds live. Crashing via "pulse +20 % + negative face" needs tense already held (smoothing). Baevsky is in the
  baseline but not used by rules yet.
- **C. Music** → main `bdc9875` (58 module tests, 136 total). Real Spotify check passed (play by URI, read
  position, next, pause); 1 real OpenRouter batch returned valid scores. Stubbed: Settle switches early without a
  fade (no volume read in the interface); LLM daily cap is in memory. **Needs Daniel:** real public playlist links in
  `FALLBACK_PLAYLISTS` (`src/main/music/config.ts`). Report: `docs/music.md`.
- **D. Moves** → main `142fbb5` (35 module tests, 171 total). Harness re-run by the orchestrator: every move end to end,
  `HARNESS OK`, 26 screenshots reviewed (dark card, line figures, live feedback, break timer, return results).
  **Needs Daniel:** tune tilt (20°), breathing-drop (10 %) and stand-up thresholds in `src/main/moves/config.ts` live.
- **E. Orb + shell**: reviewed (31 harness screenshots: dark sidebar app, one-question onboarding, new session,
  music, history, privacy, settings, calibration, summary; orb in every state). Sent back for 3 fixes before merge:
  orb click-through on transparent areas, shared camera-paused state (`OrbView.paused`, added on main `787a68b`),
  stable onboarding question count.
- **E. Orb + shell** → main `226c5ac` after fixes (16 module tests, 187 total; build OK). Click-through on the orb's
  transparent area, shared paused state with a "Camera paused" chip, stable 1–7 onboarding count. Calibration live
  preview skipped (the camera lives in the hidden capture window) — integration item.
- **A. Sensing** → main `90502ed` (finished and reviewed by a Codex worker after the original worker's terminal
  closed). Pulse on all five test videos; stream stopped after every phase; 214 tests total. Open: the native SDK
  (koffi) crashes during app quit after a run — Phase 3 must add proper quit handling. stretch.mp4 gives pulse only
  during calibration (too much movement).

**Phase 2 done (2026-11-12).** All six modules merged. Needs Daniel: live camera acceptance run, threshold tuning
(state + moves configs), fallback playlist links.

## Phase 3: integration — merged (2026-11-13)

Main `8f1f76b`. Full app wired; `npm run harness:e2e` drives the real app end to end (see `docs/integration.md`).
233 tests, typecheck, lint and build pass. 6 of 7 runs passed (stretch, tense, low-energy, leave-and-return in
check-in and continuous mode, camera declined); every userData scan clean of raw vitals. Fixed: quit crash guard,
consent revocation mid-session, terminal SDK errors (falls back to timer + timed nudges), continuous-mode breaks,
face/telemetry consent changes restart capture, nudges during calibration, music cache after delete-all.

- **Blocked:** Presage credits exhausted (HTTP 402). Pending: calm-working rerun and quit-during-capture proof.
- **Stubbed / omitted:** calibration live preview; Settle fade; OpenRouter web search.
- **Needs Daniel:** renew Presage credits; live camera test; threshold tuning (`src/main/state/config.ts`,
  `src/main/moves/config.ts`); real links in `FALLBACK_PLAYLISTS` (`src/main/music/config.ts`); macOS camera and
  Spotify Automation prompts on first run; review `docs/privacy.md` (DEV consent section); demo video and DEV post.
