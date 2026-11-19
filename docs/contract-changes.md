# Contract change requests

## 2026-11-16 — Job 11 — calibration startup stage

- File: src/shared/types.ts
- Change: optional `starting?: boolean` on `sdk:calibration-progress`; `push:calibration` reuses that payload.
- Why: show camera startup separately until capture is running and a metrics or validation frame arrives; carries only a flag, no camera data or vitals. Existing producers remain compatible.
- Status: applied in surrelsaga/ovra-stages (allowed by the Job 11 brief)

Agents: don't edit `src/shared/types.ts` or `package.json`. Add a request here, commit it on your branch,
and tell the orchestrator. The orchestrator applies it on main and tells everyone to rebase.

## 2026-11-15 — UI bits (Job 3) — framing bubble action and Session preview

- File: src/shared/types.ts
- Change: optional `OrbView.bubbleAction?: 'show-camera'` and `BusEvents['orb:bubble'].action?: 'show-camera'`; `window:open-main` accepts its existing void request or `{ showCamera: true }`; additive push `push:main-window: { visible: boolean; showCamera?: boolean }` and whitelist entry.
- Why: carry the optional framing action to the orb, route it to the Session tab, and explicitly release the display-only stream on window hide/minimise even when renderer background throttling is disabled. Existing bubble text and open-main callers remain valid; no images or frames cross IPC.
- Status: applied in surrelsaga/ovra-uibits (requested by the coordinator)

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

## 2026-11-14 — orb pill — camera teaching and next check

- File: src/shared/types.ts
- Change: additive `AppSettings.cameraTeachCount: number`, default `0`; additive `OrbView.nextCheckAt?: number` (estimated next check-in timestamp, omitted when unknown).
- Why: persist the first three camera indicator lessons and describe camera-off gaps without hiding the song. Existing settings merge over defaults; the privacy settings schema validates the inherited additive field.
- Status: applied in 0fedda5

## 2026-11-14 — privacy honesty — show data folder

- File: src/shared/types.ts
- Change: add invoke channel `'data:show-folder': { req: void; res: void }` and its `IPC_INVOKE_CHANNELS`
  whitelist entry. The main process opens `app.getPath('userData')` with `shell.openPath` and rejects with
  the error text if the folder can't be opened.
- Why: the upcoming Privacy screen lets the user see exactly what Ovra keeps on disk.
- Status: applied in surrelsaga/ovra-privacy (requested by the coordinator)

## 2026-11-14 — music playlists — catalog and positive votes

- File: src/shared/types.ts
- Change: optional `Song.origin: 'mine' | 'fallback' | 'heard'`, `Song.playlists: string[]`, `Song.playable: boolean`; optional `PlaylistLink.trackCount`, `totalCount`, `fetchedAt`, `readError`; optional `LearnedAdjustments.liftVotes`, `goodVotes`.
- Why: read pasted playlists before playback, retain playlist context and rank songs using local positive votes while loading older saved libraries.
- Status: applied in surrelsaga/ovra-music (requested by the coordinator)

## 2026-11-14 — demo mode and why line

- File: src/shared/types.ts
- Change: optional `SessionConfig.demo?: boolean`; optional `OrbView.why?: { text: string; progress?: number; moving: boolean }` (`moving` false = show on hover only) and `OrbView.demo?: boolean`.
- Why: demo mode (decision 28) and the why line (decision 34). Coarse words only, never vitals values.
- Status: applied on main by the coordinator

## 2026-11-14 — activities and playlist help

- File: src/shared/types.ts
- Change: replace `Activity` with `'focus' | 'reading' | 'creative' | 'everyday' | 'unwind'`; the privacy history schema migrates all five legacy activity values on read.
- Change: additive `AppSettings.musicHelpShown` and `musicStartHelpShown`, both default `false`, to remember the onboarding help and first-session reminder independently.
- Change: additive invoke `'data:folder': { req: void; res: { path: string; platform: string } }` and whitelist entry; returns the actual Electron user-data folder and platform for Privacy.
- Why: coordinator-approved decision 33 activity picker, one-time playlist help, and decision 32 local storage section (Job C); no dependency or package changes.
- Status: applied in surrelsaga/ovra-ui (requested by the coordinator)

## 2026-11-14 — song scoring version

- File: src/shared/types.ts
- Change: optional `SongScores.scorer?: number`, the scoring version that produced the scores (missing = version 1). The privacy song schema accepts it as an optional positive integer.
- Why: Job F made scoring per-track and rubric-based; AI scores from older versions are redone once in the background while learned adjustments and votes stay untouched.
- Status: applied in surrelsaga/ovra-scoring (requested by the coordinator)

## 2026-11-15 — presence — raw validation on snapshots

- File: src/shared/types.ts
- Change: optional `MetricsSnapshot.validationCode: number`, the raw SDK validation code for the frame.
- Why: framing codes prove presence before hint smoothing, including vitals-only mode; empty face objects alone do not.
- Status: applied in surrelsaga/ovra-presence (requested by the coordinator)

## 2026-11-15 — reliability: calibration framing check, failure choices

