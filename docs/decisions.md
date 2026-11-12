# Decisions log

Decisions the orchestrator made without asking, with the reason. Newest at the bottom.

## 2026-11-12

1. **Main repo path is `~/Desktop/ovra`**, not `~/Projects/ovra` as the brief said (that folder doesn't exist).
   Agents get `/Users/nguyenducanh/Desktop/ovra/.env` and `/Users/nguyenducanh/Desktop/ovra/test-media/`.
2. **Test videos keep their current names** (`*.mp4.mov` for four of them). Renaming Daniel's files isn't needed;
   the code takes a path. The dev video source lists whatever is in `test-media/`.
3. **No live camera test in the spike.** AGENTS.md says test with the dev video source, never the live camera.
   The live test is on Daniel's list.
4. **Installed ffmpeg with Homebrew** (free, dev tool only) to inspect the test videos and to feed frames
   into the SDK in headless spike scripts. The app itself does not depend on ffmpeg.
5. **Commits have no AI attribution**, per AGENTS.md.
6. **Breathing is optional everywhere** (state engine, baseline, moves). The SDK only gives breathing rate with
   the chest in view, which normal laptop framing often doesn't show. Pulse is the only required signal.
7. **Dev video source draws into a padded 1280×720 canvas.** The current test videos fail the SDK's chest check
   otherwise. The pad is a config value; set it to 0 if the videos are re-recorded with the chest in view.
8. **Away detection uses "no face data for 20 s"**, not `kNoFaceFound`, which the SDK rarely sends.
9. **Capture renderer sends only derived face values to main** (present, blinking, talking, expression scores,
   head roll, face position/size). Landmarks never leave the capture renderer. Simpler privacy story.
10. **Last.fm: always fetch artist tags.** Track tags come back empty right now.
11. **Web search dropped from the MVP.** The OpenRouter account is free tier with no credits and web search is a
    paid plugin. Using it would spend money.
12. **OpenRouter uses a configured list of free models** tried in order, because single free models are often
    rate-limited upstream.
13. **Spotify `isAvailable()` never launches Spotify** (checks `is running` first), since any AppleScript `tell`
    launches the app.
