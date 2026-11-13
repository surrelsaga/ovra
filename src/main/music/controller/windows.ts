import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { MusicController, NowPlaying } from '@shared/types'
import { musicConfig } from '../config'
import { SPOTIFY_URI } from './index'

const exec = promisify(execFile)
export type PowerShellRunner = (script: string) => Promise<string>
export const runPowerShell: PowerShellRunner = async (script) => {
  const { stdout } = await exec(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      timeout: musicConfig.controller.osascriptTimeoutMs
    }
  )
  return stdout.trim()
}

const SESSION = `$ErrorActionPreference = 'Stop'
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$manager = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync().GetAwaiter().GetResult()
$session = $manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -match 'Spotify' } | Select-Object -First 1`
const CURRENT = `${SESSION}
if (-not $session) { exit 0 }
$props = $session.TryGetMediaPropertiesAsync().GetAwaiter().GetResult()
$timeline = $session.GetTimelineProperties()
$info = $session.GetPlaybackInfo()
[pscustomobject]@{ title=$props.Title; artist=$props.Artist; album=$props.AlbumTitle; durationMs=[long]$timeline.EndTime.TotalMilliseconds; positionMs=[long]$timeline.Position.TotalMilliseconds; state=$info.PlaybackStatus.ToString() } | ConvertTo-Json -Compress`

export function parseWindowsNowPlaying(json: string): NowPlaying | null {
  if (!json.trim()) return null
  try {
    const v = JSON.parse(json) as Record<string, unknown>
    const name = typeof v.title === 'string' ? v.title : ''
    const artist = typeof v.artist === 'string' ? v.artist : ''
    if (!name) return null
    const id = `spotify:local:${encodeURIComponent(artist)}:${encodeURIComponent(name)}`
    const state = String(v.state ?? '').toLowerCase()
    return {
      id,
      uri: id,
      name,
      artist,
      album: typeof v.album === 'string' ? v.album : '',
      durationMs: Number.isFinite(Number(v.durationMs)) ? Number(v.durationMs) : 0,
      positionMs: Number.isFinite(Number(v.positionMs)) ? Number(v.positionMs) : 0,
      state: state.includes('playing')
        ? 'playing'
        : state.includes('paused')
          ? 'paused'
          : 'stopped',
      isAd: !artist.trim() || artist.trim().toLowerCase() === 'spotify'
    }
  } catch {
    return null
  }
}

function assertUri(uri: string): void {
  if (!SPOTIFY_URI.test(uri)) throw new Error('music controller: invalid Spotify URI')
}

export class SpotifyWindowsController implements MusicController {
  constructor(private run: PowerShellRunner = runPowerShell) {}

  async isAvailable(): Promise<boolean> {
    try {
      return (
        (
          await this.run(
            "if (Get-Process Spotify -ErrorAction SilentlyContinue) { 'true' } else { 'false' }"
          )
        ).trim() === 'true'
      )
    } catch {
      return false
    }
  }

  async play(uri: string, contextUri?: string): Promise<void> {
    assertUri(uri)
    if (contextUri !== undefined) assertUri(contextUri)
    // URI characters are constrained by SPOTIFY_URI, so this quoted argument cannot break the script.
    await this.run(`Start-Process '${uri}'`)
  }

  private async command(method: 'Pause' | 'Play' | 'Next'): Promise<void> {
    try {
      await this.run(
        `${SESSION}\nif ($session) { $session.Try${method}Async().GetAwaiter().GetResult() | Out-Null }`
      )
    } catch {
      /* Media keys remain available if SMTC is unavailable. */
      await this.run(
        `$w = New-Object -ComObject WScript.Shell; $w.SendKeys([char]${method === 'Next' ? 176 : method === 'Pause' ? 179 : 179})`
      )
    }
  }
  pause(): Promise<void> {
    return this.command('Pause')
  }
  resume(): Promise<void> {
    return this.command('Play')
  }
  next(): Promise<void> {
    return this.command('Next')
  }
  setVolume(): Promise<void> {
    return Promise.resolve()
  }
  async current(): Promise<NowPlaying | null> {
    try {
      return parseWindowsNowPlaying(await this.run(CURRENT))
    } catch {
      return null
    }
  }
  onTrackChange(cb: (t: NowPlaying) => void): () => void {
    let last = ''
    let busy = false
    const timer = setInterval(async () => {
      if (busy) return
      busy = true
      try {
        const t = await this.current()
        const key = t ? `${t.id}|${t.state}` : ''
        if (t && key !== last) cb(t)
        last = key
      } finally {
        busy = false
      }
    }, musicConfig.controller.pollMs)
    return () => clearInterval(timer)
  }
}
