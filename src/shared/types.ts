/**
 * Ovra shared contracts: every shared type, bus event and IPC channel lives here.
 * Only the orchestrator edits this file. Agents request changes in docs/contract-changes.md.
 *
 * Privacy reminder: types marked "in-memory only" must never be written to disk or sent anywhere.
 */

// ---------------------------------------------------------------------------
// Sensing (SDK) — in-memory only
// ---------------------------------------------------------------------------

/** One SDK reading. Confidence is 0–100 as reported by the SDK. */
export interface Reading {
  value: number
  confidence: number
  stable: boolean
}

export interface HrvReading {
  rmssd: number
  meanNn: number
  sdnn: number
  baevsky: number
  confidence: number
  stable: boolean
}

export type Expression =
  'angry' | 'contempt' | 'disgust' | 'fear' | 'happy' | 'neutral' | 'sad' | 'surprise'

/**
 * Derived face values. Computed in the capture renderer from SDK face metrics.
 * Landmarks never leave the capture renderer.
 */
export interface FaceSnapshot {
  /** A face was seen in this snapshot. */
  present: boolean
  blinking?: boolean
  talking?: boolean
  /** Expression scores, 0–100 (SDK percentages). Only with face consent. */
  expressions?: Partial<Record<Expression, number>>
  /** Head roll in degrees from the outer eye corners (landmarks 33 and 263). Positive = right ear down. */
  headRollDeg?: number
  /** Face centre, normalised 0–1 in the frame. */
  center?: { x: number; y: number }
  /** Face height as a fraction of frame height, 0–1. */
  size?: number
}

/**
 * One decoded metrics event, reduced to what Ovra uses. In-memory only.
 * Any field may be missing: breathing needs the chest in view, HRV needs ~60 s of stillness,
 * face fields need face consent.
 */
export interface MetricsSnapshot {
  /** Epoch ms when the snapshot was produced. */
  t: number
  /** Raw SDK validation for this frame; presence uses it before hint smoothing. */
  validationCode?: number
  pulse?: Reading
  breathing?: Reading
  hrv?: HrvReading
  face?: FaceSnapshot
}

/** SDK ValidationCode values (see @smartspectra/node-sdk ValidationCode). */
export const ValidationCode = {
  ok: 0,
  noFaceFound: 1,
  multipleFaces: 2,
  faceNotCentered: 3,
  faceSizeOutOfRange: 4,
  tooDark: 5,
  tooBright: 6,
  chestNotVisible: 7,
  cameraTuning: 10,
  frameRateTooLow: 11,
  excessiveMotion: 12,
  faceTooClose: 13,
  faceTooFar: 14,
  faceTooHigh: 15,
  faceTooLow: 16,
  faceNotForward: 17
} as const
export type ValidationCodeValue = (typeof ValidationCode)[keyof typeof ValidationCode]

export interface ValidationEvent {
  t: number
  code: number
  /** SDK hint text, e.g. "Place more of the chest in view." */
  hint: string
}

export interface SdkError {
  code: number | string
  message: string
  retryable: boolean
}

/** What the camera is being used for right now. */
export type SensingPhase = 'idle' | 'calibration' | 'checkin' | 'continuous' | 'return-check'

export type CameraMode = 'checkins' | 'continuous'

/** Where frames come from. 'file' is the dev video source (dev builds only). */
export type CaptureSource =
  { kind: 'camera'; cameraId?: string } | { kind: 'file'; path: string; framingPad: number }

/** Sent main → capture renderer to start capture. */
export interface CaptureStartRequest {
  phase: Exclude<SensingPhase, 'idle'>
  /** Presage key for the renderer SDK. Never log it. */
  apiKey: string
  source: CaptureSource
  /** Request faceMetrics. False when the user chose "vitals only". */
  face: boolean
  /** Always false unless the user opted in to Presage diagnostics. */
  telemetry: boolean
  /** Stop automatically after this long. Omit for continuous. */
  durationMs?: number
  /** Dev monitor only; keeps diagnostics work out of normal runs. */
  diagnostics?: boolean
}

export type CaptureStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error'

