import { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'

export type RendererPage = 'main-window' | 'orb' | 'move-card' | 'capture'
export type PreloadName = 'index' | 'capture'

/** Absolute path to a built preload script. */
export function preloadPath(name: PreloadName): string {
  return join(__dirname, `../preload/${name}.js`)
}

/** Load a renderer page into a window (dev server in dev, built file otherwise). */
export function loadPage(win: BrowserWindow, page: RendererPage): Promise<void> {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) return win.loadURL(`${devUrl}/${page}/index.html`)
  return win.loadFile(join(__dirname, `../renderer/${page}/index.html`))
}

/** Absolute path to the repo's test-media folder (dev only). Override with OVRA_TEST_MEDIA. */
export function testMediaDir(): string {
  return process.env.OVRA_TEST_MEDIA ?? join(process.cwd(), 'test-media')
}