- File: src/shared/types.ts
- Change: optional `Session.calibrationFailed?: string` (plain-words reason; the session stays `calibrating` and waits).
- Change: new `CalibrationAction = 'skip-framing' | 'retry' | 'start-anyway'` and invoke `'session:calibration': { req: { action: CalibrationAction }; res: void }` with its `IPC_INVOKE_CHANNELS` entry.
- Change: optional `framing?: boolean` on `'sdk:calibration-progress'` and `'push:calibration'` (true until the calibration clock starts).
- Change: `SensingService.skipFraming(): void` and `SessionService.calibrationChoice(action: 'retry' | 'start-anyway'): Promise<void>` (interface additions; the simulator and monitor harness fakes got no-op `skipFraming`).
- Why: docs/reliability.md §5.1 (decision 39): framing check with Skip, and Try again / Start anyway instead of running blind.
- Status: applied in surrelsaga/ovra-rules (requested by the coordinator)

## 2026-11-15 — SDK crash recovery (Job 9)

- File: src/shared/types.ts
- Change: new bus event `'sdk:reconnecting': { active: boolean; message?: string }`. Active while sensing restarts a dead SDK (the state treats it like a pause: no away, no windows, why line "Camera reconnecting"); inactive once the stream runs again. Giving up is an `sdk:error` with code `'sdk-lost'`, `retryable: false` and a plain message.
- Change: optional `Session.calibrationSdkFailed?: boolean`. True when calibration failed because the SDK died or couldn't reach Presage; the screen shows that reason instead of the steady-pulse bar and posture advice.
- Behaviour: raw SDK errors are still forwarded as `sdk:error` (code and message, key redacted) but with `retryable: true`, because sensing now retries them itself. Only `sdk-lost` and `no-api-key` are non-retryable on the bus.
- Why: Daniel's live runs (decision 48): the SDK sat in kError, Ovra kept `capture=running` and declared away; calibration blamed the user.
- Status: applied in surrelsaga/ovra-sdkfix2 (allowed by the Job 9 brief)

## 2026-11-16 — simulator Instant speed and current-target switch (Job 18)

- Requested: `SimSpeed = 'instant' | 'fast' | 'normal'`; `SimulatorStatus.speed: SimSpeed` (retain `fastMode` for compatibility), optional `target?: MusicTarget | null`, `why?: OrbView['why']` and `countdown?: string`.
- Requested invokes: `simulator:set-speed` (`{ speed: SimSpeed }` → `SimulatorStatus`) and `simulator:switch-music` (`void` → `void`), plus their `IPC_INVOKE_CHANNELS` entries.
- Why: three speeds cannot be represented by the existing boolean; the panel needs the engine's existing hold progress and a dev-only music trigger without overloading unrelated channels.
- Status: applied in surrelsaga/ovra-sim with explicit coordinator authorization (msg_eefb82645884).

## 2026-11-16 — demo history marker (Job 19)

- File: `src/shared/types.ts`
- Change: additive optional `SessionRecord.demo?: boolean`, accepted by the strict privacy schema and inherited by `SessionSummary`.
- Why: the approved tour must mark History and session summaries “Demo session · shorter waits”; records without the field remain readable and unmarked. Only true is written for new demo sessions; normal records keep their existing shape.
- Status: applied in `surrelsaga/ovra-tourbuild`, expressly allowed by Job 19 section D. No other shared contracts or dependencies changed.

## 2026-11-16 — music monitor and labelled demo previews (Job 22)

- File: `src/shared/types.ts`; additive changes explicitly allowed by the Job 22 brief.
- `MusicStatus.playlist?` reports Ovra's last requested playlist (`uri`, optional `name`, completed-song `played` count); `MonitorSnapshot.music.playlist?` mirrors it. Spotify cannot report the actual context after manual user changes.
- `MusicController.refocusResult?` contains only coarse words about the last play command's refocus; no app names, paths or measurements.
- `MusicDecision` and observer-only `monitor:music` carry action/reason, optional playlist/from/to and played count. The dev monitor logs these; there is no renderer command or persistence.
- `OrbView.previewMood?` and `orb:bubble.previewMood?` carry only a moon appearance for a labelled demo fallback. The bubble and preview expire together after the configured 3 seconds, starting when the queued bubble actually shows. Both forwarding and rendering require demo mode. The actual mood, why line, state events, timeline/history, music and nudges are unchanged; no preview field is added to stored session types or schemas.

## 2026-11-18 — demo reaction previews (Job 25)

- File: `src/shared/types.ts`; one additive optional field, allowed by the Job 25 brief ("additive changes only if needed").
- `MusicStatus.preview?: boolean`: true only while a demo fallback steers music toward a missed mood's target; `target` then holds that preview target and the orb pill reads "Preview · Calm down". Absent in normal sessions and outside the preview window. Not stored anywhere; no history, learning or tracker change.
- Why: the orb pill is built from `MusicStatus.target`; without a flag it would show a previewed target as if it were real.

## 2026-11-19 — demo Away preview (Job 26)

- File: `src/shared/types.ts`; additive widening allowed by the Job 26 brief ("additive changes only if needed").
- `OrbView.previewMood?` (and `orb:bubble.previewMood?`, now typed as the same field) also accepts `'away'`: the orb shows the away moon and a "Preview · Away · just now" pill for the labelled demo fallback of step 7. View only, demo only, expires with its bubble like the other previews; no break, session status, history or music change.
