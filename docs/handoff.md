# Orchestrator handoff

Read this, then `AGENTS.md`, `PLAN.md`, `docs/progress.md` and `docs/decisions.md`, to continue the Ovra build in a fresh session.

## How we work
- The orchestrator (Claude, main session) plans, writes briefs, reviews reports and merges. Agents do the coding.
- **Agent choice:** use Claude Opus agents (`--agent claude --model claude-opus-5-5`) for hard, open-ended tasks that need
  judgment. Use Codex agents (`--agent codex`) for clear, well-specified work.
- Orca: `orca orchestration ...`, run `run_e94a5d3d429a`. Each worker gets a child worktree (`--worktree new-child
  --name ovra-<x> --base-branch main`). To merge: read the report, spot-check the diff, then `git merge --ff-only <branch>`
  (rebase inside the worktree first if needed). Then `worker-release` and `orca worktree rm --worktree path:... --delete-branch`.
- Briefs go in `/private/tmp/claude-501/-Users-nguyenducanh-Desktop-ovra/specs-p4/` (outside the repo). They always
  include: the files the agent owns, the PLAN.md sections, the AGENTS.md rules, what "done" means and the checks to run.
- Commits: as Daniel, no AI attribution, conventional prefixes. Nothing is pushed yet.

## Daniel's standing rules
- **Presage credits are limited.** Agents may only use the SDK (dev video, harnesses) when Daniel OKs it for a task.
  Never use the live camera; Daniel does the live tests himself.
- **Spotify:** prefer mocks. Any real-Spotify test saves and restores volume, track, play state, shuffle and repeat.
  Warn Daniel first, because he may be listening.
- Keep replies short. Show visuals (screenshots or an artifact mockup) before UI changes.

## Where things stand (2026-11-14)
- All modules, integration, README, packaging, Windows controller, Settle fade, pixel-art moon, satellite camera
  indicator (moonrise / satellite / waxing), realistic stick figures, simulator (`npm run dev:simulate`, test values kept
  in memory only) and sensing monitor (`npm run dev:monitor`) are merged on main.
- Daniel's live run with the monitor showed the SDK works. The problems were in Ovra:
  1. calibration is a fixed 90 s even while the SDK is still asking the user to reposition;
  2. "away" is based on face landmarks, which flap, so a seated user can be marked away;
  3. the orb pill shows "Camera on" whenever the camera is on, so the song never shows in continuous mode.
- Fixed and merged (`3a9cd73`, `180632b`): calibration clock, face presence, orb pill with song + camera dot + satellite lessons.
- **No agents running.** Next: Daniel's 5-minute live check with `npm run dev:monitor` (steps at the end of `docs/monitor.md`).

## Still to do
- **Deferred deliverables, until Daniel says go:**
  - DEV post draft and demo video script (deadline Nov 22, 11:59 PM PST);
  - a check of the Windows controller on a real Windows PC.
- **Daniel's own items:**
  - license, and fallback playlist links (`src/main/music/config.ts`);
  - Presage question on Discord about the SDK's network calls, then the privacy wording in `docs/privacy.md`;
  - re-record a test video with the chest in view;
  - tune thresholds;
  - launch the packaged app;
  - push to GitHub.
