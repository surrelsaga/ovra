// Owner: Agent F (privacy + storage). Consent, settings, history, deletion, auto-delete.
import type { Bus, PrivacyService, Storage } from '@shared/types'

export interface PrivacyDeps {
  storage: Storage
  bus: Bus
}

export async function createPrivacy(deps: PrivacyDeps): Promise<PrivacyService> {
  void deps
  throw new Error('privacy: not implemented')
}

/** Registers privacy:*, settings:*, history:*, data:* IPC handlers. */
export function registerPrivacyIpc(privacy: PrivacyService): void {
  void privacy
}
