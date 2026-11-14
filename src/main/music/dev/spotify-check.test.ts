import { readFileSync } from 'node:fs'
import { SpotifyMacController } from '../controller'
import { runSpotifyCheck } from './spotify-check'

const html = readFileSync(new URL('../library/fixtures/piano.html', import.meta.url), 'utf8')
const url = 'spotify:playlist:37i9dQZF1DX4sWSpwq3LiO'

function setup(fail = false): { controller: SpotifyMacController; scripts: string[] } {
  const scripts: string[] = []
  const controller = new SpotifyMacController(async (script) => {
    scripts.push(script)
    if (script === 'application "Spotify" is running') return 'true'
    if (script.includes('shuffling as text')) return '67\ttrue\tfalse\t12,5\tpaused'
    if (script.includes('player state is stopped'))
      return [
        'spotify:track:before',
        'Title',
        'Artist',
        'Album',
        '1000',
        '12.5',
        'paused',
        'spotify:track:before'
      ].join('\t')
    if (fail && script.includes('in context')) throw new Error('play failed')
    return ''
  })
  return { controller, scripts }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('plays three distinct playlist-context picks and restores track, position, shuffle, repeat, volume and pause', async () => {
  const { controller, scripts } = setup()
  const check = runSpotifyCheck(controller, url, async () => new Response(html))
  await vi.runAllTimersAsync()
  await check
  const picks = scripts.filter((s) => s.includes('in context'))
  expect(picks).toHaveLength(3)
  expect(new Set(picks).size).toBe(3)
  expect(picks.every((s) => s.includes(`in context "${url}"`))).toBe(true)
  expect(scripts.slice(-6).join('\n')).toContain('play track "spotify:track:before"')
  expect(scripts.slice(-6).join('\n')).toContain('set player position to 12.5')
  expect(scripts.slice(-6).join('\n')).toContain('set shuffling to true')
  expect(scripts.slice(-6).join('\n')).toContain('set repeating to false')
  expect(scripts.slice(-6).join('\n')).toContain('set sound volume to 67')
  expect(scripts.at(-1)).toContain('pause')
})

it('restores on play error and on Ctrl+C', async () => {
  const failed = setup(true)
  await expect(
    runSpotifyCheck(failed.controller, url, async () => new Response(html))
  ).rejects.toThrow('play failed')
  expect(failed.scripts.at(-1)).toContain('pause')
  const interrupted = setup()
  const check = runSpotifyCheck(interrupted.controller, url, async () => new Response(html))
  await vi.advanceTimersByTimeAsync(0)
  process.emit('SIGINT')
  await vi.runAllTimersAsync()
  await check
  expect(interrupted.scripts.filter((s) => s.includes('in context'))).toHaveLength(1)
  expect(interrupted.scripts.at(-1)).toContain('pause')
})

it('does nothing if Spotify is closed or state cannot be saved', async () => {
  const f = vi.fn(async () => new Response(html))
  const run = vi.fn(async () => 'false')
  await runSpotifyCheck(new SpotifyMacController(run), url, f)
  expect(run).toHaveBeenCalledTimes(1)
  expect(f).not.toHaveBeenCalled()
  const invalid = new SpotifyMacController(async (script) =>
    script.includes('is running') && !script.includes('then') ? 'true' : ''
  )
  await expect(runSpotifyCheck(invalid, url, f)).rejects.toThrow('Could not save')
  expect(f).not.toHaveBeenCalled()
})

it('refuses to interrupt an ad because it cannot restore that item', async () => {
  const scripts: string[] = []
  const c = new SpotifyMacController(async (script) => {
    scripts.push(script)
    if (script === 'application "Spotify" is running') return 'true'
    if (script.includes('shuffling as text')) return '50\tfalse\tfalse\t0\tplaying'
    if (script.includes('player state is stopped'))
      return ['spotify:ad:x', 'Ad', '', '', '30000', '0', 'playing', 'spotify:ad:x'].join('\t')
    return ''
  })
  const f = vi.fn(async () => new Response(html))
  await expect(runSpotifyCheck(c, url, f)).rejects.toThrow('Cannot restore')
  expect(f).not.toHaveBeenCalled()
  expect(scripts.some((s) => s.includes('play track') || s.includes('set sound volume'))).toBe(
    false
  )
})
