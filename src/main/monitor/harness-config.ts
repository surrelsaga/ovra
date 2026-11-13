import { stateConfig } from '../state/config'

export const monitorHarnessConfig = {
  calibrationMs: 6000,
  awayObserveMs: stateConfig.awayNoFaceSec * 1000 + 2000,
  sampleMs: 1000,
  settleMs: 1200,
  sessionLengthMin: 1,
  rawPayloadsPerSec: 28,
  snapshotsPerSec: 4,
  pulseConfidence: 75,
  syntheticPulse: 70
} as const
