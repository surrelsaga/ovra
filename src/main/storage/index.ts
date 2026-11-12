// Owner: Agent F (privacy + storage). JSON files in Electron's userData folder.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Storage, StorageFile } from '@shared/types'

/** The only names storage accepts. Mirrors the StorageFile type. */
export const STORAGE_FILES: readonly StorageFile[] = [
  'privacy',
  'settings',
  'sessions',
  'songs',
  'playlists'
]

/**
 * Keys that mean a raw vital or face value. Any JSON containing one of these keys (exact match,
 * any case, any depth) is refused. Exact match on purpose: state threshold names like
 * `tensePulsePct` in settings are fine, a `pulse` field is not.
 */
const RAW_KEYS = new Set([
  'pulse',
  'pulserate',
  'heartrate',
  'bpm',
  'breathing',
  'breathingrate',
  'hrv',
  'rmssd',
  'sdnn',
  'meannn',
  'baevsky',
  'landmarks',
  'expression',
  'expressions',
  'baseline',
  'blinkrate',
  'headrolldeg',
  'metrics'
])

/** `confidence` is a song score field; anywhere else it is a reading's confidence. */
const CONFIDENCE_ALLOWED: ReadonlySet<StorageFile> = new Set(['songs'])

export class RawDataError extends Error {
  constructor(file: StorageFile, key: string) {
    super(`storage: refused to write "${key}" to ${file} (raw vitals are never stored)`)
    this.name = 'RawDataError'
  }
}

/** Serialise `data` for `file`, throwing RawDataError if it carries a forbidden key. */
export function serialize(file: StorageFile, data: unknown): string {
  return JSON.stringify(
    data,
    (key, value) => {
      const k = key.toLowerCase()
      if (RAW_KEYS.has(k) || (k === 'confidence' && !CONFIDENCE_ALLOWED.has(file))) {
        throw new RawDataError(file, key)
      }
      return value
    },
    2
  )
}

function assertName(name: string): asserts name is StorageFile {
  if (!(STORAGE_FILES as readonly string[]).includes(name)) {
    throw new Error(`storage: unknown file "${name}"`)
  }
}

/** Create the storage module rooted at `dir` (userData in the app, a temp dir in tests). */
export function createStorage(dir: string): Storage {
  const queues = new Map<StorageFile, Promise<unknown>>()

  /** Run ops on one file strictly in order. A failed op doesn't block the next. */
  function queued<R>(name: StorageFile, op: () => Promise<R>): Promise<R> {
    const prev = queues.get(name) ?? Promise.resolve()
    const next = prev.then(op, op)
    queues.set(
      name,
      next.catch(() => undefined)
    )
    return next
  }

  const pathOf = (name: StorageFile): string => join(dir, `${name}.json`)

  return {
    read<T>(name: StorageFile, fallback: T): Promise<T> {
      assertName(name)
      return queued(name, async () => {
        const file = pathOf(name)
        let text: string
        try {
          text = await readFile(file, 'utf8')
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
          throw err
        }
        try {
          return JSON.parse(text) as T
        } catch {
          // Keep the broken file for debugging, then start fresh.
          await rename(file, `${file}.corrupt`).catch(() => undefined)
          console.warn(`storage: ${name}.json was corrupt, kept as ${name}.json.corrupt`)
          return fallback
        }
      })
    },

    write<T>(name: StorageFile, data: T): Promise<void> {
      assertName(name)
      const text = serialize(name, data) // throws before anything touches disk
      return queued(name, async () => {
        await mkdir(dir, { recursive: true })
        const tmp = join(dir, `.${name}.${randomUUID()}.tmp`)
        try {
          await writeFile(tmp, text, 'utf8')
          await rename(tmp, pathOf(name))
        } catch (err) {
          await rm(tmp, { force: true })
          throw err
        }
      })
    },

    remove(name: StorageFile): Promise<void> {
      assertName(name)
      return queued(name, async () => {
        await rm(pathOf(name), { force: true })
        await rm(`${pathOf(name)}.corrupt`, { force: true })
      })
    }
  }
}
