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
    music: input.music !== false
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

  const update = (patch: Partial<Session>): void => {
    if (!session) return
    session = { ...session, ...patch }
    bus.emit('session:status', session)
  }
  const setStatus = (status: SessionStatus): void => update({ status })
  const bubble = (text: string): void =>
    bus.emit('orb:bubble', { text, ttlMs: sessionConfig.bubbleTtlMs })
  const warn = (what: string) => (e: unknown) => console.warn(`session: ${what} failed`, e)

  const mood = (t: number, situation: MoodPoint['situation']): void => {
    if (timeline[timeline.length - 1]?.situation !== situation) timeline.push({ t, situation })
  }

  const startSchedule = (s: Session): void => {
    if (s.config.cameraMode === 'checkins') sensing.startCheckins(s.config.checkinIntervalMin)
    else sensing.startContinuous().catch(warn('startContinuous'))
  }

  function listen(): (() => void)[] {
    return [
      bus.on('state:baseline-ready', ({ ok }) => {
        if (session?.status !== 'calibrating') return
        setStatus('running')
        if (!ok) bubble(sessionConfig.baselineFailedBubble)
        startSchedule(session)
      }),
      bus.on('state:updated', (u) => {
        mood(u.t, u.away ? 'away' : (u.situation ?? 'unknown'))
        longestSeated = Math.max(longestSeated, u.seatedMinutes)
      }),
      bus.on('break:away', ({ manual }) => {
        // Continuous mode keeps sensing through breaks (away is detected from the camera).
        if (session?.status !== 'running') return
        setStatus('on-break')
        if (manual && session.sensingEnabled && session.config.cameraMode === 'checkins')
          sensing.stop().catch(warn('stop'))
      }),
      bus.on('break:returned', () => {
        if (session?.status !== 'on-break') return
        setStatus('running')
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
        if (!session || p.camera === 'yes') return
        resumeAfterReturnCheck = false
        update({
          sensingEnabled: false,
          status: session.status === 'calibrating' ? 'running' : session.status
        })
        sensing.stop().catch(warn('stop'))
        state.dispose()
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
    if (remainingSec === 0) void end()
  }

  async function start(input: SessionConfig): Promise<Session> {
    if (session || ending) throw new Error('A session is already running')
    const config = normalizeConfig(input, privacy)
    const sensingEnabled = privacy.canUseCamera()
    session = {
      id: randomUUID(),
      config,
      startedAt: Date.now(),
      status: sensingEnabled ? 'calibrating' : 'running',
      sensingEnabled
    }
    clearRecord()
    resumeAfterReturnCheck = false
    offs = listen()

    bus.emit('session:started', session)
    bus.emit('session:status', session)
    tick = setInterval(onTick, sessionConfig.tickMs)

    // ponytail: music decides from session.config.music whether to play anything.
    music.startSession(session).catch(warn('music.startSession'))
    moves.startSession(session)

    if (sensingEnabled) {
      state.reset()
      try {
        await sensing.resume()
        await sensing.startCalibration()
      } catch (e) {
        warn('startCalibration')(e)
        update({ status: 'running', sensingEnabled: false })
        bubble(sessionConfig.cameraFailedBubble)
      }
    }
    return session
  }

  async function finish(discard: boolean): Promise<SessionRecord | null> {
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
      cameraMode: s.sensingEnabled ? s.config.cameraMode : 'off',
      moodTimeline: timeline,
      moves: moveRecords,
      snoozes: moveRecords.filter((m) => m.outcome === 'snoozed').length,
      longestSeatedMin: Math.floor(longestSeated),
      learnedSongIds: [...songs]
    }
    if (!discard && generation === dataGeneration)
      await privacy.saveSession(record).catch(warn('saveSession'))
    bus.emit('session:status', { ...s, status: 'ended', endedAt })
    if (!discard && generation === dataGeneration) bus.emit('session:ended', record)
    return discard || generation !== dataGeneration ? null : record
  }

  function end(discard = false): Promise<SessionRecord | null> {
    if (ending) return ending
    ending = finish(discard).finally(() => {
      ending = null
    })
    return ending
  }

  bus.on('data:deleted-all', () => {
    dataGeneration++
    void end(true)
  })

  return { start, end, current: () => session }
}
