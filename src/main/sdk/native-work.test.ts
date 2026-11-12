import { AsyncResource } from 'node:async_hooks'
import { nativeWork } from './native-work'

it('waits for actual N-API async work destruction', async () => {
  nativeWork.start()
  const work = new AsyncResource('generic', { requireManualDestroy: true })
  let settled = false
  const done = nativeWork.settle().then(() => {
    settled = true
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(settled).toBe(false)
  work.emitDestroy()
  await done
  expect(settled).toBe(true)
  await nativeWork.settle()
})
