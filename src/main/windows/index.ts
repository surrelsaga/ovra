// Owner: Agent E (orb + shell). Main window, orb window, move card window; forwards bus state to renderers.
import { app, BrowserWindow, net, protocol, screen, session, type Rectangle } from 'electron'
import { is } from '@electron-toolkit/utils'
import { readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Bus, MoveCardView, PrivacyService, WindowsService } from '@shared/types'
import { handle, push } from '../ipc'
import { loadPage, preloadPath, testMediaDir } from '../paths'
import { windowsConfig as cfg } from './config'
import { bindForwarding, type Forwarder } from './forward'
import { canGrantPreviewPermission } from './preview-permission'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ovra-preview',
    privileges: {
      standard: true,
      secure: true,
      corsEnabled: true,
      supportFetchAPI: true,
      stream: true
    }
  }
])

export interface WindowsDeps {
  bus: Bus
  privacy: PrivacyService
  /** E2e runs keep the real renderers loaded without taking desktop focus. */
  background?: boolean
}

/** WindowsService plus the bits the IPC handlers and the harness need. */
export interface ShellWindows extends WindowsService {
  orbMoved(pos: { x: number; y: number }): void
  /** Click-through for the transparent parts of the orb window. Mouse moves are still forwarded. */
  orbIgnoreMouse(ignore: boolean): void
  /** Resolves when all three pages have loaded. */
  ready(): Promise<void>
  windows(): { main: BrowserWindow; orb: BrowserWindow; card: BrowserWindow } | null
}

let quitting = false
app.on('before-quit', () => (quitting = true))

function webPreferences(background = false): Electron.WebPreferences {
  return {
    preload: preloadPath('index'),
    additionalArguments: is.dev ? ['--ovra-dev'] : [],
    backgroundThrottling: !background
  }
}

function clampTo(
  area: Rectangle,
  x: number,
  y: number,
  w: number,
  h: number
): { x: number; y: number } {
  return {
    x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - w)),
    y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - h))
  }
}