/** Dev monitor counters; no raw measurements, expression scores or landmarks. */
export interface MonitorCounts {
  payloads: number
  snapshots: number
  pulse: { present: number; stable: number; confidenceSum: number; confidenceCount: number }
  breathing: { present: number; stable: number; confidenceSum: number; confidenceCount: number }
  hrv: { present: number; stable: number; confidenceSum: number; confidenceCount: number }
  face: {
    object: number
    landmarks: number
    present: number
    blinking: number
    talking: number
    expressions: number
  }
  validationCodes: Record<string, number>
}

export interface CaptureDiagnostics extends MonitorCounts {
  t: number
  phase: Exclude<SensingPhase, 'idle'>
  processing: string
  validation: ValidationEvent | null
}

export interface MonitorMetricSummary {
  payloads: number
  snapshots: number
  durationSec: number
  pulse: { present: number; stable: number; confidence: number | null }
  breathing: { present: number; stable: number; confidence: number | null }
  hrv: { present: number; stable: number; confidence: number | null }
  face: MonitorCounts['face']
  validationCodes: Record<string, number>
}

export interface StateDiagnostics {
  pulseCount: number
  pulseSpanSec: number
  pulseNeeded: number
  pulseSpanNeededSec: number
  awayNoFaceSec: number
  baseline: boolean
  baselineFailure: string | null
  lastFace: number | null
  phaseStart: number
  phase: SensingPhase
  paused: boolean
}

export type SessionEndSource = 'ipc/user' | 'length elapsed' | 'quit' | 'delete-all'
export interface SessionStatusChange {
  t: number
  status: SessionStatus
  reason: string
  source: string
}

export interface MonitorSnapshot {
  t: number
  phase: SensingPhase
  processing: string
  capture: CaptureStatus
  validation: ValidationEvent | null
  recent: MonitorMetricSummary
  phaseMetrics: MonitorMetricSummary
  state: StateDiagnostics & {
    secondsSinceFace: number | null
    awayCountdownSec: number | null
    away: boolean
    situation: Situation | null
    confidence: number
    seatedMinutes: number
    lastUpdated: number | null
  }
  session: {
    status: SessionStatus | null
    remainingSec: number | null
    lastChange: SessionStatusChange | null
  }
  music: {
    available: boolean
    name: string | null
    artist: string | null
    target: TargetWord | null
    leaveAlone: boolean
    playlist?: MusicStatus['playlist']
  }
}

// ---------------------------------------------------------------------------
// State engine — Baseline is in-memory only
// ---------------------------------------------------------------------------

/** Today's baseline. In-memory only, dropped when the session ends. Never stored. */
export interface Baseline {
  pulse: number
  breathing?: number
  rmssd?: number
  baevsky?: number
  /** Blinks per minute (face only). */
  blinkRate?: number
  /** Number of stable readings it was built from. */
  samples: number
  builtAt: number
}

export type Situation = 'focused' | 'tense' | 'crashing' | 'low' | 'good'

export type Trend = 'rising' | 'steady' | 'falling'

