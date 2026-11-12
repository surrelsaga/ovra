import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_PRIVACY,
  DEFAULT_SETTINGS,
  type Bus,
  type PrivacyService,
  type PrivacySettings,
  type SessionRecord,
  type Storage
} from '@shared/types'
import { createBus } from '../bus'
import { createStorage } from '../storage'
import { createPrivacy, registerPrivacyIpc } from '.'

const handlers = new Map<string, (req: unknown) => unknown>()
vi.mock('../ipc', () => ({
  handle: (channel: string, fn: (req: unknown) => unknown) => {
    handlers.set(channel, fn)
    return () => handlers.delete(channel)
  }
}))

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 12)

function record(id: string, daysAgo = 0): SessionRecord {
  const endedAt = NOW - daysAgo * DAY
  return {
    id,
    activity: 'deep-work',
    startedAt: endedAt - 60 * 60 * 1000,
    endedAt,
    lengthMin: 60,
    cameraMode: 'checkins',
    moodTimeline: [{ t: endedAt - 1000, situation: 'focused' }],
    moves: [{ t: endedAt - 500, moveId: 'breathe', outcome: 'done' }],
    snoozes: 1,
    longestSeatedMin: 42,
    learnedSongIds: ['spotify:track:1']
  }
}

let dir: string
async function setup(): Promise<{
  privacy: PrivacyService
  storage: Storage
  changes: PrivacySettings[]
  bus: Bus
}> {
  const bus = createBus()
  const changes: PrivacySettings[] = []
  bus.on('privacy:changed', (p) => changes.push(p))
  const storage = createStorage(dir)
  return { privacy: await createPrivacy({ storage, bus }), storage, changes, bus }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ovra-privacy-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('privacy settings', () => {
  it('starts from defaults and persists changes', async () => {
    const { privacy, changes } = await setup()
    expect(privacy.get()).toEqual(DEFAULT_PRIVACY)
    expect(privacy.getSettings()).toEqual(DEFAULT_SETTINGS)

    await privacy.set({ camera: 'yes', face: 'vitals-only', answeredAt: NOW })
    await privacy.setSettings({ checkinIntervalMin: 10 })
    expect(changes.at(-1)).toMatchObject({ camera: 'yes', face: 'vitals-only' })

    const again = (await setup()).privacy
    expect(again.get()).toMatchObject({ camera: 'yes', face: 'vitals-only', answeredAt: NOW })
    expect(again.getSettings().checkinIntervalMin).toBe(10)
  })

  it('merges defaults over partial stored files', async () => {
    await writeFile(join(dir, 'privacy.json'), JSON.stringify({ camera: 'not-now' }))
    const { privacy } = await setup()
    expect(privacy.get()).toEqual({ ...DEFAULT_PRIVACY, camera: 'not-now' })
  })

  it('rejects invalid or unknown fields', async () => {
    const { privacy } = await setup()
    await expect(privacy.set({ camera: 'maybe' } as never)).rejects.toThrow()
    await expect(privacy.set({ pulse: 70 } as never)).rejects.toThrow()
    await expect(privacy.setSettings({ checkinIntervalMin: 7 } as never)).rejects.toThrow()
    expect(privacy.get()).toEqual(DEFAULT_PRIVACY)
  })
})

describe('consent gate', () => {
  it('blocks camera and face until the user says yes', async () => {
    const { privacy } = await setup()
    expect(privacy.canUseCamera()).toBe(false)
    expect(() => privacy.assertCameraConsent()).toThrow(/consent/)

    await privacy.set({ camera: 'not-now', face: 'vitals-and-face' })
    expect(() => privacy.assertCameraConsent()).toThrow()
    expect(privacy.canUseFace()).toBe(false)

    await privacy.set({ camera: 'yes', face: 'vitals-only' })
    expect(() => privacy.assertCameraConsent()).not.toThrow()
    expect(privacy.canUseFace()).toBe(false)

    await privacy.set({ face: 'vitals-and-face' })
    expect(privacy.canUseFace()).toBe(true)
  })
})

describe('history', () => {
  it('saves, lists newest first, replaces by id, deletes one', async () => {
    const { privacy } = await setup()
    await privacy.saveSession(record('old', 2))
    await privacy.saveSession(record('new', 0))
    await privacy.saveSession({ ...record('old', 2), snoozes: 5 })
    const list = await privacy.listSessions()
    expect(list.map((s) => s.id)).toEqual(['new', 'old'])
    expect(list[1].snoozes).toBe(5)

    await privacy.deleteSession('old')
    expect((await privacy.listSessions()).map((s) => s.id)).toEqual(['new'])
  })

  it('does not lose records saved concurrently', async () => {
    const { privacy } = await setup()
    await Promise.all(['a', 'b', 'c', 'd'].map((id) => privacy.saveSession(record(id))))
    expect(await privacy.listSessions()).toHaveLength(4)
  })

  it.each([
    ['top-level vitals', { pulse: 72 }],
    ['an HRV block', { hrv: { rmssd: 80, sdnn: 50 } }],
    ['the baseline', { baseline: { pulse: 60, samples: 30 } }],
    ['expression scores', { expressions: { happy: 80 } }],
    ['an innocent-looking extra field', { notes: 'hi' }]
  ])('rejects a record carrying %s', async (_label, extra) => {
    const { privacy } = await setup()
    await expect(
      privacy.saveSession({ ...record('x'), ...extra } as SessionRecord)
    ).rejects.toThrow()
    expect(await readdir(dir)).toEqual([])
  })

  it('rejects vitals hidden inside the mood timeline', async () => {
    const { privacy } = await setup()
    const r = record('x')
    const sneaky = { ...r, moodTimeline: [{ ...r.moodTimeline[0], pulse: 90 }] }
    await expect(privacy.saveSession(sneaky as SessionRecord)).rejects.toThrow()
    expect(await readdir(dir)).toEqual([])
  })
})

describe('auto-delete', () => {
  async function seeded(autoDelete: PrivacySettings['autoDelete']): ReturnType<typeof setup> {
    const ctx = await setup()
    await ctx.privacy.set({ autoDelete })
    for (const days of [1, 29, 31, 89, 91, 400])
      await ctx.privacy.saveSession(record(`d${days}`, days))
    return ctx
  }

  it('keeps 30 days by default', async () => {
    const { privacy } = await seeded(30)
    expect(await privacy.runAutoDelete(NOW)).toBe(4)
    expect((await privacy.listSessions()).map((s) => s.id)).toEqual(['d1', 'd29'])
  })

  it('keeps 90 days', async () => {
    const { privacy } = await seeded(90)
    expect(await privacy.runAutoDelete(NOW)).toBe(2)
    expect((await privacy.listSessions()).map((s) => s.id)).toEqual(['d1', 'd29', 'd31', 'd89'])
  })

  it('never deletes with "never"', async () => {
    const { privacy } = await seeded('never')
    expect(await privacy.runAutoDelete(NOW)).toBe(0)
    expect(await privacy.listSessions()).toHaveLength(6)
  })

  it('uses the real clock by default', async () => {
    vi.useFakeTimers({ now: NOW + 31 * DAY })
    try {
      const { privacy } = await setup()
      await privacy.saveSession(record('a'))
      expect(await privacy.runAutoDelete()).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('delete everything', () => {
  it('removes every Ovra file and brings the defaults back', async () => {
    const { privacy, storage, changes, bus } = await setup()
    let deletedAt = -1
    bus.on('data:deleted-all', () => (deletedAt = changes.length))
    await privacy.set({ camera: 'yes', face: 'vitals-and-face', answeredAt: NOW })
    await privacy.setSettings({ leaveMusicAlone: true })
    await privacy.saveSession(record('a'))
    await storage.write('songs', [{ id: 'spotify:track:1' }])
    await storage.write('playlists', [])
    await writeFile(join(dir, 'songs.json.corrupt'), 'x')
    expect((await readdir(dir)).length).toBeGreaterThan(0)

    await privacy.deleteEverything()

    expect(await readdir(dir)).toEqual([])
    expect(privacy.get()).toEqual(DEFAULT_PRIVACY) // answeredAt null → onboarding shows again
    expect(privacy.getSettings()).toEqual(DEFAULT_SETTINGS)
    expect(privacy.canUseCamera()).toBe(false)
    expect(changes.at(-1)).toEqual(DEFAULT_PRIVACY)
    expect(deletedAt).toBe(changes.length) // fired after the reset
    expect(await privacy.listSessions()).toEqual([])
    expect((await setup()).privacy.get()).toEqual(DEFAULT_PRIVACY)
  })
})

describe('ipc', () => {
  it('registers every channel and forwards to the service', async () => {
    const { privacy } = await setup()
    registerPrivacyIpc(privacy)
    expect([...handlers.keys()].sort()).toEqual([
      'data:delete-all',
      'history:delete',
      'history:list',
      'privacy:get',
      'privacy:set',
      'settings:get',
      'settings:set'
    ])
    await handlers.get('privacy:set')!({ camera: 'yes' })
    expect(await handlers.get('privacy:get')!(undefined)).toMatchObject({ camera: 'yes' })
    await privacy.saveSession(record('a'))
    await handlers.get('history:delete')!({ id: 'a' })
    expect(await handlers.get('history:list')!(undefined)).toEqual([])
    expect(() => handlers.get('history:delete')!({})).toThrow()
  })
})
