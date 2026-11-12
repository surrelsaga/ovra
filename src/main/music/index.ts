// Owner: Agent C (music). Controller, library, scoring, learning, selector.
import type { Bus, MusicController, MusicService, PrivacyService, Storage } from '@shared/types'

export interface MusicDeps {
  bus: Bus
  storage: Storage
  privacy: PrivacyService
  controller: MusicController
  /** Returns a key or null. Never log it. */
  getKey: (name: 'OPENROUTER_API_KEY' | 'LASTFM_API_KEY') => string | null
}

export function createMusic(deps: MusicDeps): MusicService {
  void deps
  throw new Error('music: not implemented')
}

/** Registers music:* IPC handlers. */
export function registerMusicIpc(music: MusicService): void {
  void music
}
