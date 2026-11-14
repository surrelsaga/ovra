// Owner: Agent B (state engine + session). Session lifecycle, timer, activity defaults.
import type { SensingService, SessionService } from '@shared/types'
import { handle } from '../ipc'

export { createSessionService, type SessionDeps } from './service'

/** Registers session:* and camera:* IPC handlers. */
export function registerSessionIpc(session: SessionService, sensing: SensingService): void {
  handle('session:start', (config) => session.start(config))
  handle('session:end', () => session.end())
  handle('session:current', () => session.current())
  handle('session:calibration', (req) => {
    // IPC input is untrusted: unknown actions do nothing.
    if (req?.action === 'skip-framing') return sensing.skipFraming()
    if (req?.action === 'retry' || req?.action === 'start-anyway')
      return session.calibrationChoice(req.action)
  })
  handle('camera:pause', () => sensing.pause())
  handle('camera:resume', () => sensing.resume())
}
