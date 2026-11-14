import {
  TARGET_WORD,
  type Bus,
  type CaptureStatus,
  type MonitorSnapshot,
  type MusicService,
  type SessionService,
  type SensingService,
  type StateEngine
} from '@shared/types'
import { createMonitorCounters } from './aggregate'
import { createRunStats } from './run'

export interface MonitorDeps {
  bus: Bus
  sensing: Pick<SensingService, 'phase'>
  state: Pick<StateEngine, 'current' | 'diagnostics'> & {
    /** Coarse classifier decision for the latest window (signal, rule, hold progress). */
    lastWindow?: () => { n: number; line: string } | null
  }
  session: Pick<SessionService, 'current'>
  music: Pick<MusicService, 'status'>
}

/** Observers only: no commands, storage, sensing starts or music control. */
export function createMonitorModel(
  deps: MonitorDeps,
  log: (line: string) => void = console.log
): { snapshot(): MonitorSnapshot; runLine(): string; dispose(): void } {
  const { bus } = deps
  const counters = createMonitorCounters(Date.now())
  let phase = deps.sensing.phase()
  counters.phase(phase, Date.now())
  let processing = 'unknown'
  let capture: CaptureStatus = 'idle'
  let validation: MonitorSnapshot['validation'] = null
  let lastUpdated: number | null = null
  let lastChange: MonitorSnapshot['session']['lastChange'] = null
  let away = deps.state.current().away
  let loggedValidation: number | null = null
  let loggedWindow = 0
  let run = createRunStats(Date.now())
  const announce = (text: string): void => log(`[monitor] ${text}`)
  const runLine = (): string => `run phase=${phase} ${run.line(Date.now())}`
  const setPhase = (next: typeof phase): void => {
    if (phase === next) return
    if (phase !== 'idle') announce(`${runLine()} (ended)`)
    run = createRunStats(Date.now())
    phase = next
    counters.phase(phase, Date.now())
    if (next !== 'idle') {
      processing = 'unknown'
      validation = null
    }
    announce(`phase=${phase}`)
  }
  const offs = [
    bus.on('monitor:diag', (d) => {
      counters.add(d)
      if (d.phase !== phase) return
      run.diag(d)
      processing = d.processing
      validation = d.validation
    }),
    bus.on('sdk:metrics', (m) => {
      if (phase !== 'idle') run.metrics(m)
    }),
    bus.on('monitor:capture-status', (s) => {
      capture = s.status
    }),
    bus.on('sdk:checkin-started', ({ phase: next }) => setPhase(next)),
    bus.on('sdk:checkin-ended', () => setPhase(deps.sensing.phase())),
    // These are the app's existing debounced validation changes. Raw code counts use capture:diag.
    bus.on('sdk:validation', (v) => {
      if (v.code === loggedValidation) return
      loggedValidation = v.code
      announce(`validation=${v.code} hint=${JSON.stringify(v.hint)}`)
    }),
    bus.on('state:updated', (s) => {
      lastUpdated = s.t
      if (s.away !== away) announce(s.away ? 'away' : 'returned')
      away = s.away
      const w = deps.state.lastWindow?.()
      if (w && w.n !== loggedWindow) announce(`window ${w.line}`)
      loggedWindow = w?.n ?? loggedWindow
    }),
    bus.on('state:baseline-ready', (r) =>
      announce(
        `baseline=${r.ok ? 'built' : 'failed'}${r.reason ? ` reason=${JSON.stringify(r.reason)}` : ''}`
      )
    ),
    bus.on('monitor:session-change', (change) => {
      lastChange = { ...change }
      announce(
        `session=${change.status} reason=${JSON.stringify(change.reason)} source=${JSON.stringify(change.source)}`
      )
    })
  ]
  return {
    snapshot() {
      const now = Date.now()
      const diag = deps.state.diagnostics()
      const state = deps.state.current()
      const current = deps.session.current()
      const music = deps.music.status()
      const secondsSinceFace =
        diag.lastFace === null ? null : Math.max(0, (now - diag.lastFace) / 1000)
      const countdownActive = diag.phase === 'continuous' && !diag.paused && !state.away
      const noFaceSec = Math.max(0, (now - (diag.lastFace ?? diag.phaseStart)) / 1000)
      return {
        t: now,
        phase,
        processing,
        capture,
        validation: validation ? { ...validation } : null,
        ...counters.read(now),
        state: {
          ...diag,
          secondsSinceFace,
          awayCountdownSec: countdownActive ? Math.max(0, diag.awayNoFaceSec - noFaceSec) : null,
          away: state.away,
          situation: state.situation,
          confidence: state.confidence,
          seatedMinutes: state.seatedMinutes,
          lastUpdated
        },
        session: {
          status: current?.status ?? lastChange?.status ?? null,
          remainingSec: current
            ? Math.max(
                0,
                current.config.lengthMin * 60 - Math.floor((now - current.startedAt) / 1000)
              )
            : null,
          lastChange: lastChange ? { ...lastChange } : null
        },
        music: {
          available: music.available,
          name: music.nowPlaying?.name ?? null,
          artist: music.nowPlaying?.artist ?? null,
          target: music.target ? TARGET_WORD[music.target] : null,
          leaveAlone: music.leaveAlone
        }
      }
    },
    runLine,
    dispose: () => offs.forEach((off) => off())
  }
}
