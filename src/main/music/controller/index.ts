// Owner: Agent C (music). The ONLY folder allowed to call osascript or other Mac-only APIs.
import type { MusicController } from '@shared/types'

/** Returns the controller for this platform (Mac: SpotifyMacController). */
export function createMusicController(): MusicController {
  throw new Error('music controller: not implemented')
}
