# Contract change requests

Agents: don't edit `src/shared/types.ts` or `package.json`. Add a request here, commit it on your branch,
and tell the orchestrator. The orchestrator applies it on main and tells everyone to rebase.

Format:

```
## <date> — <agent letter> — <short title>
- File: src/shared/types.ts (or package.json)
- Change: <exact type/field/dependency>
- Why: <one line>
- Status: requested | applied in <commit>
```

## 2026-11-12 — F — data:deleted-all bus event
- File: src/shared/types.ts
- Change: `'data:deleted-all': Record<string, never>` in `BusEvents`, emitted by privacy at the end of `deleteEverything()`.
- Why: music must drop its in-memory songs/playlists instead of rewriting songs.json after a delete-all.
- Status: applied on main

## 2026-11-12 — orchestrator (from E's report) — orb paused state and click-through
- File: src/shared/types.ts
- Change: `OrbView.paused: boolean`; IPC invoke `'window:orb-ignore-mouse': { req: { ignore: boolean }; res: void }`
  (added to `IPC_INVOKE_CHANNELS`).
- Why: the orb's transparent area blocked clicks on the desktop, and the pause-camera control had no shared state.
- Status: applied on main
