// Owner: Agent C (music). The ONLY folder allowed to call osascript or other Mac-only APIs.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { MusicController, NowPlaying } from '@shared/types'
import { musicConfig } from '../config'
import { SpotifyWindowsController } from './windows'

const exec = promisify(execFile)

/** Strict Spotify URI check. Anything else never reaches a script. */
export const SPOTIFY_URI = /^spotify:(track|playlist|album|artist|episode|show):[A-Za-z0-9]{1,64}$/

export type OsascriptRunner = (script: string) => Promise<string>
export type CommandRunner = (cmd: string, args: string[]) => Promise<string>

/** Shuffle and repeat, saved at session start and restored at the end (decision 61). */
export interface PlayMode {
  shuffle: boolean
  repeat: boolean
}
export interface PlayModeControl {
  playMode(): Promise<PlayMode | null>
  setPlayMode(mode: PlayMode): Promise<void>
}

/** LaunchServices tools: no Automation or Accessibility permission (unlike System Events). */
const runCommand: CommandRunner = async (cmd, args) => {
  const { stdout } = await exec(cmd, args, { timeout: musicConfig.controller.osascriptTimeoutMs })
  return stdout.trim()
}

const SPOTIFY_BUNDLE = 'com.spotify.client'
/** `lsappinfo front` prints `ASN:0x0-0x2c02c:`, `find` prints `ASN:0x0-0x44044-"Spotify":`. */
const asn = (out: string): string | null => /ASN:0x[0-9a-f]+-0x[0-9a-f]+/i.exec(out)?.[0] ?? null
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

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
  const label = (s: string): string =>
    s
      .trim()
      .toLowerCase()
      .replace(/[.!]+$/, '')
  const durationMs = Math.round(num(f[4]))
  const { promoTitles, adMetadata } = musicConfig.controller
  return {
    id,
    uri: f[7].trim() || id,
    name: f[1],
    artist: f[2],
    album: f[3],
    durationMs,
    positionMs: Math.round(num(f[5]) * 1000),
    state: state === 'playing' || state === 'paused' ? state : 'stopped',
    isAd:
      id.startsWith('spotify:ad:') ||
      f[7].trim().startsWith('spotify:ad:') ||
      (!f[2].trim() && promoTitles.some((title) => title === label(f[1]))) ||
      [f[2], f[3]].some((s) => adMetadata.some((value) => value === label(s))) ||
      (!f[2].trim() && !f[3].trim() && durationMs <= 0)
  }
}

function assertUri(uri: string): void {
  if (!SPOTIFY_URI.test(uri)) throw new Error('music controller: invalid Spotify URI')
}

export class SpotifyMacController implements MusicController, PlayModeControl {
  constructor(
    private run: OsascriptRunner = runOsascript,
    // A fake AppleScript runner (tests) never reaches the real LaunchServices tools either.
    private sh: CommandRunner = run === runOsascript ? runCommand : async () => ''
  ) {}

