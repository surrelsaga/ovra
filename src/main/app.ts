// Owner: orchestrator / Phase 3 integration. Wires every module together through the bus.
import { app } from 'electron'
import type { PrivacyService } from '@shared/types'
import type { SensingConfig } from './sdk/config'
import type { MovesConfig } from './moves/config'
import { appConfig } from './config'
import { installQuitHandler } from './quit'
import { createBus } from './bus'
import { getKey } from './env'
import { createStorage } from './storage'
import { createPrivacy, registerPrivacyIpc } from './privacy'
import { createSensing } from './sdk'
import { createStateEngine } from './state'
import { createMusic, registerMusicIpc } from './music'
import { createMusicController } from './music/controller'
import { createMoves, registerMovesIpc } from './moves'
import { createSessionService, registerSessionIpc } from './session'
import { createWindows, registerWindowsIpc } from './windows'

export interface AppOptions {
  background?: boolean
  sensingConfig?: Partial<SensingConfig>
  movesConfig?: MovesConfig
  setup?: (privacy: PrivacyService) => Promise<void>
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- inferred services are also used by the e2e harness
export async function startApp(options: AppOptions = {}) {
  const bus = createBus()
  const storage = createStorage(app.getPath('userData'))
  const privacy = await createPrivacy({ storage, bus })
  await options.setup?.(privacy)
  registerPrivacyIpc(privacy)
  await privacy.runAutoDelete()
  const autoDelete = setInterval(
    () => void privacy.runAutoDelete().catch(console.error),
    appConfig.autoDeleteEveryMs
  )

  const sensing = createSensing({
    bus,
    privacy,
    getApiKey: () => getKey('PRESAGE_API_KEY'),
    config: options.sensingConfig
  })
  const state = createStateEngine({ bus, privacy })
  const music = createMusic({ bus, storage, privacy, controller: createMusicController(), getKey })
  const moves = createMoves({ bus, privacy }, options.movesConfig)
  const session = createSessionService({ bus, privacy, sensing, state, music, moves })
  registerSessionIpc(session, sensing)
  registerMusicIpc(music)
  registerMovesIpc(moves)

  const windows = createWindows({ bus, privacy, background: options.background })
  registerWindowsIpc(windows)
  windows.bindBus()
  windows.showMain()
  const shutdown = async (): Promise<void> => {
    clearInterval(autoDelete)
    await session.end()
    await sensing.stop()
  }
  installQuitHandler(shutdown)
  return { bus, privacy, sensing, state, music, moves, session, windows, shutdown }
}
