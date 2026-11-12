// Owner: Agent D (moves). Move library, nudge rules, verification, break and return flow.
import type { Bus, MovesService, PrivacyService } from '@shared/types'

export interface MovesDeps {
  bus: Bus
  privacy: PrivacyService
}

export function createMoves(deps: MovesDeps): MovesService {
  void deps
  throw new Error('moves: not implemented')
}

/** Registers move:* and break:* IPC handlers. */
export function registerMovesIpc(moves: MovesService): void {
  void moves
}
