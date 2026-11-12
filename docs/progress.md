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
