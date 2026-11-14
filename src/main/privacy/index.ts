// Owner: Agent F (privacy + storage). Consent, settings, history, deletion, auto-delete.
import {
  DEFAULT_PRIVACY,
  DEFAULT_SETTINGS,
  type AppSettings,
  type Bus,
  type IpcInvoke,
  type PrivacyService,
  type SessionRecord,
  type Storage
} from '@shared/types'
import { broadcast, handle } from '../ipc'
import { STORAGE_FILES } from '../storage'
import { simConfig } from '../simulator/config'
import { privacySchema, sessionRecordSchema, settingsSchema } from './schemas'

export interface PrivacyDeps {
  storage: Storage
  bus: Bus
  /** Dev simulator: read over the stored settings, never written. Callers may change it in place. */
  settingsOverlay?: Partial<AppSettings>
  /** Clears Chromium's browser storage and cache for the app (Delete everything). */
  clearBrowserData?: () => Promise<void>
  /** Removes only the SDK’s known cache directory, after sensing has stopped. */
  clearSdkCache?: () => Promise<void>
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Stored values merged over defaults. A stored file that no longer validates falls back to defaults. */
async function load<T extends object>(
  storage: Storage,
  name: 'privacy' | 'settings',
  defaults: T,
  schema: { safeParse(v: unknown): { success: boolean; data?: unknown } }
): Promise<T> {
  const stored = await storage.read<Partial<T>>(name, {})
  const merged = { ...defaults, ...stored }
  const parsed = schema.safeParse(merged)
  if (parsed.success) return parsed.data as T
  console.warn(`privacy: stored ${name} is invalid, using defaults`)
  return { ...defaults }
}

export async function createPrivacy(deps: PrivacyDeps): Promise<PrivacyService> {
  const { storage, bus } = deps
  let privacy = await load(storage, 'privacy', DEFAULT_PRIVACY, privacySchema)
  let settings = await load(storage, 'settings', DEFAULT_SETTINGS, settingsSchema)
  // Older simulator builds wrote their values here and only put them back on Cmd+Q.
  if (settings.devVideoSource === simConfig.noCameraVideo) {
    console.warn(
      '[ovra] clearing settings a simulator run left behind (dev video, nudge, thresholds)'
    )
    settings = {
      ...settings,
      devVideoSource: DEFAULT_SETTINGS.devVideoSource,
      nudgeMinIntervalMin: DEFAULT_SETTINGS.nudgeMinIntervalMin,
      thresholdOverrides: DEFAULT_SETTINGS.thresholdOverrides
    }
    await storage.write('settings', settings)
  }
  const view = (): AppSettings => structuredClone({ ...settings, ...deps.settingsOverlay })

  // Sessions are read-modify-write; run those one at a time so none is lost.
  let sessionsLock: Promise<unknown> = Promise.resolve()
  function withSessions<R>(fn: (list: SessionRecord[]) => Promise<R>): Promise<R> {
    const run = sessionsLock.then(async () => fn(await readSessions()))
    sessionsLock = run.catch(() => undefined)
    return run
  }

  async function readSessions(): Promise<SessionRecord[]> {
    const raw = await storage.read<unknown[]>('sessions', [])
    if (!Array.isArray(raw)) return []
    return raw.flatMap((r) => {
      const parsed = sessionRecordSchema.safeParse(r)
      return parsed.success ? [parsed.data] : []
    })
  }

  const canUseCamera = (): boolean => privacy.camera === 'yes'

  return {
    get: () => ({ ...privacy }),

    async set(patch) {
      const next = privacySchema.parse({ ...privacy, ...patch })
      privacy = next
      await storage.write('privacy', next)
      bus.emit('privacy:changed', { ...next })
      return { ...next }
    },

    canUseCamera,

    assertCameraConsent() {
      if (!canUseCamera()) throw new Error('privacy: camera consent not given')
    },

    canUseFace: () => canUseCamera() && privacy.face === 'vitals-and-face',

    getSettings: view,

    async setSettings(patch) {
      const next: AppSettings = settingsSchema.parse({ ...settings, ...patch })
      settings = next
      await storage.write('settings', next)
      broadcast('push:settings', view())
      return view()
    },

    listSessions: () =>
      withSessions(async (list) => list.sort((a, b) => b.startedAt - a.startedAt)),

    async saveSession(record) {
      const clean = sessionRecordSchema.parse(record) // throws on unknown keys, e.g. sneaked-in vitals
      return withSessions(async (list) => {
        await storage.write('sessions', [...list.filter((s) => s.id !== clean.id), clean])
      })
    },

    deleteSession(id) {
      return withSessions(async (list) => {
        await storage.write(
          'sessions',
          list.filter((s) => s.id !== id)
        )
      })
    },

    async deleteEverything() {
      await withSessions(() => Promise.all(STORAGE_FILES.map((f) => storage.remove(f))))
      privacy = { ...DEFAULT_PRIVACY }
      settings = structuredClone(DEFAULT_SETTINGS)
      broadcast('push:settings', view())
      bus.emit('privacy:changed', { ...privacy })
      bus.emit('data:deleted-all', {})
      await Promise.all([deps.clearBrowserData?.(), deps.clearSdkCache?.()])
    },

    runAutoDelete(now = Date.now()) {
      const keepDays = privacy.autoDelete
      if (keepDays === 'never') return Promise.resolve(0)
      const cutoff = now - keepDays * DAY_MS
      return withSessions(async (list) => {
        const kept = list.filter((s) => s.endedAt >= cutoff)
        const removed = list.length - kept.length
        if (removed > 0) await storage.write('sessions', kept)
        return removed
      })
    }
  }
}

/**
 * Registers privacy:*, settings:*, history:*, data:* IPC handlers. `openDataFolder` opens userData
 * in the file manager and resolves to an error message, or '' on success (Electron's shell.openPath).
 */
export function registerPrivacyIpc(
  privacy: PrivacyService,
  openDataFolder?: () => Promise<string>,
  dataFolder?: IpcInvoke['data:folder']['res']
): void {
  handle('privacy:get', () => privacy.get())
  handle('privacy:set', (patch) => privacy.set(patch))
  handle('settings:get', () => privacy.getSettings())
  handle('settings:set', (patch) => privacy.setSettings(patch))
  handle('history:list', () => privacy.listSessions())
  handle('history:delete', (req) => {
    if (typeof req?.id !== 'string') throw new Error('history:delete needs an id')
    return privacy.deleteSession(req.id)
  })
  handle('data:delete-all', () => privacy.deleteEverything())
  if (dataFolder) handle('data:folder', () => dataFolder)
  if (openDataFolder)
    handle('data:show-folder', async () => {
      const error = await openDataFolder()
      if (error) throw new Error(`data:show-folder: ${error}`)
    })
}
