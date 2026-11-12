import { EventEmitter } from 'node:events'
import type { Bus, BusEventName, BusEvents } from '@shared/types'

/** Typed main-process event bus. One instance per app (see app.ts); tests create their own. */
export function createBus(): Bus {
  const ee = new EventEmitter()
  ee.setMaxListeners(100)
  return {
    emit<E extends BusEventName>(event: E, payload: BusEvents[E]): void {
      ee.emit(event, payload)
    },
    on<E extends BusEventName>(event: E, cb: (payload: BusEvents[E]) => void): () => void {
      ee.on(event, cb)
      return () => ee.off(event, cb)
    },
    once<E extends BusEventName>(event: E, cb: (payload: BusEvents[E]) => void): () => void {
      ee.once(event, cb)
      return () => ee.off(event, cb)
    }
  }
}
