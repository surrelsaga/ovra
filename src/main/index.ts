// Entry point. Normal run: startApp(). Module dev harness: OVRA_HARNESS=<name> (dev only).
import { app } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { loadEnv } from './env'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startApp } from './app'

// Isolate Chromium files too, before Electron creates its default session.
if (!app.isPackaged && process.env.OVRA_HARNESS === 'e2e') {
  const dir = mkdtempSync(join(tmpdir(), 'ovra-e2e-'))
  app.setPath('userData', dir)
  app.setPath('sessionData', join(dir, 'chromium'))
}

const harnesses: Record<string, () => Promise<{ runHarness: () => Promise<void> }>> = {
  e2e: () => import('./e2e/harness'),
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
      const services = await startApp()
      app.on('activate', () => services.windows.showMain())
    }
  } catch (err) {
    console.error('[ovra] startup failed:', err instanceof Error ? err.message : err)
    if (name) app.exit(1)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
