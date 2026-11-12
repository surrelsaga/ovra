// Owner: Agent E (orb + shell). Main window, orb window, move card window; forwards bus state to renderers.
import type { Bus, PrivacyService, WindowsService } from '@shared/types'

export interface WindowsDeps {
  bus: Bus
  privacy: PrivacyService
}

export function createWindows(deps: WindowsDeps): WindowsService {
  void deps
  throw new Error('windows: not implemented')
}

/** Registers window:* and dev:list-videos IPC handlers. */
export function registerWindowsIpc(windows: WindowsService): void {
  void windows
}
