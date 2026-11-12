# Phase 0 spike notes

Date: 2026-11-12. Machine: macOS (Apple Silicon), Node 24.15, Electron 44, `@smartspectra/node-sdk` 3.5.0,
Spotify desktop 1.3.6 (free account).

Spike scripts live in `spike/`. They are throwaway and not part of the app.

## Summary

| Question (PLAN.md §13) | Answer |
| --- | --- |
| 1. Dev video source (`captureStream` → `useMediaStream`) | **Works**, with one framing fix (below). |
| 2. How `validationStatus` reports "no face" | Not reliably as `kNoFaceFound`. When the person leaves, the SDK mostly reports `15` (face too high), `2` (multiple faces) and `17`, and **metrics stop arriving**. Away = no face data for N seconds. |
| 3. Head tilt from landmarks | **Usable.** Roll angle from landmarks 33 and 263 (outer eye corners) swings ±40–50° on neck tilts, about ±3° at rest. |
| 4. Time to stable readings | Pulse: first and stable about 12 s after start. HRV: first at about 30–40 s, `stable` at about 60–70 s, and only when sitting still. Breathing: **needs the chest in view** (see below). |
| 5. CPU and memory | Headless Node at 1280×720 / 30 fps: about 60–85 % of one core and about 470–560 MB RSS while running. |
| 6. Spotify free on desktop | Play exact track by URI: **yes**. Read current track: **reliable** (about 0.23 s per call). Ads: id starts with `spotify:ad:`, empty artist/album. |
| 7. SDK network calls beyond auth | Presage docs: metric computation is on-device; the backend authenticates the key. The SDK log also says it **downloads its model remotely** when no local model path is set. Telemetry is **on by default**. Keep the wording "the app never saves or uploads video". Still worth asking Presage on Discord. |
| 8. OpenRouter web search | The account is free tier (no credits). Web search is a paid plugin, so it is **left out of the MVP**. |

## Sensing (SDK)

### Big one: the SDK wants the chest in view

- The test videos are framed close, face near the bottom edge, shoulders barely in shot.
- Fed as-is, the SDK reports `7` "Place more of the chest in view" forever and emits **no metrics at all**, even
  with only cardio metrics requested.
- Shrinking the frame and padding the bottom with black (face in the top ~60 % of a 1280×720 canvas) passes
  the check. Pulse, HRV and face metrics then flow. Breathing rate still doesn't, because there is no real chest.
- Breathing rate appeared once, in `leave-and-return`, while the person was standing with the chest visible.

