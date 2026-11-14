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
22. **Tests restore Spotify's original state** (volume, track, play state, shuffle, repeat) after touching the real app. Added to AGENTS.md.
23. **Strong Claude agents allowed again** (2026-11-13): Daniel asked to stop the Codex simulator worker and use a Claude Opus 5.5 agent instead; use Claude when tasks need judgment, Codex for well-specified work.
24. **Agent choice (2026-11-14):** Codex by default; Claude agents only for hard, open-ended tasks that need judgment or clarification (saves Claude usage).
25. **Calibration clock (2026-11-14):** the 90 s calibration window starts at the first good reading (validation ok or steady pulse with a face), not at camera start, with a 180 s hard cap (`src/main/sdk/config.ts`). It ends early once the state engine's baseline rules pass.
26. **(Superseded by 29.) Face presence (2026-11-14):** any SDK face object counts as present, even with empty landmarks; only SDK "no face found" clears it. Without face consent, vitals stand in for presence. Fixes seated users being marked away.
27. **Orb pill (2026-11-14):** the song always shows; camera status is a dot plus a 3 s note on each switch and a paused badge. The satellite explains the camera on the first three turn-ons only (`AppSettings.cameraTeachCount`).
28. **Demo mode is real, never scripted (2026-11-14):** demo mode keeps the real SDK readings and the same thresholds; it only shortens the waits (windows, holds, away, music gap, seated nudges) and guides the user with steps that genuinely change their body (squats raise pulse, paced breathing lowers breathing rate, leaving the camera triggers away). No manual or forced mood triggers, and no gaming the baseline (e.g. calibrating while exercised). A step that doesn't trigger is shown honestly ("may not trigger") and can be skipped. Use this framing in the DEV post: "the demo works the same as real use, it just reacts sooner." In a demo session the screen looks exactly like a real one: no extra panels; the only differences are a small "Demo" badge, shorter waits, and one-line next-step hints in the orb's existing speech bubble, shown only after the previous state really happened. The full step list lives in a judge reference note (not in the app, probably not in the DEV post). For the DEV post, state the difference plainly: real use is slower and more authentic (90 s calibration, about 3 min of a sustained change before tense or low, 10 min for crashing out, music changes at most every 3 min, nudges at most every 20 min, seated nudges at 45/60/90 min), because real moods build over minutes and Ovra shouldn't react to a single spike; demo mode compresses those waits (45 s calibration, 30 s holds, 2 min for crashing out, 20 s music gap, seated nudge at about 3 min) so judges can see every state in about 15 minutes.
29. **Presence needs evidence (2026-11-14):** a bare SDK face object is not a person (the SDK sends empty ones when nobody is there). Present = a steady pulse reading, or landmarks with a plausible face box near the calibrated seat (size 0.12–0.8, center shift ≤ 0.25, size ratio ≤ 1.6), and not SDK code 2 (multiple faces; code 1 is no face). Away after 20 s without evidence; waking needs face evidence in 3 of the last 4 seconds or a pulse reading. The capture reducer keeps landmarks from any merged payload. Known limit: a persistent false box at the calibrated seat can still wake.
30. **Borderline holds pause (2026-11-14):** a window within 3% of the tense/low pulse bar pauses the hold (adds no time) instead of resetting it; clear misses still reset. Normal and demo mode.
31. **Music plays from the user's playlists (2026-11-14):** pasted public playlists are read from Spotify's public embed page (first 100 tracks; on paste and at session start if older than 24 h). Pool = playlist songs + songs the user plays. Nearest-fit picks, no repeat within a session (oldest replay when exhausted), at most 1 in 10 picks from Spotify editorial mood playlists, always played in playlist context. Lift and good votes added; after 3 positive plays the user's votes outrank the AI guess. Not the Web API (login, Premium owner, 5-user cap, owned playlists only).
32. **Privacy honesty (2026-11-14):** Ovra's JSON files are owner-only (0600). Delete everything also clears Electron's browser storage. `docs/privacy.md` lists everything stored, sent and done on the computer; the app shows only "Stored on this Mac" (with Show in Finder), the full list stays in the doc for the DEV post. Last.fm lookups move under the AI scoring consent; Delete everything also removes the SDK cache folder.
33. **Activities (2026-11-14):** Focus, Reading, Creative, Everyday tasks, Unwind replace Deep work/Debugging/Writing/Admin/Downtime. The activity sets the energy and vocals lean when focused or good; tense/crashing still go to Calm; the same 3 min music gap for all.
34. **Why line (2026-11-14):** one short coarse line under the orb pill saying what Ovra is reading, shown only when something is moving (a hold building, away countdown, a notable signal) and on hover. Same in demo and real mode.