export interface StateUpdate {
  t: number
  /** Null until calibration has produced a baseline. */
  situation: Situation | null
  /** 0–1. */
  confidence: number
  seatedMinutes: number
  away: boolean
  trend: Trend
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export type Activity = 'focus' | 'reading' | 'creative' | 'everyday' | 'unwind'

export type CheckinIntervalMin = 3 | 5 | 10

export interface SessionConfig {
  activity: Activity
  lengthMin: number
  cameraMode: CameraMode
  checkinIntervalMin: CheckinIntervalMin
  music: boolean
  /** Demo mode: same sensing and thresholds, shorter waits, bubble hints. Never stored as a setting. */
  demo?: boolean
}

export type SessionStatus = 'calibrating' | 'running' | 'on-break' | 'ended'

export interface Session {
  id: string
  config: SessionConfig
  startedAt: number
  endedAt?: number
  status: SessionStatus
  /** True when sensing runs this session (camera consent given and started). False if the camera was declined. */
  sensingEnabled: boolean
  /** Calibration failed (plain-words reason); the session waits on Try again or Start anyway. */
  calibrationFailed?: string
  /** The SDK failed (crash or network), not the readings: the screen shows the reason, not advice. */
  calibrationSdkFailed?: boolean
}

/** The calibration screen's choices: Skip (framing check), Try again or Start anyway (after a failure). */
export type CalibrationAction = 'skip-framing' | 'retry' | 'start-anyway'

export interface SessionTick {
  sessionId: string
  elapsedSec: number
  remainingSec: number
}

/** One mood label on the session timeline. A label, not a vital, so it may be stored. */
export interface MoodPoint {
  t: number
  situation: Situation | 'away' | 'unknown'
}

export type MoveOutcome = 'done' | 'snoozed' | 'skipped'

export interface MoveRecord {
  t: number
  moveId: MoveId
  outcome: MoveOutcome
}

/** What gets stored for history. Labels and counts only — no vitals. */
export interface SessionRecord {
  id: string
  /** Demo sessions use shorter waits. Absent on older and normal records. */
  demo?: boolean
  activity: Activity
  startedAt: number
  endedAt: number
  lengthMin: number
  cameraMode: CameraMode | 'off'
  moodTimeline: MoodPoint[]
  moves: MoveRecord[]
  snoozes: number
  longestSeatedMin: number
  /** Spotify ids of songs the app learned something about this session. */
  learnedSongIds: string[]
}

export type SessionSummary = SessionRecord

// ---------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------

export interface NowPlaying {
  /** Spotify id URI, e.g. "spotify:track:4cOd…" or "spotify:ad:…". */
  id: string
  uri: string
  name: string
  artist: string
  album: string
  durationMs: number
  positionMs: number
  state: 'playing' | 'paused' | 'stopped'
  isAd: boolean
}

/** Platform music control. Mac: SpotifyMacController. Only src/main/music/controller/ may implement it. */
export interface MusicController {
  /** True if the player app is running. Must never launch the app. */
  isAvailable(): Promise<boolean>
  /** Coarse outcome of the last play command’s foreground-app restore, never an app path. */
  refocusResult?: string
  play(uri: string, contextUri?: string): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  next(): Promise<void>
  setVolume(pct: number): Promise<void>
  /** Current player volume 0–100, or null if it can't be read. Optional: controllers without it can't fade. */
  getVolume?(): Promise<number | null>
  current(): Promise<NowPlaying | null>
  /** Implemented by polling (~2 s). Returns an unsubscribe function. */
  onTrackChange(cb: (t: NowPlaying) => void): () => void
}

export type Energy = 1 | 2 | 3 | 4 | 5
export type SongMood = 'dark' | 'neutral' | 'bright'
export type Vocals = 'instrumental' | 'light' | 'heavy'
export type ScoreSource = 'lastfm' | 'llm' | 'web' | 'learned' | 'rules'

export interface SongScores {
  energy: Energy
  mood: SongMood
  vocals: Vocals
  /** 0–1. */
  confidence: number
  source: ScoreSource
  scoredAt: number
  /** Public tags used to score (Last.fm). */
  tags?: string[]
  /** Scoring version that produced these scores; missing = version 1. Older AI scores are redone once. */
  scorer?: number
}

/** Small learned adjustments on top of base scores. */
export interface LearnedAdjustments {
  /** Added to base energy (clamped to 1–5 when used). */
  energyDelta: number
  /** Added to base confidence (clamped to 0–1 when used). */
  confidenceDelta: number
  settleVotes: number
  steadyVotes: number
  liftVotes?: number
  goodVotes?: number
  quickSkips: number
  plays: number
  updatedAt: number
}

export interface Song {
  /** Spotify track id URI ("spotify:track:…"). Cache key. */
  id: string
  title: string
  artist: string
  album?: string
  durationMs?: number
  scores?: SongScores
  learned?: LearnedAdjustments
  firstSeenAt: number
  lastPlayedAt?: number
  playCount: number
  origin?: 'mine' | 'fallback' | 'heard'
  playlists?: string[]
  playable?: boolean
}

export interface PlaylistLink {
  /** "spotify:playlist:…" */
  uri: string
  /** As pasted (https://open.spotify.com/playlist/…). */
  url: string
  name?: string
  addedAt: number
  trackCount?: number
  totalCount?: number
  fetchedAt?: number
  readError?: string
}

export type MusicTarget = 'settle' | 'ease-down' | 'steady' | 'lift' | 'let-it-ride' | 'wind-down'

/** The only words the UI shows for targets. */
export type TargetWord = 'Calm' | 'Focus' | 'Boost'

export const TARGET_WORD: Record<MusicTarget, TargetWord> = {
  settle: 'Calm',
  'ease-down': 'Calm',
  'wind-down': 'Calm',
  steady: 'Focus',
  'let-it-ride': 'Focus',
  lift: 'Boost'
}

/** Library tab in the Music screen. */
export type LibraryTab = 'Calm' | 'Focus' | 'Boost' | 'Not sure yet'

/** Observer-only steering words, never measurements. No renderer command or persistence. */
export interface MusicDecision {
  action: 'skip' | 'keep' | 'switch' | 'switch blocked' | 'refocus' | 'playlist'
  reason: string
  from?: string
  to?: string
  playlist?: string
  played: number
}

export interface MusicStatus {
  /** Ovra’s last requested playlist; Spotify cannot report the actual playback context. */
  playlist?: { uri: string; name?: string; played: number }
  available: boolean
  leaveAlone: boolean
  target: MusicTarget | null
  nowPlaying: NowPlaying | null
  /** Songs waiting to be scored (for the "getting to know your music" line). */
  scoringQueue: number
  scoredCount: number
  /** Demo fallback only: `target` is a labelled preview of a mood's music, not the real target. */
  preview?: boolean
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

export type MoveId = 'breathe' | 'neck-stretch' | 'stand-stretch' | 'walk' | 'step-outside'

/** How the app can check a step. 'none' = not checked. */
export type MoveCheck =
  'none' | 'breathing-slows' | 'head-tilt-left' | 'head-tilt-right' | 'stand-up' | 'away-and-back'

export interface MoveStep {
  id: string
  title: string
  /** One line of how-to. */
  howTo: string
  durationSec: number
  /** Key of the line-figure animation for this step. */
  animation: string
  check: MoveCheck
}

export interface Move {
  id: MoveId
  name: string
  lengthSec: number
  steps: MoveStep[]
  /** True for moves where the user leaves the desk (walk, step outside). */
  leavesDesk: boolean
}

export interface Nudge {
  id: string
  moveId: MoveId
  /** Wellness wording only, e.g. "You seem tense. Want to stretch your neck?" */
  message: string
  t: number
}

export type NudgeResponse = 'go' | 'snooze' | 'skip'

export interface MoveStepEvent {
  moveId: MoveId
  stepIndex: number
  step: MoveStep
  remainingSec: number
}

export interface MoveFeedback {
  moveId: MoveId
  stepId: string
  /** e.g. "I can see the tilt", "Your breathing is slowing down". */
  message: string
}

export type ReturnCheckResult = 'calmer' | 'still-tense' | 'unknown'

/** What the move card window shows. */
export type MoveCardView =
  | { kind: 'hidden' }
  | { kind: 'nudge'; nudge: Nudge }
  | { kind: 'move'; move: Move; stepIndex: number; remainingSec: number; feedback?: string }
  | { kind: 'away'; since: number; manual: boolean }
  | { kind: 'return-check'; progress: number }
  | { kind: 'return-result'; result: ReturnCheckResult; message: string }

// ---------------------------------------------------------------------------
// Orb
// ---------------------------------------------------------------------------

export type OrbMood = 'calm' | 'uneasy' | 'stormy' | 'dim' | 'bright'

export const ORB_MOOD: Record<Situation, OrbMood> = {
  focused: 'calm',
  tense: 'uneasy',
  crashing: 'stormy',
  low: 'dim',
  good: 'bright'
}

export interface OrbView {
  mood: OrbMood
  /** Camera is on. Shows the orbiting satellite. Can't be hidden while true. */
  listening: boolean
  /** Calibration progress, 0–1, only while calibrating. The moon waxes with it. */
  calibration?: number
  /** The user paused the camera for this session (mini control). */
  paused: boolean
  away: boolean
  awaySince?: number
  /** Breathe along: orb scale follows this, 0 (exhaled) – 1 (inhaled). */
  breath?: number
  bubble?: string
  bubbleAction?: 'show-camera'
  nowPlaying?: { name: string; artist: string; word: TargetWord | null }
  /** Check-in mode, camera off: when the next check-in should start (estimate). Unset when unknown. */
  nextCheckAt?: number
  /** Why line: coarse words about what Ovra reads now (no numbers of vitals); progress 0–1 toward a change. */
  why?: { text: string; progress?: number; moving: boolean }
  /** Demo session: shows the Demo badge. */
  demo?: boolean
  /** Labelled demo fallback only: moon appearance (or the away look), never the actual mood or state. */
  previewMood?: OrbMood | 'away'
}

// ---------------------------------------------------------------------------
// Privacy and settings (stored)
// ---------------------------------------------------------------------------

export type AutoDelete = 30 | 90 | 'never'

/** Consent answers. null = not answered yet. */
export interface PrivacySettings {
  camera: 'yes' | 'not-now' | null
  cameraMode: CameraMode
  face: 'vitals-and-face' | 'vitals-only' | null
  music: 'spotify' | 'none'
  aiScoring: boolean
  telemetry: boolean
  autoDelete: AutoDelete
  /** Set when the onboarding questions were completed. */
  answeredAt: number | null
}

export const DEFAULT_PRIVACY: PrivacySettings = {
  camera: null,
  cameraMode: 'checkins',
  face: null,
  music: 'spotify',
  aiScoring: false,
  telemetry: false,
  autoDelete: 30,
  answeredAt: null
}

export interface AppSettings {
  /** Empty selects the system default camera. Kept locally with its display label. */
  cameraId: string
  cameraLabel: string
  checkinIntervalMin: CheckinIntervalMin
  /** Minimum minutes between nudges. */
  nudgeMinIntervalMin: number
  leaveMusicAlone: boolean
  /** Dev builds only. Absolute path to a test video, or null for the live camera. */
  devVideoSource: string | null
  /** Dev builds only. 0–0.6: fraction of the frame height added as bottom padding. */
  devFramingPad: number
  orbPosition: { x: number; y: number } | null
  /** Advanced: overrides for state engine thresholds, keyed by config name. */
  thresholdOverrides: Record<string, number>
  /** How many times the orb has explained the camera light (first few turn-ons only). */
  cameraTeachCount: number
  musicHelpShown: boolean
  musicStartHelpShown: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  cameraId: '',
  cameraLabel: '',
  checkinIntervalMin: 5,
  nudgeMinIntervalMin: 20,
  leaveMusicAlone: false,
  devVideoSource: null,
  devFramingPad: 0.4,
  orbPosition: null,
  thresholdOverrides: {},
  cameraTeachCount: 0,
  musicHelpShown: false,
  musicStartHelpShown: false
}

// ---------------------------------------------------------------------------
// Main-process event bus
// ---------------------------------------------------------------------------

export interface BusEvents {
  'monitor:diag': CaptureDiagnostics
  'monitor:capture-status': { status: CaptureStatus }
  'monitor:session-change': SessionStatusChange
  'session:started': Session
  'session:ended': SessionSummary
  'session:tick': SessionTick
  'session:status': Session

