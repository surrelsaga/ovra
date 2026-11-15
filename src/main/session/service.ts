// Owner: Agent B. Session lifecycle: calibration → running → breaks → end, timer, history record.
import { randomUUID } from 'node:crypto'
import type {
  Activity,
  Bus,
  MovesService,
  MoodPoint,
  MoveRecord,
  MusicService,
  PrivacyService,
  SensingService,
  Session,
  SessionConfig,
  SessionEndSource,
  SessionRecord,
  SessionService,
  SessionStatus,
  StateEngine
} from '@shared/types'
import { sessionConfig } from './config'

export interface SessionDeps {
  bus: Bus
  privacy: PrivacyService
  sensing: SensingService
  state: StateEngine
  music: MusicService
  moves: MovesService
}

const INTERVALS = [3, 5, 10] as const

/** IPC input is untrusted: fill anything missing or invalid from defaults. */
export function normalizeConfig(
  input: Partial<SessionConfig>,
  privacy: PrivacyService
): SessionConfig {
  const activity: Activity =
    input.activity && input.activity in sessionConfig.activityLengthMin
      ? input.activity
      : sessionConfig.defaultActivity
  const len = Number(input.lengthMin)
  return {
    activity,
    lengthMin:
      len > 0 && Number.isFinite(len)
        ? Math.min(len, sessionConfig.maxLengthMin)
        : sessionConfig.activityLengthMin[activity],
    cameraMode:
      input.cameraMode === 'continuous' || input.cameraMode === 'checkins'
        ? input.cameraMode
        : (privacy.get().cameraMode ?? sessionConfig.defaultCameraMode),
    checkinIntervalMin:
      INTERVALS.find((i) => i === input.checkinIntervalMin) ??
      privacy.getSettings().checkinIntervalMin,
    music: input.music !== false,
    ...(input.demo === true && { demo: true })
  }
}

