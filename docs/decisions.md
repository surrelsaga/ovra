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
14. **Session lifecycle goes to Agent B** (with the state engine). PLAN.md's agent table didn't assign
    `src/main/session/`; it's small and closely tied to seated time and away detection.
15. **Agent E also owns `src/renderer/ui/`** (shared React components) and the windows module, which forwards
    bus events to renderers. Agent D builds its own move card UI and emits `move:card` with the full view.
16. **Module dev harnesses** (`OVRA_HARNESS=sensing|shell|moves`) so A, D and E can run their parts in real
    Electron before integration. `src/main/app.ts` holds the final wiring for Phase 3.
17. **Capture renderer receives the Presage key in `CaptureStartRequest`** (the renderer SDK needs it). Never
    logged.
18. **Dependencies added in Phase 1:** zod (LLM JSON validation), lucide-react (icons), @fontsource-variable/inter
    (bundled font, no network), vitest, @vitest/coverage-v8, jsdom, @testing-library/react + jest-dom, tsx, dotenv.
19. **Phase 2 agents are Claude Code workers via Orca**, each in its own child worktree. Claude fits better than
    Codex here because every brief leans on long PLAN.md/AGENTS.md rules and the SDK/UI details.
20. **From now on Codex does all implementation, review, fixes and merge prep; the orchestrator (Claude) only
    plans, writes briefs and decides.** Agent A (sensing, a Claude worker) was already mid-task, so it finishes;
    its branch gets a Codex review before merge. Phase 3 integration goes to Codex.
21. **No SDK runs without Daniel's OK** (2026-11-13): Presage credits are limited. Unit tests and mocks only; ask before any harness, dev video or live camera run. Added to AGENTS.md.