  'sdk:checkin-started': { phase: Exclude<SensingPhase, 'idle'> }
  'sdk:checkin-ended': { phase: Exclude<SensingPhase, 'idle'> }
  'sdk:metrics': MetricsSnapshot
  'sdk:validation': ValidationEvent
  'sdk:error': SdkError
  /**
   * The SDK died and Ovra is restarting it (active), or it's back (inactive). While active, no
   * away and no windows, like a pause. Giving up is an sdk:error with code 'sdk-lost'.
   */
  'sdk:reconnecting': { active: boolean; message?: string }
  /** Calibration progress, 0–1. starting = waiting for running capture + first frame; framing = clock not started. */
  'sdk:calibration-progress': {
    progress: number
    hint: string | null
    framing?: boolean
    starting?: boolean
  }

  'state:updated': StateUpdate
  /** Baseline built. Payload is only a flag — the baseline itself stays in the state module. */
  'state:baseline-ready': { ok: boolean; reason?: string }

  'music:track-changed': NowPlaying
  'music:target-changed': { target: MusicTarget; word: TargetWord; reason: string }
  'music:status': MusicStatus
  'monitor:music': MusicDecision

  'move:nudge': Nudge
  'move:started': { moveId: MoveId }
  'move:step': MoveStepEvent
  'move:feedback': MoveFeedback
  'move:completed': { moveId: MoveId; verified: boolean }
  'move:snoozed': { moveId: MoveId }
  'move:skipped': { moveId: MoveId }
  /** Full move card view; the windows module forwards it to the move card window. */
  'move:card': MoveCardView

