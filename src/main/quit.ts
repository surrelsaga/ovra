import { app } from 'electron'
import { appConfig } from './config'

/** Keep Electron's event loop alive until camera/native teardown and history writes settle. */
export function installQuitHandler(cleanup: () => Promise<void>): void {
  let ready = false
  let stopping = false
  app.on('before-quit', (event) => {
    if (ready) return
    event.preventDefault()
    if (stopping) return
    stopping = true
    const timeout = setTimeout(() => {
      console.error('[ovra] shutdown timed out; forcing exit')
      app.exit(1)
    }, appConfig.quitTimeoutMs)
    void cleanup()
      .then(() => {
        clearTimeout(timeout)
        ready = true
        app.quit()
      })
      .catch((err) => {
        clearTimeout(timeout)
        console.error(
          '[ovra] shutdown failed:',
          err instanceof Error ? err.message : 'cleanup failed'
        )
        app.exit(1)
      })
  })
}
