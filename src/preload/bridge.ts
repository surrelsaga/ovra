import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CAPTURE_CHANNELS,
  IPC_INVOKE_CHANNELS,
  IPC_PUSH_CHANNELS,
  type OvraBridge
} from '@shared/types'

const invokeOk = new Set<string>(IPC_INVOKE_CHANNELS)
const pushOk = new Set<string>(IPC_PUSH_CHANNELS)
const captureOk = new Set<string>(IPC_CAPTURE_CHANNELS)

/** Exposes window.ovra with whitelisted, typed channels only. */
export function exposeBridge(opts: { allowCaptureSend: boolean }): void {
  const bridge: OvraBridge = {
    invoke: ((channel: string, req?: unknown) => {
      if (!invokeOk.has(channel)) return Promise.reject(new Error(`Blocked channel ${channel}`))
      return ipcRenderer.invoke(channel, req)
    }) as OvraBridge['invoke'],
    on: ((channel: string, cb: (payload: unknown) => void) => {
      if (!pushOk.has(channel)) throw new Error(`Blocked channel ${channel}`)
      const listener = (_e: unknown, payload: unknown): void => cb(payload)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.off(channel, listener)
    }) as OvraBridge['on'],
    send: ((channel: string, payload: unknown) => {
      if (!opts.allowCaptureSend || !captureOk.has(channel))
        throw new Error(`Blocked channel ${channel}`)
      ipcRenderer.send(channel, payload)
    }) as OvraBridge['send'],
    isDev: process.env.NODE_ENV === 'development' || process.argv.includes('--ovra-dev')
  }
  contextBridge.exposeInMainWorld('ovra', bridge)
}