  'break:away': { since: number; manual: boolean }
  'break:returned': { awayMs: number }
  'break:return-check': { result: ReturnCheckResult; message: string }

  'privacy:camera-paused': Record<string, never>
  'privacy:camera-resumed': Record<string, never>
  'privacy:changed': PrivacySettings
  'settings:changed': AppSettings
  /** Emitted by privacy at the end of deleteEverything(). Modules drop in-memory caches (e.g. music library). */
  'data:deleted-all': Record<string, never>

  'orb:bubble': {
    text: string
    ttlMs?: number
    action?: 'show-camera'
    previewMood?: OrbView['previewMood']
  }
}

export type BusEventName = keyof BusEvents

// ---------------------------------------------------------------------------
// Dev simulator (dev builds only; stands in for the camera, never uses the SDK)
// ---------------------------------------------------------------------------

export type SimSpeed = 'instant' | 'fast' | 'normal'

export type SimScenario = 'calm' | 'tense' | 'crashing' | 'low' | 'good' | 'away'

/** Momentary actions for move checks. */
export type SimAction = 'tilt-left' | 'tilt-right' | 'stand-up' | 'breathing-slows'

export interface SimulatorStatus {
  scenario: SimScenario
  fastMode: boolean
  speed: SimSpeed
  target?: MusicTarget | null
  why?: OrbView['why']
  countdown?: string
  state: StateUpdate | null
  targetWord: TargetWord | null
  lastNudge: Nudge | null
  phase: SensingPhase
}

// ---------------------------------------------------------------------------
// IPC: renderer → main (invoke / handle)
// ---------------------------------------------------------------------------

export interface IpcInvoke {
  'privacy:get': { req: void; res: PrivacySettings }
  'privacy:set': { req: Partial<PrivacySettings>; res: PrivacySettings }
  'settings:get': { req: void; res: AppSettings }
  'settings:set': { req: Partial<AppSettings>; res: AppSettings }

