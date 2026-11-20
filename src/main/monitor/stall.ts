import { Worker } from 'node:worker_threads'

/**
 * Job 32: a frozen main thread stops every timer, so it can't report itself. A worker thread watches
 * a heartbeat counter and writes straight to stderr (no main-thread hop) when it stops moving.
 */
const WATCHER = `
const { workerData: { beat, stallMs, pollMs, fd } } = require('node:worker_threads')
const { writeSync } = require('node:fs')
let last = Atomics.load(beat, 0), since = Date.now(), reported = false
setInterval(() => {
  const now = Date.now(), seen = Atomics.load(beat, 0)
  const say = (text) => { try { writeSync(fd, '[monitor] ' + new Date(now).toISOString() + ' ' + text + '\\n') } catch {} }
  if (seen !== last) {
    if (reported) say('main thread resumed after ' + ((now - since) / 1000).toFixed(1) + 's')
    last = seen; since = now; reported = false
  } else if (!reported && now - since >= stallMs) {
    reported = true
    say('main thread blocked for ' + ((now - since) / 1000).toFixed(1) + 's: timers, IPC and the session clock are frozen (a synchronous native call, e.g. the SDK bridge, has not returned)')
  }
}, pollMs)
`

/** `fd` is stderr; tests pass a file. */
export function watchMainThread(heartbeatMs: number, stallMs: number, fd = 2): () => void {
  const beat = new Int32Array(new SharedArrayBuffer(4))
  const worker = new Worker(WATCHER, {
    eval: true,
    workerData: { beat, stallMs, pollMs: heartbeatMs, fd }
  })
  worker.unref()
  const timer = setInterval(() => Atomics.add(beat, 0, 1), heartbeatMs)
  return () => {
    clearInterval(timer)
    void worker.terminate()
  }
}