  refocusResult = 'not attempted'

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
    this.refocusResult = 'front app unavailable'
    const before = await this.frontApp()
    await this.tell(
      contextUri ? `play track "${uri}" in context "${contextUri}"` : `play track "${uri}"`
    )
    if (before) await this.refocus(before)
  }

  /** The app in front before a `play track`, unless it is Spotify (the user is there themselves). */
  private async frontApp(): Promise<{ asn: string; path: string } | null> {
    try {
      const front = asn(await this.sh('lsappinfo', ['front']))
      const spotify = asn(await this.sh('lsappinfo', ['find', `bundleid=${SPOTIFY_BUNDLE}`]))
      if (front === spotify && front) this.refocusResult = 'already in Spotify'
      if (!front || front === spotify) return null
      const out = await this.sh('lsappinfo', ['info', '-only', 'bundlepath', front])
      const path = /"LSBundlePath"="(.+)"/.exec(out)?.[1]
      return path?.endsWith('.app') ? { asn: front, path } : null
    } catch {
      return null
    }
  }

  /**
   * `play track` always brings Spotify to the front (decision 61). Put the user's app back as soon as
   * Spotify is in front. `open -a <path>` reactivates that exact running app (`open -b` could pick
   * another copy with the same bundle id, e.g. a second Electron.app in dev).
   */
  private async refocus(before: { asn: string; path: string }): Promise<void> {
    const { refocusPollMs, refocusGiveUpMs } = musicConfig.steering
    try {
      const spotify = asn(await this.sh('lsappinfo', ['find', `bundleid=${SPOTIFY_BUNDLE}`]))
      if (!spotify) {
        this.refocusResult = 'Spotify unavailable'
        return
      }
      for (let waited = 0; waited <= refocusGiveUpMs; waited += refocusPollMs) {
        const front = asn(await this.sh('lsappinfo', ['front']))
        if (front === spotify) {
          await this.sh('open', ['-a', before.path])
          this.refocusResult = 'previous app requested'
          return
        }
        // The user moved to another app themselves: leave it.
        if (front && front !== before.asn) {
          this.refocusResult = 'user changed app'
          return
        }
        await sleep(refocusPollMs)
      }
      this.refocusResult = 'timed out; Spotify did not come forward'
    } catch {
      this.refocusResult = 'failed'
      // Refocus is a nicety; playback already started.
    }
  }

  async playMode(): Promise<PlayMode | null> {
    try {
      const [shuffle, repeat] = (
        await this.run(
          `${IF_RUNNING}\n  tell application "Spotify" to return (shuffling as text) & tab & (repeating as text)\nend if\nreturn ""`
        )
      )
        .trim()
        .split('\t')
      const bool = (v: string | undefined): boolean | null =>
        v === 'true' ? true : v === 'false' ? false : null
      const s = bool(shuffle)
      const r = bool(repeat)
      return s === null || r === null ? null : { shuffle: s, repeat: r }
    } catch {
      return null
    }
  }

  async setPlayMode(mode: PlayMode): Promise<void> {
    await this.tell(`set shuffling to ${mode.shuffle === true}`)
    await this.tell(`set repeating to ${mode.repeat === true}`)
  }

  /** Dev check only: save everything before touching playback, restore even after failure or Ctrl+C. */
  async withPlaybackRestored(action: (interrupted: () => boolean) => Promise<void>): Promise<void> {
    const saved = await this.run(`${IF_RUNNING}
      tell application "Spotify"
        return (sound volume as text) & tab & (shuffling as text) & tab & (repeating as text) & tab & (player position as text) & tab & (player state as text)
      end tell
    end if
    return ""`)
    const [volume, shuffle, repeat, position, state] = saved.trim().split('\t')
    const v = Number(volume)
    const pos = Number(position?.replace(',', '.'))
    if (
      !volume?.trim() ||
      !Number.isFinite(v) ||
      v < 0 ||
      v > 100 ||
      !['true', 'false'].includes(shuffle) ||
      !['true', 'false'].includes(repeat) ||
      !position?.trim() ||
      !Number.isFinite(pos) ||
      pos < 0 ||
      !['playing', 'paused', 'stopped'].includes(state)
    )
      throw new Error('Could not save Spotify state; playback was not changed')
    const track = await this.current()
    if (state !== 'stopped' && !track)
      throw new Error('Could not save Spotify track; playback was not changed')
    if (track && (track.isAd || !SPOTIFY_URI.test(track.uri)))
      throw new Error('Cannot restore this Spotify item; playback was not changed')
    let interrupted = false
    const onInterrupt = (): void => {
      interrupted = true
    }
    process.on('SIGINT', onInterrupt)
    process.on('SIGTERM', onInterrupt)
    try {
      await action(() => interrupted)
    } finally {
      try {
        try {
          if (track) await this.play(track.uri)
        } finally {
          try {
            await this.tell(`set player position to ${pos}`)
          } finally {
            try {
              await this.tell(`set shuffling to ${shuffle}`)
            } finally {
              try {
                await this.tell(`set repeating to ${repeat}`)
              } finally {
                try {
                  await this.setVolume(v)
                } finally {
                  if (state !== 'playing') await this.pause()
                }
              }
            }
          }
        }
      } finally {
        process.off('SIGINT', onInterrupt)
        process.off('SIGTERM', onInterrupt)
      }
    }
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

  async getVolume(): Promise<number | null> {
    try {
      const out = await this.run(
        `${IF_RUNNING}\n  tell application "Spotify" to return sound volume\nend if\nreturn ""`
      )
      if (!out.trim()) return null
      const volume = Number(out.trim())
      return Number.isFinite(volume) && volume >= 0 && volume <= 100 ? volume : null
    } catch {
      return null
    }
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
    let position = 0
    let busy = false
    const timer = setInterval(async () => {
      if (busy) return
      busy = true
      const t = await this.current()
      busy = false
      const key = t ? `${t.id}|${t.state}` : ''
      if (t && (key !== last || t.positionMs + musicConfig.controller.restartSlackMs < position))
        cb(t)
      position = t?.positionMs ?? 0
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
  return process.platform === 'win32'
    ? new SpotifyWindowsController()
    : process.platform === 'darwin'
      ? new SpotifyMacController()
      : noopController
}
