// Owner: Agent E. Test helper: a fake window.ovra with recorded invokes and manual pushes.
import { act } from '@testing-library/react'
import type { IpcPush, IpcPushChannel, OvraBridge } from '@shared/types'

export interface FakeBridge {
  invokes: { channel: string; req: unknown }[]
  push<C extends IpcPushChannel>(channel: C, payload: IpcPush[C]): void
}

export function installFakeBridge(responses: Record<string, unknown> = {}): FakeBridge {
  const invokes: FakeBridge['invokes'] = []
  const listeners = new Map<string, Set<(p: unknown) => void>>()
  const bridge = {
    invoke: (channel: string, req?: unknown) => {
      invokes.push({ channel, req })
      const r = responses[channel]
      return Promise.resolve(typeof r === 'function' ? r(req) : r)
    },
    on: (channel: string, cb: (p: unknown) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set())
      listeners.get(channel)!.add(cb)
      return () => listeners.get(channel)!.delete(cb)
    },
    send: () => undefined,
    isDev: false
  } as unknown as OvraBridge
  window.ovra = bridge
  return {
    invokes,
    push: (channel, payload) => act(() => listeners.get(channel)?.forEach((cb) => cb(payload)))
  }
}
