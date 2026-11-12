import { parseNowPlaying, SpotifyMacController } from '.'

const line = (f: string[]): string => f.join('\t')

describe('parseNowPlaying', () => {
  it('parses a track with a comma decimal position', () => {
    const t = parseNowPlaying(
      line([
        'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
        'Never Gonna Give You Up',
        'Rick Astley',
        'Whenever You Need Somebody',
        '213560',
        '2,84',
        'playing',
        'spotify:track:4cOdK2wGLETKBW3PvgPWqT'
      ])
    )
    expect(t).toMatchObject({
      id: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
      artist: 'Rick Astley',
      durationMs: 213560,
      positionMs: 2840,
      state: 'playing',
      isAd: false
    })
  })

  it('parses a dot decimal position', () => {
    const t = parseNowPlaying(
      line(['spotify:track:a', 'n', 'a', 'b', '1000', '12.5', 'paused', ''])
    )
    expect(t?.positionMs).toBe(12500)
    expect(t?.state).toBe('paused')
    expect(t?.uri).toBe('spotify:track:a')
  })

  it('marks ads, with empty artist and album', () => {
    const t = parseNowPlaying(
      line(['spotify:ad:abc123', 'Listen to music, ad-free.', '', '', '30000', '0', 'playing', ''])
    )
    expect(t).toMatchObject({ isAd: true, artist: '', album: '' })
  })

  it('returns null for empty or short output and survives junk numbers', () => {
    expect(parseNowPlaying('')).toBeNull()
    expect(parseNowPlaying('stopped')).toBeNull()
    expect(parseNowPlaying(line(['', '', '', '', '', '', '', '']))).toBeNull()
    const t = parseNowPlaying(line(['spotify:track:a', '', '', '', 'x', '', 'weird', '']))
    expect(t).toMatchObject({ durationMs: 0, positionMs: 0, state: 'stopped', name: '' })
  })
})

describe('SpotifyMacController', () => {
  const make = (out = ''): { c: SpotifyMacController; scripts: string[] } => {
    const scripts: string[] = []
    const c = new SpotifyMacController(async (s) => {
      scripts.push(s)
      return out
    })
    return { c, scripts }
  }

  it('isAvailable only asks if Spotify is running (never tells it anything)', async () => {
    const { c, scripts } = make('true')
    expect(await c.isAvailable()).toBe(true)
    expect(scripts).toEqual(['application "Spotify" is running'])
    expect(await make('false').c.isAvailable()).toBe(false)
  })

  it('guards every command so a closed Spotify is never launched', async () => {
    const { c, scripts } = make()
    await c.play('spotify:track:abc', 'spotify:playlist:def')
    await c.pause()
    await c.resume()
    await c.next()
    await c.setVolume(250)
    await c.current()
    for (const s of scripts)
      expect(s.startsWith('if application "Spotify" is running then')).toBe(true)
    expect(scripts[0]).toContain('play track "spotify:track:abc" in context "spotify:playlist:def"')
    expect(scripts[4]).toContain('set sound volume to 100')
  })

  it('rejects anything that is not a strict Spotify URI', async () => {
    const { c, scripts } = make()
    await expect(c.play('spotify:track:x" & (do shell script "id") & "')).rejects.toThrow()
    await expect(c.play('spotify:track:ok', 'https://evil')).rejects.toThrow()
    await expect(c.play('spotify:local:a:b:c:1')).rejects.toThrow()
    expect(scripts).toEqual([])
  })

  it('onTrackChange fires on track or state change only', async () => {
    vi.useFakeTimers()
    let out = line(['spotify:track:a', 'A', 'x', 'y', '1000', '0', 'playing', ''])
    const c = new SpotifyMacController(async () => out)
    const seen: string[] = []
    const off = c.onTrackChange((t) => seen.push(`${t.id}|${t.state}`))
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(2000)
    out = line(['spotify:track:a', 'A', 'x', 'y', '1000', '1', 'paused', ''])
    await vi.advanceTimersByTimeAsync(2000)
    out = line(['spotify:track:b', 'B', 'x', 'y', '1000', '0', 'playing', ''])
    await vi.advanceTimersByTimeAsync(2000)
    off()
    out = line(['spotify:track:c', 'C', 'x', 'y', '1000', '0', 'playing', ''])
    await vi.advanceTimersByTimeAsync(4000)
    expect(seen).toEqual([
      'spotify:track:a|playing',
      'spotify:track:a|paused',
      'spotify:track:b|playing'
    ])
    vi.useRealTimers()
  })
})
