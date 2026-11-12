// Owner: Agent F (privacy + storage). Consent, settings, history, deletion, auto-delete.
import {
  DEFAULT_PRIVACY,
  DEFAULT_SETTINGS,
  type AppSettings,
  type Bus,
  type PrivacyService,
  type SessionRecord,
  type Storage
} from '@shared/types'
import { handle } from '../ipc'
import { STORAGE_FILES } from '../storage'
import { privacySchema, sessionRecordSchema, settingsSchema } from './schemas'

export interface PrivacyDeps {
  storage: Storage
  bus: Bus
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

    getSettings: () => structuredClone(settings),

    async setSettings(patch) {
      const next: AppSettings = settingsSchema.parse({ ...settings, ...patch })
      settings = next
      await storage.write('settings', next)
      return structuredClone(next)
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
      bus.emit('privacy:changed', { ...privacy })
      bus.emit('data:deleted-all', {})
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

/** Registers privacy:*, settings:*, history:*, data:* IPC handlers. */
export function registerPrivacyIpc(privacy: PrivacyService): void {
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
}
