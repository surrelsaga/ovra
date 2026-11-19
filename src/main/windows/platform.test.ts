import { createBus } from '../bus'
import type { PrivacyService } from '@shared/types'
import { createWindows } from './index'

const h = vi.hoisted(() => ({ windows: [] as WindowMock[], quit: vi.fn() }))
interface WindowMock {
  options: Electron.BrowserWindowConstructorOptions
  events: Record<string, (event: { preventDefault: () => void }) => void>
  hide: ReturnType<typeof vi.fn>
}
vi.mock('electron', () => ({
  app: { on: vi.fn(), quit: h.quit },
  protocol: { registerSchemesAsPrivileged: vi.fn() },
  session: {
    defaultSession: {
      protocol: { handle: vi.fn() },
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn()
    }
  },
  screen: {
    getPrimaryDisplay: () => ({
      workAreaSize: { width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1080 }
    }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })
  },
  BrowserWindow: vi.fn(function (options: Electron.BrowserWindowConstructorOptions) {
    const win = {
      options,
      events: {},
      webContents: { id: h.windows.length, on: vi.fn() },
      on: (name: string, callback: WindowMock['events'][string]) => (win.events[name] = callback),
      hide: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      isMinimized: () => false,
      setAlwaysOnTop: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn()
    }
    h.windows.push(win)
    return win
  })
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../paths', () => ({
  loadPage: async () => {},
  preloadPath: () => '',
  testMediaDir: () => ''
}))

afterEach(() => {
  vi.unstubAllGlobals()
  h.windows.length = 0
  h.quit.mockClear()
})

it.each(['win32', 'darwin'])('uses %s window chrome and a reachable close action', (platform) => {
  vi.stubGlobal('process', { ...process, platform })
  const privacy = { getSettings: () => ({}) } as PrivacyService
  createWindows({ bus: createBus(), privacy }).showMain()
  const main = h.windows[0]
  expect(main.options.titleBarStyle).toBe(platform === 'darwin' ? 'hiddenInset' : 'default')
  const preventDefault = vi.fn()
  main.events.close({ preventDefault })
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(h.quit).toHaveBeenCalledTimes(platform === 'darwin' ? 0 : 1)
  expect(main.hide).toHaveBeenCalledTimes(platform === 'darwin' ? 1 : 0)
})
