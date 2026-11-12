# Ovra: rules for every agent

## Agent split
- Claude plans and designs (architecture, contracts, task briefs, decisions).
- Codex implements, reviews and fixes. Never use Claude agents for implementation.

Read PLAN.md fully before starting any task. It is the source of truth for what to build.

## Stack and structure
- Electron + TypeScript + React (electron-vite). Keep main-process logic out of the renderer.
- All shared types, event names and IPC channels live in `src/shared/types.ts`. Never redefine them elsewhere.
- Nothing outside `src/main/music/controller/` may call `osascript` or any other Mac-only API.
- Put tunable numbers (thresholds, intervals, move lengths) in config files, never inline.

## Privacy (never break these)
- Never write camera frames, images or video to disk. Never upload them.
- Never store raw vitals: pulse, breathing or HRV values, expression scores, face landmarks, or the baseline.
- Never send vitals or moods to any external service. Song scoring may send only title, artist and public tags.
- Set the SDK's `enableTelemetry = false` unless the user opted in. Never use Presage LLM Insights.
- No camera code may run before the user has given consent.
- UI wording is wellness only. No diagnosis, treatment or medical claims.

## Secrets and local files
- API keys come from `.env`. Never commit `.env`, keys, or `test-media/`. Never print keys in logs.
- `.env` and `test-media/` are git-ignored, so they don't exist in worktrees or copies of the repo.
  If you're not in the main repo folder, use the absolute paths the orchestrator gives you.
- **Presage credits are limited.** Never run anything that uses the SmartSpectra SDK (sensing or e2e harness,
  dev video source, spike scripts, live camera) without asking Daniel first. Test with unit tests and mocks.
- **Leave Daniel's Spotify as you found it.** Prefer mocks. Any test that touches the real Spotify app must save its
  state first (volume, track, playing/paused, shuffle, repeat) and restore it when done, also on errors and Ctrl+C.
  Never launch Spotify if it isn't running.

## Working alongside other agents
- Other agents may be working on this repo at the same time.
- Only edit the folders assigned to you.
- Don't edit `src/shared/types.ts` or `package.json` yourself. Write the change you need in
  `docs/contract-changes.md` and tell the orchestrator.
- Stage only your own files (`git add <your folders>`). Never `git add -A` or `git add .`.
- Run only your own module's tests. Ignore failures in other modules and report them instead of fixing them.

## Tests
- Write Vitest tests for the state engine, music targets and selector, and scoring parsers.
- Run typecheck and your tests before every commit.

## Git
- Commit as Daniel only (use the repo's git config). No Co-Authored-By lines, no AI attribution of any kind.
- Short, plain messages with conventional prefixes: feat, fix, chore, refactor, docs, test.
  Example: `feat: add check-in scheduler`
- Small commits. One branch per module, for example `feat/sensing`. Don't merge to main yourself
  unless the orchestrator tells you to.

## When you finish
Write a short report: what works, what's stubbed, and anything that needs Daniel.
