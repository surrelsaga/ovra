import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type Session } from '@shared/types'
import { createBus } from '../bus'
import { createPrivacy } from '../privacy'
import { createStorage } from '../storage'
import { bindForwarding, type ShellControl } from './forward'
import { windowsConfig } from './config'

vi.mock('../ipc', () => ({ broadcast: vi.fn() }))

const shell: ShellControl = {
  push: () => undefined,
  showOrb: () => undefined,
  hideOrb: () => undefined,
  showMain: () => undefined,
  setMoveCard: () => undefined
}

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ovra-camera-teaching-'))
  vi.useFakeTimers()
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true })
})

it('persists only the first three real turn-ons and teaches each matching off, across reloads', async () => {
  const storage = createStorage(dir)
  // An older settings file has no teaching field. Existing preferences must survive.
  const oldSettings = { ...DEFAULT_SETTINGS }
  Reflect.deleteProperty(oldSettings, 'cameraTeachCount')
  await storage.write('settings', { ...oldSettings, leaveMusicAlone: true })
  const bus = createBus()
  const privacy = await createPrivacy({ storage, bus })
  expect(privacy.getSettings()).toMatchObject({ cameraTeachCount: 0, leaveMusicAlone: true })
  const save = vi.spyOn(privacy, 'setSettings')
  let fw = bindForwarding(bus, shell, privacy)

  for (let count = 1; count <= windowsConfig.cameraTeachLimit; count++) {
    bus.emit('sdk:checkin-started', { phase: 'checkin' })
    expect(fw.orb().bubble).toBe('Camera on. See the little light circling me?')
    // A duplicate start and unrelated message cannot consume a lesson or obscure it.
    bus.emit('sdk:checkin-started', { phase: 'checkin' })
    bus.emit('orb:bubble', { text: 'Unrelated song update' })
    expect(fw.orb().bubble).toBe('Camera on. See the little light circling me?')
    expect(privacy.getSettings().cameraTeachCount).toBe(count)
    await save.mock.results.at(-1)!.value
    expect(save).toHaveBeenCalledTimes(count)
    bus.emit('sdk:checkin-ended', { phase: 'checkin' })
    expect(fw.orb().bubble).toBe('Camera off.')
    vi.advanceTimersByTime(windowsConfig.bubbleTtlMs)
    expect(fw.orb().bubble).toBeUndefined()
  }
  fw.dispose()
  const reloaded = await createPrivacy({ storage, bus })
  expect(reloaded.getSettings().cameraTeachCount).toBe(3)
  fw = bindForwarding(bus, shell, reloaded)
  bus.emit('sdk:checkin-started', { phase: 'continuous' })
  expect(fw.orb().bubble).toBeUndefined()
  bus.emit('sdk:checkin-ended', { phase: 'continuous' })
  expect(fw.orb().bubble).toBeUndefined()
  fw.dispose()
})

it('teaches off once when pausing, even when SDK stop precedes the pause notification', async () => {
  const bus = createBus()
  const privacy = await createPrivacy({ storage: createStorage(dir), bus })
  const save = vi.spyOn(privacy, 'setSettings')
  const fw = bindForwarding(bus, shell, privacy)
  bus.emit('sdk:checkin-started', { phase: 'continuous' })
  await save.mock.results[0].value
  bus.emit('sdk:checkin-ended', { phase: 'continuous' })
  vi.advanceTimersByTime(1000)
  bus.emit('privacy:camera-paused', {})
  expect(fw.orb()).toMatchObject({ bubble: 'Camera off.', paused: true, listening: false })
  vi.advanceTimersByTime(windowsConfig.bubbleTtlMs - 1000)
  expect(fw.orb().bubble).toBeUndefined()
  fw.dispose()
})

it('supplies the next scheduled check only between check-ins, never while paused or away', () => {
  const bus = createBus()
  const fw = bindForwarding(bus, shell)
  const session: Session = {
    id: 'camera-test',
    startedAt: Date.now(),
    status: 'calibrating',
    sensingEnabled: true,
    config: {
      activity: 'focus',
      lengthMin: 60,
      cameraMode: 'checkins',
      checkinIntervalMin: 5,
      music: false
    }
  }
  bus.emit('session:status', session)
  bus.emit('sdk:checkin-started', { phase: 'calibration' })
  bus.emit('sdk:checkin-ended', { phase: 'calibration' })
  bus.emit('session:status', { ...session, status: 'running' })
  expect(fw.orb().nextCheckAt).toBe(Date.now() + 5 * 60_000)
  vi.advanceTimersByTime(5 * 60_000)
  bus.emit('sdk:checkin-started', { phase: 'checkin' })
  expect(fw.orb().nextCheckAt).toBeUndefined()
  vi.advanceTimersByTime(90_000)
  bus.emit('sdk:checkin-ended', { phase: 'checkin' })
  expect(fw.orb().nextCheckAt).toBe(Date.now() + 5 * 60_000 - 90_000)
  bus.emit('privacy:camera-paused', {})
  expect(fw.orb().nextCheckAt).toBeUndefined()
  bus.emit('privacy:camera-resumed', {})
  expect(fw.orb().nextCheckAt).toBeDefined()
  bus.emit('break:away', { since: Date.now(), manual: true })
  expect(fw.orb().nextCheckAt).toBeUndefined()
  bus.emit('session:status', { ...session, status: 'ended' })
  expect(fw.orb().nextCheckAt).toBeUndefined()
  fw.dispose()
})

it('clears the last off lesson when a fourth turn-on follows immediately', async () => {
  const bus = createBus()
  const privacy = await createPrivacy({ storage: createStorage(dir), bus })
  await privacy.setSettings({ cameraTeachCount: windowsConfig.cameraTeachLimit - 1 })
  const save = vi.spyOn(privacy, 'setSettings')
  const fw = bindForwarding(bus, shell, privacy)
  bus.emit('sdk:checkin-started', { phase: 'calibration' })
  await save.mock.results[0].value
  bus.emit('sdk:checkin-ended', { phase: 'calibration' })
  expect(fw.orb().bubble).toBe('Camera off.')
  bus.emit('sdk:checkin-started', { phase: 'continuous' })
  expect(fw.orb().bubble).toBeUndefined()
  bus.emit('sdk:checkin-ended', { phase: 'continuous' })
  expect(fw.orb().bubble).toBeUndefined()
  fw.dispose()
})
