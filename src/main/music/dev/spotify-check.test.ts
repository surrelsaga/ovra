import { describe, expect, it, vi } from 'vitest'
import { SpotifyMacController } from '../controller'
import { runSpotifyCheck } from './spotify-check'

describe('Spotify check cleanup', () => {
  it('restores track, volume, and the prior paused state after the check', async () => {
    vi.useFakeTimers()
    const scripts: string[] = []
    const runner = vi.fn(async (script: string) => {
      scripts.push(script)
      if (script === 'application "Spotify" is running') return 'true'
      if (script.includes('get sound volume')) return '67'
      if (script.includes('set sound volume')) return ''
      if (script.includes('player state is stopped'))
        return [
          'spotify:track:before',
          'Title',
          'Artist',
          'Album',
          '1000',
          '12',
          'paused',
          'spotify:track:before'
        ].join('\t')
      return ''
    })
    const controller = new SpotifyMacController(runner)
    const check = runSpotifyCheck(controller, runner, 'spotify:track:check')
    await vi.runAllTimersAsync()
    await check
    expect(scripts).toContain(
      'if application "Spotify" is running then tell application "Spotify" to set sound volume to 67'
    )
    expect(scripts).toContain(
      'if application "Spotify" is running then tell application "Spotify" to play track "spotify:track:before"'
    )
    expect(scripts.at(-1)).toContain('pause')
    vi.useRealTimers()
  })
})
