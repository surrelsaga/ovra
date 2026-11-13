// Dev simulator (`npm run dev:simulate`): the real app with a fake sensing service and a control
// window. Dev builds only; never loads the SmartSpectra SDK.
import { app, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  ORB_MOOD,
  TARGET_WORD,
  type Activity,
  type AppSettings,
  type SimulatorStatus,
  type TargetWord
} from '@shared/types'
import { startApp } from '../app'
import { handle, push } from '../ipc'
import { preloadPath } from '../paths'
import { installQuitHandler } from '../quit'
import { MOVES_CONFIG, type MovesConfig } from '../moves/config'
import { musicConfig } from '../music/config'
import { desiredTarget, type TargetGap } from '../music/selector'
import { fastMovesConfig, simConfig as cfg } from './config'
import { createSimulatedSensing, type SimulatedSensing } from './sensing'

type Restorable = Pick<AppSettings, 'nudgeMinIntervalMin' | 'thresholdOverrides' | 'devVideoSource'>

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- same services as startApp
export async function startSimulator() {
  if (app.isPackaged) throw new Error('The simulator is dev only')
  let fastMode = true
  let sim: SimulatedSensing | null = null
  // createMoves keeps this object; fast mode swaps its contents.
  const moves: MovesConfig = { ...fastMovesConfig }
  const musicGap: TargetGap = { ...cfg.fast.musicTargetGap }
  let mine: Restorable | null = null

  const services = await startApp({
    movesConfig: moves,
    musicTargetGap: musicGap,
    createSensing: ({ bus, privacy }) =>
      (sim = createSimulatedSensing(bus, privacy, () =>
        fastMode ? cfg.fast.timing : cfg.normalTiming
      )),
    setup: async (privacy) => {
      const s = privacy.getSettings()
      // A crashed run left our values behind; the user's own can't be known, so fall back to defaults.
      const leftover = s.devVideoSource === cfg.noCameraVideo
      if (leftover) console.warn('[sim] previous run did not restore settings; using defaults')
      const from = leftover ? DEFAULT_SETTINGS : s
      mine = {
        nudgeMinIntervalMin: from.nudgeMinIntervalMin,
        thresholdOverrides: from.thresholdOverrides,
        devVideoSource: from.devVideoSource
      }
      await applyFast(privacy, true)
    }
  })
  const { bus, privacy } = services
  const sensing = sim as unknown as SimulatedSensing

  async function applyFast(p: typeof privacy, on: boolean): Promise<void> {
    fastMode = on
    Object.assign(moves, on ? fastMovesConfig : MOVES_CONFIG)
    const gap = on ? cfg.fast.musicTargetGap : musicConfig.switching
    musicGap.minTargetChangeMs = gap.minTargetChangeMs
    musicGap.downtimeChangeMultiplier = gap.downtimeChangeMultiplier
    await p.setSettings({
      devVideoSource: cfg.noCameraVideo,
      nudgeMinIntervalMin: on ? cfg.fast.nudgeMinIntervalMin : mine!.nudgeMinIntervalMin,
      thresholdOverrides: on
        ? { ...mine!.thresholdOverrides, ...cfg.fast.thresholds }
        : mine!.thresholdOverrides
    })
  }
  // Put the user's own settings back on quit (runs alongside the app's own shutdown).
  installQuitHandler(async () => {
    if (mine) await privacy.setSettings(mine)
  })

  let state: SimulatorStatus['state'] = null
  let musicWord: TargetWord | null = null
  let activity: Activity = 'deep-work'
  let remainingSec: number | undefined
  let lastNudge: SimulatorStatus['lastNudge'] = null
  const status = (): SimulatorStatus => ({
    scenario: sensing.scenario(),
    fastMode,
    state,
    // Music's own decision when it's playing; otherwise what it would pick (music off or "none").
    targetWord:
      musicWord ??
      (state
        ? TARGET_WORD[desiredTarget({ situation: state.situation, activity, remainingSec })]
        : null),
    lastNudge,
    phase: sensing.phase()
  })

  const win = new BrowserWindow({
    width: 360,
    height: 720,
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
      `phase=${s.phase} scenario=${s.scenario} situation=${s.state?.situation ?? '-'}` +
      ` away=${s.state?.away ?? false} orb=${s.state?.situation ? ORB_MOOD[s.state.situation] : '-'}` +
      ` target=${s.targetWord ?? '-'}`
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
    await applyFast(privacy, value)
    announce()
    return status()
  })

  bus.on('session:started', (s) => {
    activity = s.config.activity
    state = null
    musicWord = null
    lastNudge = null
    announce()
  })
  bus.on('session:tick', (t) => (remainingSec = t.remainingSec))
  bus.on('state:updated', (s) => {
    state = s
    announce()
  })
  bus.on('music:status', (m) => {
    musicWord = m.target ? TARGET_WORD[m.target] : null
    announce()
  })
  bus.on('music:target-changed', (t) => {
    musicWord = t.word
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
