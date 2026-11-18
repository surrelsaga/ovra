// Owner: orchestrator / Phase 3 integration. Wires every module together through the bus.
import { app, session as electronSession, shell } from 'electron'
import type {
  AppSettings,
  Bus,
  PrivacyService,
  PrivacySettings,
  SensingService
} from '@shared/types'
import { sensingConfig, type SensingConfig } from './sdk/config'
import { MOVES_CONFIG, type MovesConfig } from './moves/config'
import { musicConfig } from './music/config'
import type { TargetGap } from './music/selector'
import { appConfig } from './config'
import { installQuitHandler } from './quit'
import { createBus } from './bus'
import { getKey } from './env'
import { createStorage, restrictPermissions } from './storage'
import { createPrivacy, registerPrivacyIpc } from './privacy'
import { clearSdkCache } from './privacy/sdk-cache'
import { createStateEngine } from './state'
import { createMusic, registerMusicIpc } from './music'
import { createMusicController } from './music/controller'
import { createMoves, registerMovesIpc } from './moves'
import { createSessionService, registerSessionIpc } from './session'
import { bindDemo } from './session/demo'
import { createWindows, registerWindowsIpc } from './windows'
import { startMonitor } from './monitor'

export interface AppOptions {
  background?: boolean
  sensingConfig?: Partial<SensingConfig>
  movesConfig?: MovesConfig
  /** Dev simulator: shorter music target-change gap. */
  musicTargetGap?: TargetGap
  /** Dev simulator: settings read over the stored ones, never written (see createPrivacy). */
  settingsOverlay?: Partial<AppSettings>
  privacyOverlay?: Partial<Pick<PrivacySettings, 'cameraMode'>>
  setup?: (privacy: PrivacyService) => Promise<void>
  /** Dev simulator: replaces the SDK sensing service (the SDK is then never loaded). */
  createSensing?: (deps: { bus: Bus; privacy: PrivacyService }) => SensingService
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- inferred services are also used by the e2e harness
export async function startApp(options: AppOptions = {}) {
  const bus = createBus()
  const dataDir = app.getPath('userData')
  await restrictPermissions(dataDir).catch(console.error)
  const storage = createStorage(dataDir)
  // Live config objects; demo mode changes them in place for one session (never written to disk).
  const overlay = options.settingsOverlay ?? {}
  const sensingCfg = { ...sensingConfig, ...options.sensingConfig }
  const movesCfg = options.movesConfig ?? { ...MOVES_CONFIG }
  const musicGap = options.musicTargetGap ?? { ...musicConfig.switching }
  const privacy = await createPrivacy({
    storage,
    bus,
    settingsOverlay: overlay,
    privacyOverlay: options.privacyOverlay,
    clearSdkCache: async () => {
      await sensing.stop()
      // @ts-expect-error Electron supports cache at runtime (the SDK uses it), but its path types omit it.
      const cacheRoot: string = app.getPath('cache')
      await clearSdkCache(cacheRoot, app.getName(), process.platform)
    },
    // Chromium's own files in userData (cookies, local/session storage, caches). The capture window's
    // session is in-memory only, so it leaves nothing on disk.
    clearBrowserData: async () => {
      const ses = electronSession.defaultSession
      await Promise.all([ses.clearStorageData(), ses.clearCache()])
    }
  })
  await options.setup?.(privacy)
  registerPrivacyIpc(privacy, () => shell.openPath(dataDir), {
    path: dataDir,
    platform: process.platform
  })
  await privacy.runAutoDelete()
  const autoDelete = setInterval(
    () => void privacy.runAutoDelete().catch(console.error),
    appConfig.autoDeleteEveryMs
  )

  const sensing =
    options.createSensing?.({ bus, privacy }) ??
    (await import('./sdk')).createSensing({
      bus,
      privacy,
      getApiKey: () => getKey('PRESAGE_API_KEY'),
      config: sensingCfg
    })
  const state = createStateEngine({ bus, privacy })
  const music = createMusic({
    bus,
    storage,
    privacy,
    controller: createMusicController(),
    getKey,
    targetGap: musicGap
  })
  const moves = createMoves({ bus, privacy }, movesCfg)
  bindDemo({
    bus,
    privacy,
    overlay,
    moves: movesCfg,
    musicGap,
    sensing: sensingCfg,
    music,
    cards: moves
  })
  const session = createSessionService({ bus, privacy, sensing, state, music, moves })
  startMonitor({ bus, sensing, state, session, music })
  registerSessionIpc(session, sensing)
  registerMusicIpc(music)
  registerMovesIpc(moves)

  const windows = createWindows({ bus, privacy, background: options.background, why: state.why })
  registerWindowsIpc(windows)
  windows.bindBus()
  windows.showMain()
  const shutdown = async (): Promise<void> => {
    clearInterval(autoDelete)
    await session.end('quit')
    await sensing.stop()
  }
  installQuitHandler(shutdown)
  return { bus, privacy, sensing, state, music, moves, session, windows, shutdown }
}
