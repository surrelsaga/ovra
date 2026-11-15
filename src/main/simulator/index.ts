// Dev simulator (`npm run dev:simulate`): the real app with a fake sensing service and a control
// window. Dev builds only; never loads the SmartSpectra SDK.
import { app, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'
import {
  TARGET_WORD,
  type Activity,
  type AppSettings,
  type SimulatorStatus,
  type SimSpeed,
  type CameraMode,
  type MusicTarget
} from '@shared/types'
import { startApp } from '../app'
import { broadcast, handle, push } from '../ipc'
import { preloadPath } from '../paths'
import { MOVES_CONFIG, type MovesConfig } from '../moves/config'
import { musicConfig } from '../music/config'
import { desiredTarget, type TargetGap } from '../music/selector'
import { simulatorMovesConfig, simConfig as cfg } from './config'
import { countdown, MOOD_LABEL, SCENARIO_LABEL, MUSIC_LABEL } from './display'
import { resolveConfig } from '../state/config'
import { createSimulatedSensing, type SimulatedSensing } from './sensing'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- same services as startApp
export async function startSimulator() {
  if (app.isPackaged) throw new Error('The simulator is dev only')
  let speed: SimSpeed = cfg.defaultSpeed
  let sim: SimulatedSensing | null = null
  // createMoves keeps this object; fast mode swaps its contents.
  const moves: MovesConfig = { ...simulatorMovesConfig(speed) }
  const musicGap: TargetGap = { ...cfg[speed].musicTargetGap }
  // Simulator settings live in memory only, so nothing is left behind in settings.json. The dev
  // video keeps the calibration screen from opening the live camera for its preview.
  const overlay: Partial<AppSettings> = { devVideoSource: cfg.noCameraVideo }

  const services = await startApp({
    movesConfig: moves,
    musicTargetGap: musicGap,
    settingsOverlay: overlay,
    privacyOverlay: { cameraMode: 'continuous' },
    createSensing: ({ bus, privacy }) =>
      (sim = createSimulatedSensing(bus, privacy, () =>
        speed === 'normal' ? cfg.normalTiming : cfg[speed].timing
      )),
    setup: async (privacy) => applySpeed(privacy, cfg.defaultSpeed)
  })
  const { bus, privacy } = services
  const sensing = sim as unknown as SimulatedSensing

  function applySpeed(p: typeof privacy, next: SimSpeed): void {
    speed = next
    Object.assign(moves, next === 'normal' ? MOVES_CONFIG : simulatorMovesConfig(next))
    const gap = next === 'normal' ? musicConfig.switching : cfg[next].musicTargetGap
    musicGap.minTargetChangeMs = gap.minTargetChangeMs
    delete overlay.nudgeMinIntervalMin
    delete overlay.thresholdOverrides
    if (next === 'normal') return
    overlay.nudgeMinIntervalMin = cfg[next].nudgeMinIntervalMin
    overlay.thresholdOverrides = { ...p.getSettings().thresholdOverrides, ...cfg[next].thresholds }
  }

  let state: SimulatorStatus['state'] = null
  let musicTarget: MusicTarget | null = null
  let activity: Activity = 'focus'
  let cameraMode: CameraMode = 'continuous'
  let remainingSec: number | undefined
  let lastNudge: SimulatorStatus['lastNudge'] = null
  const target = (): MusicTarget | null =>
    musicTarget ??
    (state ? desiredTarget({ situation: state.situation, activity, remainingSec }) : null)
  const status = (): SimulatorStatus => ({
    target: target(),
    scenario: sensing.scenario(),
    fastMode: speed !== 'normal',
    speed,
    why: services.state.why(),
    countdown:
      sensing.phase() === 'idle'
        ? undefined
        : countdown(
            state,
            services.state.why(),
            cameraMode,
            resolveConfig(privacy.getSettings().thresholdOverrides)
          ),
    state,
    // Music's own decision when it's playing; otherwise what it would pick (music off or "none").
    targetWord: target() ? TARGET_WORD[target()!] : null,
    lastNudge,
    phase: sensing.phase()
  })

  const win = new BrowserWindow({
    ...cfg.panel,
    title: 'Ovra simulator',
    alwaysOnTop: true,
    backgroundColor: '#0b0c0f',
    webPreferences: { preload: preloadPath('index'), contextIsolation: true, sandbox: true }
  })
  win.setAlwaysOnTop(true, 'floating')
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  void (is.dev && devUrl
    ? win.loadURL(`${devUrl}/simulator/index.html`)
    : win.loadFile(join(__dirname, '../renderer/simulator/index.html')))

  let last = ''
  const announce = (): void => {
    const s = status()
    push(win, 'push:simulator', s)
    const line =
      `phase=${s.phase} scenario=${SCENARIO_LABEL[s.scenario]} mood=${s.state?.away ? MOOD_LABEL.away : s.state?.situation ? MOOD_LABEL[s.state.situation] : '-'}` +
      ` away=${s.state?.away ?? false} orb=${s.state?.away ? MOOD_LABEL.away : s.state?.situation ? MOOD_LABEL[s.state.situation] : '-'}` +
      ` target=${s.target ? MUSIC_LABEL[s.target] : '-'}`
    if (line !== last) console.log(`[sim] ${line}`)
    last = line
  }

  handle('simulator:status', status)
  handle('simulator:set-scenario', ({ scenario }) => {
    sensing.setScenario(scenario)
    announce()
    return status()
  })
  handle('simulator:action', ({ action }) => {
    sensing.action(action)
    console.log(`[sim] action ${action}`)
  })
  handle('simulator:set-fast-mode', async ({ value }) => {
    applySpeed(privacy, value ? 'fast' : 'normal')
    broadcast('push:settings', privacy.getSettings())
    announce()
    return status()
  })

  handle('simulator:set-speed', ({ speed: next }) => {
    if (!['instant', 'fast', 'normal'].includes(next)) throw new Error('Unknown simulator speed')
    applySpeed(privacy, next)
    broadcast('push:settings', privacy.getSettings())
    announce()
    return status()
  })
  handle('simulator:switch-music', () => services.music.switchNow())
  const statusTimer = setInterval(announce, cfg.statusMs)
  win.on('closed', () => clearInterval(statusTimer))

  bus.on('session:started', (s) => {
    // Simulator speed owns the waits even when the session's Demo hints are enabled.
    applySpeed(privacy, speed)
    activity = s.config.activity
    cameraMode = s.config.cameraMode
    state = null
    musicTarget = null
    lastNudge = null
    announce()
  })
  bus.on('session:tick', (t) => (remainingSec = t.remainingSec))
  bus.on('state:updated', (s) => {
    state = s
    announce()
  })
  bus.on('music:status', (m) => {
    musicTarget = m.target
    announce()
  })
  bus.on('music:target-changed', (t) => {
    musicTarget = t.target
    announce()
  })
  bus.on('move:nudge', (n) => {
    lastNudge = n
    console.log(`[sim] nudge ${n.moveId}: ${n.message}`)
    announce()
  })
  bus.on('move:feedback', (f) => console.log(`[sim] move feedback ${f.moveId}: ${f.message}`))
  bus.on('break:return-check', (r) => console.log(`[sim] return check ${r.result}: ${r.message}`))
  bus.on('sdk:checkin-started', announce)
  bus.on('sdk:checkin-ended', announce)
  bus.on('privacy:camera-paused', announce)
  bus.on('privacy:camera-resumed', announce)

  return services
}
