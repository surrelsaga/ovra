// Owner: Agent F (privacy + storage). JSON files in Electron's userData folder.
import type { Storage } from '@shared/types'

/** Create the storage module rooted at `dir` (userData in the app, a temp dir in tests). */
export function createStorage(dir: string): Storage {
  void dir
  throw new Error('storage: not implemented')
}
