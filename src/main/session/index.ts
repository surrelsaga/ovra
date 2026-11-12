// Owner: Agent B (state engine + session). Session lifecycle, timer, activity defaults.
import type {
  Bus,
  MovesService,
  MusicService,
  PrivacyService,
  SensingService,
  SessionService,
  StateEngine
} from '@shared/types'

export interface SessionDeps {
  bus: Bus
  privacy: PrivacyService
  sensing: SensingService
  state: StateEngine
  music: MusicService
  moves: MovesService
}

export function createSessionService(deps: SessionDeps): SessionService {
  void deps
  throw new Error('session: not implemented')
}

/** Registers session:* and camera:* IPC handlers. */
export function registerSessionIpc(session: SessionService, sensing: SensingService): void {
  void session
  void sensing
}