export function createWindows(deps: WindowsDeps): ShellWindows {
  const { bus, privacy } = deps
  let wins: { main: BrowserWindow; orb: BrowserWindow; card: BrowserWindow } | null = null
  let loaded: Promise<void> = Promise.resolve()
  let forwarder: Forwarder | null = null
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let cardView: MoveCardView = { kind: 'hidden' }
  let calibration = false

  const orbStart = (): { x: number; y: number } => {
    const saved = privacy.getSettings().orbPosition
    const point = saved ?? screen.getPrimaryDisplay().workArea
    const area = screen.getDisplayNearestPoint({ x: point.x, y: point.y }).workArea
    if (saved) return clampTo(area, saved.x, saved.y, cfg.orb.width, cfg.orb.height)
    return clampTo(
      area,
      area.x + area.width - cfg.orb.width - cfg.orb.margin,
      area.y + area.height - cfg.orb.height - cfg.orb.margin,
      cfg.orb.width,
      cfg.orb.height
    )
  }

  const ensure = (): NonNullable<typeof wins> => {
    if (wins) return wins
    const main = new BrowserWindow({
      ...cfg.main,
      show: false,
      title: 'Ovra',
      titleBarStyle: 'hiddenInset',
      backgroundColor: cfg.background,
      webPreferences: webPreferences(deps.background)
    })
    // Keep the main window alive so pushes (like the session summary) always land.
    main.on('close', (e) => {
      if (quitting) return
      e.preventDefault()
      main.hide()
    })

    const orb = new BrowserWindow({
      width: cfg.orb.width,
      height: cfg.orb.height,
      ...orbStart(),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: webPreferences(deps.background)
    })
    orb.setAlwaysOnTop(true, 'floating')
    // Click-through until the renderer reports the pointer over the moon, bubble, chip or controls.
    orb.setIgnoreMouseEvents(true, { forward: true })
    orb.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    const card = new BrowserWindow({
      width: cfg.moveCard.width,
      height: cfg.moveCard.height,
      show: false,
      frame: false,
      resizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: cfg.background,
      webPreferences: webPreferences(deps.background)
    })
    card.setAlwaysOnTop(true, 'floating')

    wins = { main, orb, card }
    for (const w of Object.values(wins)) {
      w.webContents.on('did-finish-load', () => {
        forwarder?.snapshot((channel, payload) => push(w, channel, payload))
        push(w, 'push:privacy', privacy.get())
        push(w, 'push:settings', privacy.getSettings())
      })
    }
    loaded = Promise.all([
      loadPage(main, 'main-window'),
      loadPage(orb, 'orb'),
      loadPage(card, 'move-card')
    ]).then(() => undefined)
    return wins
  }

  const placeCard = (): void => {
    const { orb, card } = ensure()
    const o = orb.getBounds()
    const area = screen.getDisplayMatching(o).workArea
    const { width, height, gap } = cfg.moveCard
    const left = o.x - width - gap
    const x = left >= area.x ? left : o.x + o.width + gap
    const p = clampTo(area, x, o.y, width, height)
    card.setPosition(p.x, p.y)
  }

  const service: ShellWindows = {
    showMain() {
      const { main } = ensure()
      if (!deps.background) {
        main.show()
        main.focus()
      }
    },
    showOrb() {
      const { main, orb } = ensure()
      if (forwarder) push(orb, 'push:orb', forwarder.orb())
      if (!deps.background) orb.showInactive()
      main.hide()
    },
    hideOrb() {
      // ponytail: the listening ring is the camera indicator, so the orb stays while the camera is on.
      if (forwarder?.orb().listening) return
      const { orb, card } = ensure()
      orb.hide()
      card.hide()
    },
    bindBus() {
      if (forwarder) return
      ensure()
      forwarder = bindForwarding(bus, {
        push: (channel, payload) => {
          for (const w of Object.values(ensure())) push(w, channel, payload)
        },
        showOrb: () => service.showOrb(),
        hideOrb: () => service.hideOrb(),
        showMain: () => service.showMain(),
        setMoveCard: (view) => {
          cardView = view
          const { card } = ensure()
          if (view.kind === 'hidden') return card.hide()
          placeCard()
          if (!deps.background) card.showInactive()
        }
      })
    },
    orbMoved({ x, y }) {
      const { orb } = ensure()
      orb.setPosition(Math.round(x), Math.round(y))
      if (cardView.kind !== 'hidden') placeCard()
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        const [px, py] = orb.getPosition()
        void privacy.setSettings({ orbPosition: { x: px, y: py } })
      }, cfg.orbSaveDelayMs)
    },
    orbIgnoreMouse(ignore) {
      ensure().orb.setIgnoreMouseEvents(ignore, { forward: true })
    },
    ready: () => loaded,
    windows: () => wins
  }

  // The main window gets video permission only while calibration is actively sensing.
  const mainSession = session.defaultSession
  mainSession.protocol.handle('ovra-preview', (request) => {
    const file = privacy.getSettings().devVideoSource
    if (
      new URL(request.url).host !== 'calibration' ||
      new URL(request.url).pathname !== '/' ||
      app.isPackaged ||
      !file ||
      !calibration ||
      !privacy.canUseCamera()
    )
      return new Response(null, { status: 403 })
    return net
      .fetch(pathToFileURL(file).toString())
      .then(
        (response) =>
          new Response(response.body, {
            status: response.status,
            headers: { ...Object.fromEntries(response.headers), 'Cache-Control': 'no-store' }
          })
      )
      .catch(() => new Response(null, { status: 404 }))
  })
  mainSession.setPermissionRequestHandler((wc, permission, callback, details) =>
    callback(
      canGrantPreviewPermission(
        wc.id,
        wins?.main.webContents.id,
        permission,
        calibration,
        privacy.canUseCamera(),
        'mediaTypes' in details ? details.mediaTypes : undefined
      )
    )
  )
  mainSession.setPermissionCheckHandler(
    (wc, permission, _origin, details) =>
      !!wc &&
      canGrantPreviewPermission(
        wc.id,
        wins?.main.webContents.id,
        permission,
        calibration,
        privacy.canUseCamera(),
        undefined,
        details.mediaType
      )
  )
  bus.on('sdk:checkin-started', ({ phase }) => {
    calibration = phase === 'calibration'
  })
  bus.on('sdk:checkin-ended', ({ phase }) => {
    if (phase === 'calibration') calibration = false
  })
  bus.on('session:status', (s) => {
    calibration = s.status === 'calibrating' && s.sensingEnabled
  })
  bus.on('sdk:error', (error) => {
    if (wins) push(wins.main, 'push:sdk-error', error)
  })
  return service
}

/** Absolute paths of the test videos (dev only). */
export async function listVideos(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir)
    const exts: readonly string[] = cfg.videoExtensions
    return names.filter((n) => exts.includes(extname(n).toLowerCase())).map((n) => join(dir, n))
  } catch {
    return []
  }
}

/** Registers window:* and dev:list-videos IPC handlers. */
export function registerWindowsIpc(windows: ShellWindows): void {
  handle('window:open-main', () => windows.showMain())
  handle('window:orb-moved', (pos) => windows.orbMoved(pos))
  handle('window:orb-ignore-mouse', ({ ignore }) => windows.orbIgnoreMouse(ignore))
  handle('dev:list-videos', () => (is.dev ? listVideos(testMediaDir()) : []))
}
