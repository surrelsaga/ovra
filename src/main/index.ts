// Entry point. Normal run: startApp(). Module dev harness: OVRA_HARNESS=<name> (dev only).
import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { loadEnv } from './env'
import { startApp } from './app'

const harnesses: Record<string, () => Promise<{ runHarness: () => Promise<void> }>> = {
  sensing: () => import('./sdk/harness'),
  shell: () => import('./windows/harness'),
  moves: () => import('./moves/harness')
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.ovra.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  loadEnv()
  const name = process.env.OVRA_HARNESS
  try {
    if (name && !app.isPackaged) {
      const load = harnesses[name]
      if (!load) throw new Error(`Unknown harness "${name}"`)
      await (await load()).runHarness()
    } else {
      await startApp()
    }
  } catch (err) {
    console.error('[ovra] startup failed:', err instanceof Error ? err.message : err)
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !name) void startApp()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
