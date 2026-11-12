// Owner: orchestrator / Phase 3 integration. Wires every module together through the bus.
import { app } from 'electron'
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

const DAY_MS = 24 * 60 * 60 * 1000

export async function startApp(): Promise<void> {
  const bus = createBus()
  const storage = createStorage(app.getPath('userData'))
  const privacy = await createPrivacy({ storage, bus })
  registerPrivacyIpc(privacy)
  await privacy.runAutoDelete()
  setInterval(() => void privacy.runAutoDelete(), DAY_MS)

  const sensing = createSensing({ bus, privacy, getApiKey: () => getKey('PRESAGE_API_KEY') })
  const state = createStateEngine({ bus, privacy })
  const music = createMusic({ bus, storage, privacy, controller: createMusicController(), getKey })
  const moves = createMoves({ bus, privacy })
  const session = createSessionService({ bus, privacy, sensing, state, music, moves })
  registerSessionIpc(session, sensing)
  registerMusicIpc(music)
  registerMovesIpc(moves)

  const windows = createWindows({ bus, privacy })
  registerWindowsIpc(windows)
  windows.bindBus()
  windows.showMain()
}
