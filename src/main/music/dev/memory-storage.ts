// Dev/test only: in-memory Storage that records writes.
import type { Storage, StorageFile } from '@shared/types'

export function memoryStorage(): Storage & {
  files: Map<StorageFile, unknown>
  writes: StorageFile[]
} {
  const files = new Map<StorageFile, unknown>()
  const writes: StorageFile[] = []
  return {
    files,
    writes,
    read: async <T>(n: StorageFile, fallback: T) => (files.has(n) ? (files.get(n) as T) : fallback),
    write: async (n, d) => {
      writes.push(n)
      files.set(n, structuredClone(d))
    },
    remove: async (n) => {
      files.delete(n)
    }
  }
}
