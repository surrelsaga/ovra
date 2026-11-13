import type { MonitorDeps } from './model'

const h = vi.hoisted(() => ({ packaged: false, window: vi.fn() }))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return h.packaged
    }
  },
  BrowserWindow: h.window
}))
vi.mock('../ipc', () => ({ push: vi.fn() }))
vi.mock('../paths', () => ({ loadPage: vi.fn(), preloadPath: vi.fn() }))
import { startMonitor } from '.'

it('ignores the monitor flag in packaged apps and stays off without the flag', () => {
  const deps = {} as MonitorDeps
  try {
    h.packaged = true
    vi.stubEnv('OVRA_MONITOR', '1')
    expect(startMonitor(deps)).toBeNull()
    h.packaged = false
    vi.stubEnv('OVRA_MONITOR', '')
    expect(startMonitor(deps)).toBeNull()
    expect(h.window).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllEnvs()
  }
})