  'session:start': { req: SessionConfig; res: Session }
  'session:end': { req: void; res: SessionSummary | null }
  'session:current': { req: void; res: Session | null }
  'session:calibration': { req: { action: CalibrationAction }; res: void }

  'camera:pause': { req: void; res: void }
  'camera:resume': { req: void; res: void }

  'music:status': { req: void; res: MusicStatus }
  'music:library': { req: void; res: { songs: Song[]; playlists: PlaylistLink[] } }
  'music:add-playlist': { req: { url: string }; res: PlaylistLink }
  'music:remove-playlist': { req: { uri: string }; res: void }
  'music:set-leave-alone': { req: { value: boolean }; res: void }
  'music:clear-library': { req: void; res: void }
  'music:rescore': { req: { songId: string }; res: void }

  'move:respond': { req: { nudgeId: string; response: NudgeResponse }; res: void }
  'move:end': { req: void; res: void }
  'break:going': { req: void; res: void }
  'break:back': { req: void; res: void }
  'break:breathe-round': { req: void; res: void }

  'history:list': { req: void; res: SessionRecord[] }
  'history:delete': { req: { id: string }; res: void }
  'data:delete-all': { req: void; res: void }
  /** Opens Ovra's data folder (userData) in Finder / Explorer. */
  'data:show-folder': { req: void; res: void }
  'data:folder': { req: void; res: { path: string; platform: string } }

  'window:open-main': { req: void | { showCamera: true }; res: void }
  'window:orb-moved': { req: { x: number; y: number }; res: void }
  /** Orb window click-through: true while the pointer is over the transparent area. */
  'window:orb-ignore-mouse': { req: { ignore: boolean }; res: void }

