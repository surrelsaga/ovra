import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watchMainThread } from './stall'

it('reports a blocked main thread from outside it, and the recovery', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ovra-stall-'))
  const file = join(dir, 'log')
  const fd = openSync(file, 'w')
  const stop = watchMainThread(50, 300, fd)
  await new Promise((r) => setTimeout(r, 200))
  // A synchronous call that never yields, like a deadlocked native call.
  const until = Date.now() + 800
  while (Date.now() < until);
  await new Promise((r) => setTimeout(r, 300))
  stop()
  closeSync(fd)
  const log = readFileSync(file, 'utf8')
  rmSync(dir, { recursive: true })
  expect(log).toMatch(/main thread blocked for 0\.\d+s/)
  expect(log).toMatch(/main thread resumed after \d\.\ds/)
})
