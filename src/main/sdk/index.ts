// Owner: Agent A (sensing). SmartSpectra setup, check-in scheduler, calibration, return check,
// dev video source. Capture runs in a hidden renderer (src/renderer/capture/).
import type { Bus, PrivacyService, SensingService } from '@shared/types'

export interface SensingDeps {
  bus: Bus
  privacy: PrivacyService
  /** Returns the Presage key, or null if missing. Never log it. */
  getApiKey: () => string | null
}

export function createSensing(deps: SensingDeps): SensingService {
  void deps
  throw new Error('sensing: not implemented')
}
