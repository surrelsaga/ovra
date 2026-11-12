import { useEffect, useState } from 'react'
import type { IpcPush, IpcPushChannel, OvraBridge } from '@shared/types'

declare global {
  interface Window {
    ovra: OvraBridge
  }
}

/** Typed access to the preload bridge. */
export const ovra = (): OvraBridge => window.ovra

/** Subscribe to a push channel; returns the latest payload (or the initial value). */
export function usePush<C extends IpcPushChannel>(channel: C, initial: IpcPush[C]): IpcPush[C] {
  const [value, setValue] = useState(initial)
  useEffect(() => window.ovra.on(channel, setValue), [channel])
  return value
}
