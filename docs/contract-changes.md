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

## 2026-11-13 — polish (4.3) — push:sdk-error

- File: src/shared/types.ts
- Change: `'push:sdk-error': SdkError` in `IpcPush` and `IPC_PUSH_CHANNELS`.
- Why: the calibration screen shows a calm fallback message when the SDK fails (e.g. credits exhausted).
- Status: applied on main

## 2026-11-13 — orchestrator — MusicController.getVolume (optional)

- File: src/shared/types.ts
- Change: `getVolume?(): Promise<number | null>` on `MusicController`.
- Why: Settle's early switch can fade out and restore the user's volume (PLAN.md §6).
- Status: applied on main

## 2026-11-13 — simulator — dev simulator controls and status

- File: src/shared/types.ts
- Change: `SimScenario`, `SimAction`, `SimulatorStatus`; invoke `simulator:status`, `simulator:set-scenario`,
  `simulator:action`, `simulator:set-fast-mode`; push `push:simulator`. Dev builds only.
- Why: the dev simulator window controls the fake sensing service and shows what the app decided.
- Status: applied on main

## 2026-11-13 — simulator — music target-change gap override (dev only)

- File: src/main/music/selector/index.ts, src/main/music/index.ts, src/main/app.ts
- Change: `createTargetTracker(gap?: TargetGap)` (read on every update); `MusicDeps.targetGap?: TargetGap`;
  `AppOptions.musicTargetGap?: TargetGap`. Defaults stay `musicConfig.switching` (3 min, ×3 in Downtime).
- Why: the dev simulator's fast mode shortens the music target-change gap to 15 s (18 s in Downtime).
- Status: applied in feat/simulator (requested by the coordinator)

## 2026-11-13 — orb indicator — OrbView.calibration

- File: src/shared/types.ts
- Change: `OrbView.calibration?: number` (0–1), set by the windows forwarder from `sdk:calibration-progress`
  between `sdk:checkin-started` and `sdk:checkin-ended` with phase `calibration`; undefined otherwise.
- Why: the moon waxes from crescent to full with calibration progress (camera indicator redesign).
- Status: applied in feat/orb-indicator (requested by the coordinator)

## 2026-11-14 — sensing monitor — diagnostic counters and read-only state

- File: src/shared/types.ts
- Change: add `MonitorCounts`, `CaptureDiagnostics`, `MonitorMetricSummary`, `StateDiagnostics`,
  `SessionEndSource`, `SessionStatusChange`, and `MonitorSnapshot`. These carry counters, confidence
  summaries, flags, timing and text only; no raw vital values, expression scores, landmarks or baseline.
- Change: add optional `CaptureStartRequest.diagnostics`; add read-only `StateEngine.diagnostics()`;
  add optional `SessionService.end(source?: SessionEndSource)` to label end causes. Existing no-argument
  end calls retain their behavior; the source is diagnostic metadata only.
- Change: add bus events `monitor:diag: CaptureDiagnostics`,
  `monitor:capture-status: { status: CaptureStatus }`, and `monitor:session-change: SessionStatusChange`.
- Change: add `IpcCaptureSend['capture:diag']: CaptureDiagnostics` and `IpcPush['push:monitor']: MonitorSnapshot`,
  plus their `IPC_CAPTURE_CHANNELS` and `IPC_PUSH_CHANNELS` whitelist entries.
- Why: inspect SDK payload presence/stability before throttling and compare it with Ovra's existing decisions.
  Capture diagnostics are requested only when `OVRA_MONITOR=1` and the app is not packaged.
- Status: applied in 4e6cf91

## 2026-11-14 — sensing monitor — dev launch script

- File: package.json
- Change: add `dev:monitor`: `OVRA_MONITOR=1 electron-vite dev`. No dependency changes.
- Why: open the normal consent-controlled app alongside the dev-only sensing monitor window.
- Status: applied in 25ba7a9
