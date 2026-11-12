import { installQuitHandler } from './quit'
import { appConfig } from './config'

const h = vi.hoisted(() => ({
  listener: (() => {}) as (e: { preventDefault(): void }) => void,
  quit: vi.fn(),
  exit: vi.fn()
}))
vi.mock('electron', () => ({
  app: {
    on: (_event: string, fn: typeof h.listener) => {
      h.listener = fn
    },
    quit: h.quit,
    exit: h.exit
  }
}))

it('defers repeat quit requests until cleanup resolves', async () => {
  let complete!: () => void
  const cleanup = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve
      })
  )
  installQuitHandler(cleanup)
  const preventDefault = vi.fn()
  h.listener({ preventDefault })
  h.listener({ preventDefault })
  expect(cleanup).toHaveBeenCalledOnce()
  expect(h.quit).not.toHaveBeenCalled()
  complete()
  await Promise.resolve()
  expect(h.quit).toHaveBeenCalledOnce()
  h.listener({ preventDefault })
  expect(preventDefault).toHaveBeenCalledTimes(2)
})

it('has a bounded shutdown timeout', async () => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  installQuitHandler(() => new Promise(() => {}))
  h.listener({ preventDefault: vi.fn() })
  await vi.advanceTimersByTimeAsync(appConfig.quitTimeoutMs)
  expect(h.exit).toHaveBeenCalledWith(1)
  vi.useRealTimers()
})
