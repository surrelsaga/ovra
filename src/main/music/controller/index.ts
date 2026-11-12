// Owner: Agent C (music). The ONLY folder allowed to call osascript or other Mac-only APIs.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { MusicController, NowPlaying } from '@shared/types'
import { musicConfig } from '../config'

const exec = promisify(execFile)

/** Strict Spotify URI check. Anything else never reaches a script. */
export const SPOTIFY_URI = /^spotify:(track|playlist|album|artist|episode|show):[A-Za-z0-9]{1,64}$/

export type OsascriptRunner = (script: string) => Promise<string>

/** Runs one AppleScript with execFile (no shell). Returns stdout without the trailing newline. */
export const runOsascript: OsascriptRunner = async (script) => {
  const { stdout } = await exec('osascript', ['-e', script], {
    timeout: musicConfig.controller.osascriptTimeoutMs
  })
  return stdout.replace(/\n$/, '')
}

/** Any `tell application "Spotify"` launches Spotify, so every command is guarded by this. */
const IF_RUNNING = 'if application "Spotify" is running then'

const CURRENT_SCRIPT = `${IF_RUNNING}
  tell application "Spotify"
    if player state is stopped then return ""
    set t to current track
    return (id of t) & tab & (name of t) & tab & (artist of t) & tab & (album of t) & tab & (duration of t) & tab & (player position) & tab & (player state) & tab & (spotify url of t)
  end tell
end if
return ""`

/** Parses CURRENT_SCRIPT output. Position uses the locale decimal separator ("2,84"). */
export function parseNowPlaying(out: string): NowPlaying | null {
  const f = out.split('\t')
  if (f.length < 8 || !f[0].trim()) return null
  const id = f[0].trim()
  const num = (s: string): number => {
    const n = Number(s.trim().replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }
  const state = f[6].trim()
  return {
    id,
    uri: f[7].trim() || id,
    name: f[1],
    artist: f[2],
    album: f[3],
    durationMs: Math.round(num(f[4])),
    positionMs: Math.round(num(f[5]) * 1000),
    state: state === 'playing' || state === 'paused' ? state : 'stopped',
    isAd: id.startsWith('spotify:ad:')
  }
}

function assertUri(uri: string): void {
  if (!SPOTIFY_URI.test(uri)) throw new Error('music controller: invalid Spotify URI')
}

export class SpotifyMacController implements MusicController {
  constructor(private run: OsascriptRunner = runOsascript) {}

  private tell(cmd: string): Promise<string> {
    return this.run(`${IF_RUNNING} tell application "Spotify" to ${cmd}`)
  }

  async isAvailable(): Promise<boolean> {
    try {
      return (await this.run('application "Spotify" is running')).trim() === 'true'
    } catch {
      return false
    }
  }

  async play(uri: string, contextUri?: string): Promise<void> {
    assertUri(uri)
    if (contextUri !== undefined) assertUri(contextUri)
    await this.tell(
      contextUri ? `play track "${uri}" in context "${contextUri}"` : `play track "${uri}"`
    )
  }

  async pause(): Promise<void> {
    await this.tell('pause')
  }

  async resume(): Promise<void> {
    await this.tell('play')
  }

  async next(): Promise<void> {
    await this.tell('next track')
  }

  async setVolume(pct: number): Promise<void> {
    const v = Math.round(Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0)))
    await this.tell(`set sound volume to ${v}`)
  }

  async current(): Promise<NowPlaying | null> {
    try {
      return parseNowPlaying(await this.run(CURRENT_SCRIPT))
    } catch {
      return null
    }
  }

  /** Fires when the track id or player state changes. */
  onTrackChange(cb: (t: NowPlaying) => void): () => void {
    let last = ''
    let busy = false
    const timer = setInterval(async () => {
      if (busy) return
      busy = true
      const t = await this.current()
      busy = false
      const key = t ? `${t.id}|${t.state}` : ''
      if (t && key !== last) cb(t)
      last = key
    }, musicConfig.controller.pollMs)
    return () => clearInterval(timer)
  }
}

/** Off macOS (until the Windows controller exists): never available, does nothing. */
const noopController: MusicController = {
  isAvailable: async () => false,
  play: async () => {},
  pause: async () => {},
  resume: async () => {},
  next: async () => {},
  setVolume: async () => {},
  current: async () => null,
  onTrackChange: () => () => {}
}

/** Returns the controller for this platform (Mac: SpotifyMacController). */
export function createMusicController(): MusicController {
  return process.platform === 'darwin' ? new SpotifyMacController() : noopController
}
