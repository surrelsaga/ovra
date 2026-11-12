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
