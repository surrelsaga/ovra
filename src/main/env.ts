import { config } from 'dotenv'
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type EnvKey = 'PRESAGE_API_KEY' | 'OPENROUTER_API_KEY' | 'LASTFM_API_KEY'

let loaded = false

/** Prefer the development .env, then the user's packaged-app config. */
export function resolveEnvPath(devPath: string, userDataPath: string, override?: string): string {
  return override ?? (existsSync(devPath) ? devPath : join(userDataPath, '.env'))
}

/** Loads .env once from the app folder (dev) or OVRA_ENV_PATH. Never logs values. */
export function loadEnv(): void {
  if (loaded) return
  loaded = true
  const path = resolveEnvPath(
    join(app?.getAppPath?.() ?? process.cwd(), '.env'),
    app?.getPath?.('userData') ?? process.cwd(),
    process.env.OVRA_ENV_PATH
  )
  config({ path, quiet: true })
}

/** Returns the key or null. Never print the result. */
export function getKey(name: EnvKey): string | null {
  loadEnv()
  const user = process.env[name]?.trim()
  const bundled = name === 'PRESAGE_API_KEY' ? process.env.OVRA_BUNDLED_PRESAGE_API_KEY?.trim() : ''
  return user || bundled || null
}
