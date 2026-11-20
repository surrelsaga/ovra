import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_PRIVACY, DEFAULT_SETTINGS, type PrivacyService, type Session } from '@shared/types'
import type { AppOptions } from '../app'
import { simConfig } from './config'

const f = vi.hoisted(() => ({
  packaged: false,
  options: null as AppOptions | null,
  handlers: new Map<string, (req?: unknown) => unknown>(),
  switchNow: vi.fn(async () => {}),
  writeSettings: vi.fn(),
  broadcast: vi.fn(),
  close: null as (() => void) | null
}))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return f.packaged
    }
  },
  BrowserWindow: class {
    setAlwaysOnTop(): void {
      return
    }
    async loadFile(): Promise<void> {
      return
    }
    async loadURL(): Promise<void> {
      return
    }
    on(_event: string, fn: () => void): void {
      f.close = fn
    }
  }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('../paths', () => ({ preloadPath: () => '/unused' }))
vi.mock('../ipc', () => ({
  handle: (name: string, fn: (req?: unknown) => unknown) => f.handlers.set(name, fn),
  push: vi.fn(),
  broadcast: f.broadcast
}))
vi.mock('../app', async () => {
  const { createBus } = await import('../bus')
  return {
    startApp: async (options: AppOptions) => {
      f.options = options
      const privacy = {
        get: () => DEFAULT_PRIVACY,
        getSettings: () => ({ ...DEFAULT_SETTINGS, ...options.settingsOverlay }),
        setSettings: f.writeSettings
      } as unknown as PrivacyService
      const bus = createBus()
      await options.setup?.(privacy)
      options.createSensing?.({ bus, privacy })
      return { bus, privacy, state: { why: () => undefined }, music: { switchNow: f.switchNow } }
    }
  }
})
import { startSimulator } from './index'

beforeEach(() => {
  vi.useFakeTimers()
  f.handlers.clear()
  vi.clearAllMocks()
  f.packaged = false
})
afterEach(() => {
  f.close?.()
  vi.useRealTimers()
})

it('starts Instant and continuous in memory, changes all speeds, and routes the music action', async () => {
  const services = await startSimulator()
  expect(f.options?.privacyOverlay).toEqual({ cameraMode: 'continuous' })
  expect(f.handlers.get('simulator:status')?.()).toMatchObject({ speed: 'instant', fastMode: true })
  expect(f.options?.settingsOverlay?.thresholdOverrides).toMatchObject(simConfig.instant.thresholds)
  f.options!.settingsOverlay!.thresholdOverrides = { tenseHoldMin: 99 }
  services.bus.emit('session:started', {
    config: { activity: 'focus', cameraMode: 'continuous', demo: true }
  } as Session)
  expect(f.options?.settingsOverlay?.thresholdOverrides).toMatchObject(simConfig.instant.thresholds)
  f.handlers.get('simulator:set-speed')?.({ speed: 'normal' })
  expect(f.handlers.get('simulator:status')?.()).toMatchObject({ speed: 'normal', fastMode: false })
  expect(f.options?.settingsOverlay?.thresholdOverrides).toBeUndefined()
  expect(f.options?.musicTargetGap?.minTargetChangeMs).toBe(180_000)
  f.handlers.get('simulator:set-speed')?.({ speed: 'fast' })
  expect(f.options?.settingsOverlay?.thresholdOverrides).toMatchObject(simConfig.fast.thresholds)
  // Fast keeps the demo session's own switch-now; only Instant adds it for normal sessions.
  expect(f.options?.musicTargetGap?.switchNow).toBe(true)
  services.bus.emit('session:started', {
    config: { activity: 'focus', cameraMode: 'continuous' }
  } as Session)
  expect(f.options?.musicTargetGap?.switchNow).toBeUndefined()
  f.handlers.get('simulator:set-speed')?.({ speed: 'instant' })
  expect(f.options?.musicTargetGap?.switchNow).toBe(true)
  expect(() => f.handlers.get('simulator:set-speed')?.({ speed: 'unknown' })).toThrow(
    'Unknown simulator speed'
  )
  await f.handlers.get('simulator:switch-music')?.()
  expect(f.switchNow).toHaveBeenCalledOnce()
  expect(f.writeSettings).not.toHaveBeenCalled()
  expect(f.broadcast).toHaveBeenCalledWith('push:settings', expect.any(Object))
})

it('rejects packaged builds before registering simulator actions', async () => {
  f.packaged = true
  await expect(startSimulator()).rejects.toThrow('dev only')
  expect(f.handlers.size).toBe(0)
})

it("keeps a demo session's exercise rules when it applies its speed", async () => {
  const services = await startSimulator()
  const moves = f.options!.movesConfig!
  const demoWalk = { ...moves.moves.walk, name: 'Walk (demo version)' }
  // What the demo overlay sets before the simulator's own session:started handler runs.
  Object.assign(moves, { nudges: false, moves: { ...moves.moves, walk: demoWalk } })
  services.bus.emit('session:started', {
    config: { activity: 'focus', cameraMode: 'continuous', demo: true }
  } as Session)
  f.handlers.get('simulator:set-speed')?.({ speed: 'fast' })
  expect(moves.nudges).toBe(false)
  expect(moves.moves.walk).toBe(demoWalk)
  services.bus.emit('session:started', {
    config: { activity: 'focus', cameraMode: 'continuous' }
  } as Session)
  expect(moves.nudges).toBe(true)
  expect(moves.moves.walk.name).toBe('Walk and get water')
})
