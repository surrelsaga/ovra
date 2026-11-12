# Module ownership (Phase 2)

Only edit the paths you own. Everything else is read-only for you.

| Agent | Branch | Owns |
| --- | --- | --- |
| A. Sensing | `feat/sensing` | `src/main/sdk/`, `src/renderer/capture/` |
| B. State engine + session | `feat/state` | `src/main/state/`, `src/main/session/` |
| C. Music | `feat/music` | `src/main/music/` (controller, library, scoring, selector, config) |
| D. Moves | `feat/moves` | `src/main/moves/`, `src/renderer/move-card/` |
| E. Orb + shell | `feat/shell` | `src/main/windows/`, `src/renderer/main-window/`, `src/renderer/orb/`, `src/renderer/ui/` (shared React components) |
| F. Privacy + storage | `feat/privacy` | `src/main/privacy/`, `src/main/storage/` |
| Orchestrator | `main` | `src/shared/`, `src/preload/`, `src/main/{index,app,bus,env,paths}.ts`, `src/main/ipc/`, `src/renderer/shared/`, configs, `package.json`, `PLAN.md`, `docs/` (except your own report section) |

Everyone may also add files under `docs/` named after their module (e.g. `docs/sensing.md`) and append to
`docs/contract-changes.md`.

## How the pieces fit

- Every module exports a `create…(deps)` factory (signatures in its `index.ts`) that returns the service
  interface from `src/shared/types.ts`. `src/main/app.ts` wires them. Keep those signatures; if you need a
  different dependency, request it in `docs/contract-changes.md`.
- Modules talk only through the bus (`src/main/bus.ts`, events in `BusEvents`) and the service interfaces.
  Never import another agent's internals.
- IPC: register your channels in your module's `register…Ipc()` using `handle()` from `src/main/ipc`.
  Renderers use `ovra().invoke(...)` / `usePush(...)` from `src/renderer/shared/bridge.ts`.
- Pushes to windows: the windows module (E) forwards bus events to renderers (`push:*` channels).
  The moves module emits `move:card` with the full `MoveCardView`.
- Tunable numbers go in a `config.ts` inside your folder.
- In tests, create a bus with `createBus()` and fake the other services.

## Running things

- `npm run typecheck`, `npm run lint`, `npx vitest run src/main/<your-folder>` (your tests only).
- `npm run ci` runs everything (orchestrator uses this before merging).
- Dev harnesses run your module in the real Electron app without the others (dev only):
  `npm run harness:sensing` (A), `npm run harness:shell` (E), `npm run harness:moves` (D).
  Implement `runHarness()` in your module's `harness.ts`. Music (C) can run Node scripts with `npx tsx`.
- `.env` and `test-media/` are not in worktrees. Use the absolute paths you were given
  (`OVRA_ENV_PATH` and `OVRA_TEST_MEDIA` env vars are read by `src/main/env.ts` and `src/main/paths.ts`).
