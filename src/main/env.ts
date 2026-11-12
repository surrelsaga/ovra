import { config } from 'dotenv'
import { app } from 'electron'
import { join } from 'node:path'

export type EnvKey = 'PRESAGE_API_KEY' | 'OPENROUTER_API_KEY' | 'LASTFM_API_KEY'

let loaded = false

/** Loads .env once from the app folder (dev) or OVRA_ENV_PATH. Never logs values. */
export function loadEnv(): void {
  if (loaded) return
  loaded = true
  const path = process.env.OVRA_ENV_PATH ?? join(app?.getAppPath?.() ?? process.cwd(), '.env')
  config({ path, quiet: true })
}

/** Returns the key or null. Never print the result. */
export function getKey(name: EnvKey): string | null {
  loadEnv()
  const v = process.env[name]
  return v && v.trim() ? v.trim() : null
}
