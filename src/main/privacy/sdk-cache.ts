import { rm } from 'node:fs/promises'
import { join } from 'node:path'

/** Matches defaultSdkDirectory in @smartspectra/node-sdk/js/main/index.js. */
export async function clearSdkCache(
  cacheRoot: string,
  appName: string,
  platform: string
): Promise<void> {
  if (platform === 'darwin' || platform === 'win32')
    await rm(join(cacheRoot, appName, 'SmartSpectraSDK'), { recursive: true, force: true })
}
