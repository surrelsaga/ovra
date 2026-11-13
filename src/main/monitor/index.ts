import { app, BrowserWindow } from 'electron'
import { monitorConfig as cfg } from '@shared/monitor-config'
import { push } from '../ipc'
import { loadPage, preloadPath } from '../paths'
import { createMonitorModel, type MonitorDeps } from './model'
import { formatMonitor } from './format'

export function startMonitor(deps: MonitorDeps): BrowserWindow | null {
  if (app.isPackaged || process.env.OVRA_MONITOR !== '1') return null
  const model = createMonitorModel(deps)
  const win = new BrowserWindow({
    width: cfg.width,
    height: cfg.height,
    minWidth: cfg.minWidth,
    minHeight: cfg.minHeight,
    title: 'Sensing monitor',
    alwaysOnTop: true,
    backgroundColor: '#0b0c0f',
    webPreferences: {
      preload: preloadPath('index'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  win.setAlwaysOnTop(true, 'floating')
  let lastLogAt = Date.now()
  const refresh = (): void => {
    const snapshot = model.snapshot()
    push(win, 'push:monitor', snapshot)
    if (snapshot.t - lastLogAt >= cfg.logEveryMs) {
      console.log(formatMonitor(snapshot))
      lastLogAt = snapshot.t
    }
  }
  win.webContents.on('did-finish-load', refresh)
  const timer = setInterval(refresh, cfg.updateMs)
  win.on('closed', () => {
    clearInterval(timer)
    model.dispose()
  })
  void loadPage(win, 'monitor').catch(() => {
    console.warn('[monitor] diagnostics window could not load')
    if (!win.isDestroyed()) win.destroy()
  })
  return win
}
