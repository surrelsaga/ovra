// Owner: Agent B (state engine). Baseline, smoothing, situation classifier, seated time, away detection.
import type { Bus, PrivacyService, StateEngine } from '@shared/types'

export interface StateDeps {
  bus: Bus
  privacy: PrivacyService
}

export function createStateEngine(deps: StateDeps): StateEngine {
  void deps
  throw new Error('state: not implemented')
}