Consequences (PLAN.md updated):
- **Breathing is optional** in the state engine. Pulse and HRV lead; breathing is used when present.
- Calibration shows the SDK hints so the user can sit back until shoulders and chest are in view.
- The dev video source draws the video into a 1280×720 canvas with a configurable "framing pad" so the
  existing test videos work. Re-recording with the chest in view would also test breathing (on Daniel's list).

### Dev video source

- `useFile()` on the main-process SDK did **not** work with these videos: it logs thousands of
  "New timestamp is equal or less than the last one" warnings and never emits metrics, with or without
  frame pacing.
- Main-process `useCustomInput()` + `sendFrame()` with frames piped from ffmpeg works (used for the headless
  runs below), but needs ffmpeg installed.
- **Plan approach confirmed:** in a renderer, play the file in a `<video>`, draw it into a canvas (with the
  framing pad), `canvas.captureStream(30)`, then `sdk.useMediaStream(stream)`. Works in a hidden window with
  `backgroundThrottling: false`. The hidden window sometimes dips under 25 fps (validation `11`), which delays
  the first pulse to about 30 s. Fine for dev.
- CSP for the renderer must allow `worker-src blob:` and `media-src file:` (for the test file).
- The renderer bundle is CommonJS; import `@smartspectra/node-sdk/renderer` (it re-exports the metric
  bundles) and `@smartspectra/node-sdk/messages` for `decodeMetrics`. Don't import the root package in a
  renderer (it pulls in koffi/FFI).

### Readings per test video (headless, framing pad, face metrics on)

| Video | Pulse range (bpm) | HRV | Breathing | Blinks / talking frames | Notes |
| --- | --- | --- | --- | --- | --- |
| calm-working (125 s) | 59–65, briefly 77 | RMSSD ~84–118, stable from ~67 s | none | 142 / 23 | Stable, high confidence (70–100). |
| tense (92 s) | 53–72 | none (too much motion) | none | 198 / 94 | **Acted stress did not raise pulse.** Many "multiple faces"/"face the camera" hints (hands on head). |
| stretch (64 s) | 69–86, low confidence | none | none | 104 / 418 | Head roll clearly ±45° on tilts. |
| leave-and-return (110 s) | 63–78 | one unstable reading | one reading while standing | 67 / 29 | Metrics stop from ~21 s to ~78 s while away. |
| low-energy (92 s) | 60–75 | RMSSD ~60–67, stable from ~60 s | none | 75 / 0 | Pulse about the same as calm; HRV lower than calm. Few blinks. |

Takeaways for the state engine:
- Pulse barely differs across the acted clips (calm 59–65, tense 53–72, low 60–75). Acted states don't move
  vitals much; the face signals (blinks, talking) differ more.
- Thresholds from PLAN.md can't be validated on these videos: the acted "tense" clip has a normal pulse.
  `tense.mp4 → Tense` will need face support (blink rate, talking, expressions) or Daniel's tuning on a live run.
  Unit tests with fake streams are the real acceptance for the classifier.
- Treat "no face data for 20 s" as away. Don't wait for `kNoFaceFound`.
- Validation codes flap quickly (`0` ↔ `17` within a second). Smooth them before showing hints.

### Payload details

- `decodeMetrics` from `@smartspectra/node-sdk/messages` (the root export returns a raw Buffer unless a
  class is registered).
- `cardio.pulseRate[]`: `{ value, confidence (0–100), stable, timestamp }`.
- `cardio.hrv[]`: `{ rmssd, meanNn, sdnn, baevsky, confidence, stable }`. Baevsky values here are small (0.2–0.5).
- `face.landmarks[]`: `{ value: 478 × {x, y} in pixels, stable, timestamp }`.
- `face.expression[]`: `{ scores: [{ type: 'NEUTRAL' | 'HAPPY' | ..., confidence }] }`, confidence is a
  **percentage (0–100)**.
- `face.blinking[]` / `face.talking[]`: `{ detected }`.
- Metrics events arrive about 28 per second at 30 fps.
- **`enableTelemetry` defaults to `true`.** Ovra must always pass `enableTelemetry: false` unless opted in.

## Music (Spotify via AppleScript)

- `play track "spotify:track:…"` plays that exact track on a free account. `play track "spotify:playlist:…"`
  plays the playlist. `next track`, `pause`, `set sound volume` work.
- `name`, `artist`, `album`, `id`, `spotify url`, `duration` (ms), `player position` (seconds), `player state`
  all read fine, about 0.23 s per osascript call.
- **`player position` uses the system locale decimal separator** (`2,84` on this Mac). Parse both `,` and `.`.
- **Ads:** id `spotify:ad:<hex>`, name like "Listen to music, ad-free.", empty artist and album. `next track`
  does not skip an ad. Mark `isAd` and never score.
- **Any `tell application "Spotify"` launches Spotify** if it isn't running. `isAvailable()` must check
  `application "Spotify" is running` (which doesn't launch it) before sending commands.
- The Automation permission for the terminal was already granted. The Electron app will trigger its own prompt
  on first use (needs Daniel's click).

## Song scoring

- **Last.fm `track.getTopTags` returns empty tags** for every track tried, including very popular ones
  (`track.getInfo` also has empty `toptags`). `artist.getTopTags` works and is useful ("piano, classical,
  ambient, instrumental"). Pipeline: try track tags, then always add artist tags. Unknown artists return
  error 6, so handle that.
- OpenRouter free tier: 50 free-model requests per day. Several free models were rate-limited upstream
  (429). `nvidia/nemotron-3.5-lightning:free` returned valid strict JSON but took 37 s (it's a reasoning model).
  So: a config list of free models tried in order, batches of up to 50 songs, retry with backoff, and never
  block a session.
- LLM output was sensible for known songs and gave low confidence for unknown ones as asked.
- Web search: not available without credits. Dropped from the MVP (it was nice-to-have).

## Plan changes made

See `docs/decisions.md` (entries 6 onward) and the edits in PLAN.md §4, §5, §6.
