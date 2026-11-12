import type { OvraBridge } from '@shared/types'
import { exposeBridge } from './bridge'

const h = vi.hoisted(() => ({
  bridge: null as unknown as OvraBridge,
  listeners: new Map<string, Set<(event: unknown, payload: unknown) => void>>()
}))
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, bridge: OvraBridge) => {
      h.bridge = bridge
    }
  },
  ipcRenderer: {
    on: (channel: string, fn: (e: unknown, p: unknown) => void) => {
      if (!h.listeners.has(channel)) h.listeners.set(channel, new Set())
      h.listeners.get(channel)!.add(fn)
    },
    off: (channel: string, fn: (e: unknown, p: unknown) => void) =>
      h.listeners.get(channel)?.delete(fn),
    invoke: vi.fn(),
    send: vi.fn()
  }
}))

it('replays early window pushes to late subscriptions, and respects unsubscribe', async () => {
  exposeBridge({ allowCaptureSend: false })
  const view = { mood: 'calm', listening: true, paused: false, away: false }
  for (const fn of h.listeners.get('push:orb')!) fn(null, view)
  const listener = vi.fn()
  h.bridge.on('push:orb', listener)
  await Promise.resolve()
  expect(listener).toHaveBeenCalledExactlyOnceWith(view)
  const removed = vi.fn()
  h.bridge.on('push:orb', removed)()
  await Promise.resolve()
  expect(removed).not.toHaveBeenCalled()
  expect(h.listeners.has('push:capture-start')).toBe(false)
})