export function createSessionService(deps: SessionDeps): SessionService {
  const { bus, privacy, sensing, state, music, moves } = deps
  let session: Session | null = null
  let timeline: MoodPoint[] = []
  let moveRecords: MoveRecord[] = []
  let longestSeated = 0
  let songs = new Set<string>()
  let offs: (() => void)[] = []
  let tick: ReturnType<typeof setInterval> | undefined
  let resumeAfterReturnCheck = false
  let ending: Promise<SessionRecord | null> | null = null
  let dataGeneration = 0
  let recordCameraMode: SessionRecord['cameraMode'] = 'off'
  /** The SDK is down or gave up: a failed calibration shows this instead of the readings bar. */
  let sdkTrouble: string | null = null

  const announceStatus = (status: SessionStatus, reason: string, source: string): void =>
    bus.emit('monitor:session-change', { t: Date.now(), status, reason, source })
  const update = (patch: Partial<Session>, reason: string, source: string): void => {
    if (!session) return
    const previous = session.status
    const next = { ...session, ...patch }
    session = next
    bus.emit('session:status', next)
    if (previous !== next.status) announceStatus(next.status, reason, source)
  }
  const setStatus = (status: SessionStatus, reason: string, source: string): void =>
    update({ status }, reason, source)
  const bubble = (text: string): void =>
    bus.emit('orb:bubble', { text, ttlMs: sessionConfig.bubbleTtlMs })
  const warn = (what: string) => (e: unknown) => console.warn(`session: ${what} failed`, e)

  const disableSensing = (reason: string, source: string): void => {
    if (!session?.sensingEnabled) return
    resumeAfterReturnCheck = false
    update(
      {
        sensingEnabled: false,
        status: session.status === 'calibrating' ? 'running' : session.status
      },
      reason,
      source
    )
    sensing.stop().catch(warn('stop'))
    state.dispose()
  }

  const mood = (t: number, situation: MoodPoint['situation']): void => {
    if (timeline[timeline.length - 1]?.situation !== situation) timeline.push({ t, situation })
  }

  const startSchedule = (s: Session): void => {
    if (s.config.cameraMode === 'checkins') sensing.startCheckins(s.config.checkinIntervalMin)
    else sensing.startContinuous().catch(warn('startContinuous'))
  }

  function listen(): (() => void)[] {
    return [
      bus.on('state:baseline-ready', ({ ok, reason }) => {
        if (session?.status !== 'calibrating') return
        // Never run blind: wait for Try again or Start anyway on the calibration screen.
        if (!ok)
          return update(
            sdkTrouble
              ? { calibrationFailed: sdkTrouble, calibrationSdkFailed: true }
              : { calibrationFailed: reason ?? "I couldn't get a steady read." },
            'baseline failed',
            'state:baseline-ready'
          )
        setStatus('running', 'baseline built', 'state:baseline-ready')
        startSchedule(session)
      }),
      bus.on('state:updated', (u) => {
        mood(u.t, u.away ? 'away' : (u.situation ?? 'unknown'))
        longestSeated = Math.max(longestSeated, u.seatedMinutes)
      }),
      bus.on('break:away', ({ manual }) => {
        // Continuous mode keeps sensing through breaks (away is detected from the camera).
        if (session?.status !== 'running') return
        setStatus('on-break', manual ? 'manual break' : 'away detected', 'break:away')
        if (manual && session.sensingEnabled && session.config.cameraMode === 'checkins')
          sensing.stop().catch(warn('stop'))
      }),
      bus.on('break:returned', () => {
        if (session?.status !== 'on-break') return
        setStatus('running', 'returned', 'break:returned')
        if (!session.sensingEnabled) return
        resumeAfterReturnCheck = true
        sensing.startReturnCheck().catch((e) => {
          warn('startReturnCheck')(e)
          resumeAfterReturnCheck = false
          if (session) startSchedule(session)
        })
      }),
      bus.on('sdk:checkin-ended', ({ phase }) => {
        if (phase !== 'return-check' || !resumeAfterReturnCheck || !session) return
        resumeAfterReturnCheck = false
        startSchedule(session)
      }),
      bus.on('move:completed', ({ moveId }) =>
        moveRecords.push({ t: Date.now(), moveId, outcome: 'done' })
      ),
      bus.on('move:snoozed', ({ moveId }) =>
        moveRecords.push({ t: Date.now(), moveId, outcome: 'snoozed' })
      ),
      bus.on('move:skipped', ({ moveId }) =>
        moveRecords.push({ t: Date.now(), moveId, outcome: 'skipped' })
      ),
      bus.on('music:track-changed', (t) => {
        if (!t.isAd && t.id) songs.add(t.id)
      }),
      bus.on('privacy:changed', (p) => {
        if (p.camera !== 'yes') disableSensing('camera consent withdrawn', 'privacy:changed')
      }),
      bus.on('sdk:reconnecting', ({ active, message }) => {
        sdkTrouble = active ? (message ?? null) : null
      }),
      bus.on('sdk:error', (error) => {
        if (!session?.sensingEnabled || error.retryable) return
        if (error.code === 'sdk-lost') {
          sdkTrouble = error.message
          // Calibration shows the reason with Try again (sensing ends the phase itself).
          if (session.status === 'calibrating') return
          disableSensing('sensing lost', 'sdk:error')
          return bubble(`${error.message} ${sessionConfig.carryOnBubble}`)
        }
        disableSensing('sensing unavailable', 'sdk:error')
        bubble(sessionConfig.cameraFailedBubble)
      })
    ]
  }

  function clearRecord(): void {
    timeline = []
    moveRecords = []
    longestSeated = 0
    songs = new Set()
  }

  function onTick(): void {
    if (!session) return
    const elapsedSec = Math.floor((Date.now() - session.startedAt) / 1000)
    const remainingSec = Math.max(0, session.config.lengthMin * 60 - elapsedSec)
    bus.emit('session:tick', { sessionId: session.id, elapsedSec, remainingSec })
    if (remainingSec === 0) void end('length elapsed')
  }

  /** Calibration, or the camera-failed fallback if sensing can't start. */
  async function calibrate(): Promise<void> {
    sdkTrouble = null
    try {
      await sensing.resume()
      await sensing.startCalibration()
    } catch (e) {
      warn('startCalibration')(e)
      recordCameraMode = 'off'
      disableSensing('sensing unavailable', 'startCalibration')
      bubble(sessionConfig.cameraFailedBubble)
    }
  }

  async function calibrationChoice(action: 'retry' | 'start-anyway'): Promise<void> {
    const s = session
    if (s?.status !== 'calibrating' || !s.calibrationFailed) return
    if (action === 'start-anyway') {
      update(
        { status: 'running', calibrationFailed: undefined, calibrationSdkFailed: undefined },
        'start anyway',
        'ipc/user'
      )
      bubble(sessionConfig.startAnywayBubble)
      return startSchedule(s)
    }
    update(
      { calibrationFailed: undefined, calibrationSdkFailed: undefined },
      'calibration retry',
      'ipc/user'
    )
    state.reset()
    await calibrate()
  }

  async function start(input: SessionConfig): Promise<Session> {
    if (session || ending) throw new Error('A session is already running')
    const config = normalizeConfig(input, privacy)
    const sensingEnabled = privacy.canUseCamera()
    recordCameraMode = sensingEnabled ? config.cameraMode : 'off'
    session = {
      id: randomUUID(),
      config,
      startedAt: Date.now(),
      status: sensingEnabled ? 'calibrating' : 'running',
      sensingEnabled
    }
    clearRecord()
    resumeAfterReturnCheck = false
    sdkTrouble = null
    offs = listen()

    bus.emit('session:started', session)
    bus.emit('session:status', session)
    announceStatus(session.status, 'session started', 'session:start')
    tick = setInterval(onTick, sessionConfig.tickMs)

    // ponytail: music decides from session.config.music whether to play anything.
    music.startSession(session).catch(warn('music.startSession'))
    moves.startSession(session)

    if (sensingEnabled) {
      state.reset()
      await calibrate()
    }
    return session
  }

  async function finish(discard: boolean, source: SessionEndSource): Promise<SessionRecord | null> {
    const s = session
    if (!s) return null
    session = null
    clearInterval(tick)
    offs.forEach((off) => off())
    offs = []
    const endedAt = Date.now()
    const generation = dataGeneration

    // Camera off first; one module failing to stop must not lose the record.
    await Promise.allSettled([
      sensing.stop(),
      music.stopSession(),
      Promise.resolve().then(() => moves.stopSession())
    ])
    state.dispose()

    const record: SessionRecord = {
      id: s.id,
      activity: s.config.activity,
      startedAt: s.startedAt,
      endedAt,
      lengthMin: s.config.lengthMin,
      cameraMode: recordCameraMode,
      moodTimeline: timeline,
      moves: moveRecords,
      snoozes: moveRecords.filter((m) => m.outcome === 'snoozed').length,
      longestSeatedMin: Math.floor(longestSeated),
      learnedSongIds: [...songs]
    }
    if (!discard && generation === dataGeneration)
      await privacy.saveSession(record).catch(warn('saveSession'))
    bus.emit('session:status', { ...s, status: 'ended', endedAt })
    announceStatus('ended', 'session ended', source)
    if (!discard && generation === dataGeneration) bus.emit('session:ended', record)
    return discard || generation !== dataGeneration ? null : record
  }

  function end(
    source: SessionEndSource = 'ipc/user',
    discard = false
  ): Promise<SessionRecord | null> {
    if (ending) return ending
    ending = finish(discard, source).finally(() => {
      ending = null
    })
    return ending
  }

  bus.on('data:deleted-all', () => {
    dataGeneration++
    clearRecord()
    void end('delete-all', true)
  })

  return { start, end, current: () => session, calibrationChoice }
}
