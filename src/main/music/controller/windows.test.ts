import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseWindowsNowPlaying, SpotifyWindowsController, type PowerShellRunner } from './windows'
import { createMusicController } from './index'

it('selects the Windows controller without calling Mac commands', () => {
  vi.stubGlobal('process', { ...process, platform: 'win32' })
  try {
    const controller = createMusicController()
    expect(controller).toBeInstanceOf(SpotifyWindowsController)
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('Windows Spotify controller', () => {
  it('rejects invalid URIs before invoking PowerShell', async () => {
    const run = vi.fn(async () => '')
    await expect(new SpotifyWindowsController(run).play("spotify:track:x'; exit")).rejects.toThrow(
      'invalid Spotify URI'
    )
    expect(run).not.toHaveBeenCalled()
  })

  it('parses SMTC properties with a stable encoded pseudo id', () => {
    const track = parseWindowsNowPlaying(
      JSON.stringify({
        title: 'A Song',
        artist: 'Some Artist',
        album: 'An Album',
        durationMs: 180000,
        positionMs: 1200,
        state: 'Playing'
      })
    )
    expect(track).toMatchObject({
      id: 'spotify:local:Some%20Artist:A%20Song',
      uri: 'spotify:local:Some%20Artist:A%20Song',
      durationMs: 180000,
      positionMs: 1200,
      state: 'playing',
      isAd: false
    })
    expect(parseWindowsNowPlaying('')).toBeNull()
  })

  it.each([
    { artist: '', isAd: true },
    { artist: 'Spotify', isAd: true },
    { artist: 'Some Artist', isAd: false }
  ])('detects ads from artist "$artist"', ({ artist, isAd }) => {
    expect(parseWindowsNowPlaying(JSON.stringify({ title: 'Audio', artist }))?.isAd).toBe(isAd)
  })

  it('checks the process without launching Spotify', async () => {
    const calls: string[] = []
    const controller = new SpotifyWindowsController(async (script) => {
      calls.push(script)
      return 'true'
    })
    expect(await controller.isAvailable()).toBe(true)
    expect(calls[0]).toContain('Get-Process Spotify')
    expect(calls[0]).not.toContain('Start-Process')
  })

  it('polls for track and state changes and unsubscribes', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () =>
      JSON.stringify({ title: 'A Song', artist: 'Artist', state: 'Playing' })
    )
    const controller = new SpotifyWindowsController(run)
    const cb = vi.fn()
    const stop = controller.onTrackChange(cb)
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(cb).toHaveBeenCalledTimes(1)
    stop()
    await vi.advanceTimersByTimeAsync(4000)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})

afterEach(() => vi.useRealTimers())

it('opens the selected playlist context on Windows only if Spotify is running', async () => {
  const run = vi.fn<PowerShellRunner>().mockResolvedValue('')
  await new SpotifyWindowsController(run).play('spotify:track:a', 'spotify:playlist:b')
  expect(run.mock.calls[0][0]).toContain('Get-Process Spotify')
  expect(run.mock.calls[0][0]).toContain("Start-Process 'spotify:playlist:b'")
})