  /** Dev builds only: lists files in test-media/. */
  'dev:list-videos': { req: void; res: string[] }
  /** Dev simulator only. */
  'simulator:status': { req: void; res: SimulatorStatus }
  'simulator:set-scenario': { req: { scenario: SimScenario }; res: SimulatorStatus }
  'simulator:action': { req: { action: SimAction }; res: void }
  'simulator:set-speed': { req: { speed: SimSpeed }; res: SimulatorStatus }
  'simulator:switch-music': { req: void; res: void }
  'simulator:set-fast-mode': { req: { value: boolean }; res: SimulatorStatus }
}

export type IpcInvokeChannel = keyof IpcInvoke

// ---------------------------------------------------------------------------
// IPC: main → renderer (push)
// ---------------------------------------------------------------------------

export interface IpcPush {
  /** Main-window visibility and an optional request to open its Session camera preview. */
  'push:main-window': { visible: boolean; showCamera?: boolean }
  'push:session': Session | null
  'push:session-tick': SessionTick
  'push:session-summary': SessionSummary
  'push:calibration': BusEvents['sdk:calibration-progress']
  /** SDK failure (e.g. credits exhausted) so the main window can show a calm fallback message. */
  'push:sdk-error': SdkError
  'push:state': StateUpdate
  'push:orb': OrbView
  'push:music': MusicStatus
  'push:move-card': MoveCardView
  'push:privacy': PrivacySettings
  'push:settings': AppSettings
  /** Dev simulator window only. */
  'push:simulator': SimulatorStatus
  'push:monitor': MonitorSnapshot
  /** Capture window only. */
  'push:capture-start': CaptureStartRequest
  /** Capture window only. */
  'push:capture-stop': Record<string, never>
}

export type IpcPushChannel = keyof IpcPush

// ---------------------------------------------------------------------------
// IPC: capture renderer → main (fire and forget)
// ---------------------------------------------------------------------------

export interface IpcCaptureSend {
  'capture:diag': CaptureDiagnostics
  'capture:metrics': MetricsSnapshot
  'capture:validation': ValidationEvent
  'capture:status': CaptureStatus
  'capture:error': SdkError
}

export type IpcCaptureChannel = keyof IpcCaptureSend

/** Runtime lists for the preload whitelist. Keep in sync with the interfaces above. */
export const IPC_INVOKE_CHANNELS = [
  'privacy:get',
  'privacy:set',
  'settings:get',
  'settings:set',
  'session:start',
  'session:end',
  'session:current',
  'session:calibration',
  'camera:pause',
  'camera:resume',
  'music:status',
  'music:library',
  'music:add-playlist',
  'music:remove-playlist',
  'music:set-leave-alone',
  'music:clear-library',
  'music:rescore',
  'move:respond',
  'move:end',
  'break:going',
  'break:back',
  'break:breathe-round',
  'history:list',
  'history:delete',
  'data:delete-all',
  'data:show-folder',
  'data:folder',
  'window:open-main',
  'window:orb-moved',
  'window:orb-ignore-mouse',
  'dev:list-videos',
  'simulator:status',
  'simulator:set-scenario',
  'simulator:action',
  'simulator:set-fast-mode',
  'simulator:set-speed',
  'simulator:switch-music'
] as const satisfies readonly IpcInvokeChannel[]

export const IPC_PUSH_CHANNELS = [
  'push:main-window',
  'push:session',
  'push:session-tick',
  'push:session-summary',
  'push:calibration',
  'push:sdk-error',
  'push:state',
  'push:orb',
  'push:music',
  'push:move-card',
  'push:privacy',
  'push:settings',
  'push:simulator',
  'push:monitor',
  'push:capture-start',
  'push:capture-stop'
] as const satisfies readonly IpcPushChannel[]

export const IPC_CAPTURE_CHANNELS = [
  'capture:diag',
  'capture:metrics',
  'capture:validation',
  'capture:status',
  'capture:error'
] as const satisfies readonly IpcCaptureChannel[]

/** The API the preload exposes on window.ovra. */
export interface OvraBridge {
  invoke<C extends IpcInvokeChannel>(
    channel: C,
    ...args: IpcInvoke[C]['req'] extends void ? [] : [IpcInvoke[C]['req']]
  ): Promise<IpcInvoke[C]['res']>
  on<C extends IpcPushChannel>(channel: C, cb: (payload: IpcPush[C]) => void): () => void
  /** Capture window only. */
  send<C extends IpcCaptureChannel>(channel: C, payload: IpcCaptureSend[C]): void
  isDev: boolean
}

// ---------------------------------------------------------------------------
// Main-process services (what each module exports; wired together in src/main/app.ts)
// ---------------------------------------------------------------------------

/** Typed bus. Implemented in src/main/bus.ts. */
export interface Bus {
  emit<E extends BusEventName>(event: E, payload: BusEvents[E]): void
  on<E extends BusEventName>(event: E, cb: (payload: BusEvents[E]) => void): () => void
  once<E extends BusEventName>(event: E, cb: (payload: BusEvents[E]) => void): () => void
}

/** src/main/storage — JSON files in userData. */
export interface Storage {
  read<T>(name: StorageFile, fallback: T): Promise<T>
  write<T>(name: StorageFile, data: T): Promise<void>
  remove(name: StorageFile): Promise<void>
}

/** The only files Ovra stores. Nothing else may be written to disk. */
export type StorageFile = 'privacy' | 'settings' | 'sessions' | 'songs' | 'playlists'

/** src/main/privacy */
export interface PrivacyService {
  get(): PrivacySettings
  set(patch: Partial<PrivacySettings>): Promise<PrivacySettings>
  /** True only after the user answered "yes" to the camera question. */
  canUseCamera(): boolean
  /** Throws if canUseCamera() is false. Sensing calls this before any camera code runs. */
  assertCameraConsent(): void
  canUseFace(): boolean
  getSettings(): AppSettings
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  listSessions(): Promise<SessionRecord[]>
  saveSession(record: SessionRecord): Promise<void>
  deleteSession(id: string): Promise<void>
  deleteEverything(): Promise<void>
  /** Delete history older than the chosen period. Runs on start and daily. */
  runAutoDelete(now?: number): Promise<number>
}

/** src/main/sdk */
export interface SensingService {
  startCalibration(): Promise<void>
  /** Check-in mode: run every intervalMin for ~90 s, camera fully off in between. */
  startCheckins(intervalMin: CheckinIntervalMin): void
  startContinuous(): Promise<void>
  startReturnCheck(): Promise<void>
  /** Framing check "Skip": start the calibration clock now. No-op outside the framing check. */
  skipFraming(): void
  /** Stops capture and any schedule. Camera off. */
  stop(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  phase(): SensingPhase
}

/** src/main/state */
export interface StateEngine {
  /** Start a fresh session: clears baseline and timers. */
  reset(): void
  current(): StateUpdate
  diagnostics(): StateDiagnostics
  /** Session ends: drop the baseline from memory. */
  dispose(): void
}

/** src/main/session */
export interface SessionService {
  start(config: SessionConfig): Promise<Session>
  end(source?: SessionEndSource): Promise<SessionSummary | null>
  current(): Session | null
  /** After a failed calibration: run it again, or start without a baseline (it builds in-session). */
  calibrationChoice(action: 'retry' | 'start-anyway'): Promise<void>
}

/** src/main/music */
export interface MusicService {
  status(): MusicStatus
  library(): Promise<{ songs: Song[]; playlists: PlaylistLink[] }>
  addPlaylist(url: string): Promise<PlaylistLink>
  removePlaylist(uri: string): Promise<void>
  setLeaveAlone(value: boolean): void
  clearLibrary(): Promise<void>
  rescore(songId: string): Promise<void>
  /** Called by the session: start/stop picking music. */
  startSession(session: Session): Promise<void>
  stopSession(): Promise<void>
}

/** src/main/windows */
export interface WindowsService {
  showMain(): void
  /** Hide the main window and show the orb (after calibration). */
  showOrb(): void
  hideOrb(): void
  /** Forward bus state to renderers (orb view, move card, session, music). Call once. */
  bindBus(): void
}

/** src/main/moves */
export interface MovesService {
  respond(nudgeId: string, response: NudgeResponse): void
  endMove(): void
  goingAway(): void
  back(): void
  breatheRound(): void
  startSession(session: Session): void
  stopSession(): void
}
