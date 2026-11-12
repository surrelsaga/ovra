import { createHook } from 'node:async_hooks'

// The SDK bridge's destroy() is fire-and-forget. Koffi uses N-API AsyncWorker's default
// "generic" resource; observe its actual completion instead of sleeping before app.quit().
// shortcut: depends on Koffi naming its N-API work "generic"; replace with an awaited bridge teardown when the SDK exposes one.
const pending = new Set<number>()
const waiters = new Set<() => void>()
const hook = createHook({
  init(id, type) {
    if (type === 'generic') pending.add(id)
  },
  destroy(id) {
    if (!pending.delete(id)) return
    for (const wake of waiters) wake()
  }
})
let enabled = false

export const nativeWork = {
  start(): void {
    if (!enabled) {
      hook.enable()
      enabled = true
    }
  },
  async settle(): Promise<void> {
    // Let MessagePort close callbacks enqueue teardown before checking the native work queue.
    await new Promise<void>((resolve) => setImmediate(resolve))
    await new Promise<void>((resolve) => setImmediate(resolve))
    if (!pending.size) return
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (pending.size) return
        waiters.delete(check)
        resolve()
      }
      waiters.add(check)
      check()
    })
  }
}
