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

  it.each([
    ['spotify:track:promo', 'Listen to music, ad-free.', '', '', '30000', ''],
    ['spotify:track:promo', ' LISTEN TO MUSIC, AD-FREE. ', ' ', '', '30000', ''],
    ['spotify:track:promo', 'Spotify Premium', '', '', '30000', ''],
    ['spotify:track:promo', 'Advertisement', '', '', '30000', ''],
    ['spotify:track:promo', 'A sponsor', 'Advertisement', '', '30000', ''],
    ['spotify:track:promo', 'A sponsor', '', 'Spotify Advertisement', '30000', ''],
    ['spotify:track:promo', 'A sponsor', '', '', '0', ''],
    ['spotify:track:promo', 'A sponsor', 'a', 'b', '30000', 'spotify:ad:promo']
  ])('marks ad variant %j / %j', (id, name, artist, album, duration, uri) => {
    expect(
      parseNowPlaying(line([id, name, artist, album, duration, '0', 'playing', uri]))?.isAd
    ).toBe(true)
  })

  it.each([
    ['Listen to music, ad-free.', 'A real artist', '', '30000'],
    ['Advertisement', 'A real artist', 'Album', '200000'],
    ['A short song', 'Artist', 'Album', '1000'],
    ['An untitled recording', '', '', '30000'],
    ['Missing duration', 'Artist', '', '0']
  ])('keeps real track metadata %j / %j', (name, artist, album, duration) => {
    expect(
      parseNowPlaying(line(['spotify:track:a', name, artist, album, duration, '0', 'playing', '']))
        ?.isAd
    ).toBe(false)
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

  it('reads sound volume only while Spotify is already running and returns null on bad output', async () => {
    const { c, scripts } = make('42')
    expect(await c.getVolume?.()).toBe(42)
    expect(scripts[0]).toContain('if application "Spotify" is running then')
    expect(scripts[0]).toContain('return sound volume')
    expect(await make('missing').c.getVolume?.()).toBeNull()
    const failed = new SpotifyMacController(async () => {
      throw new Error('not running')
    })
    expect(await failed.getVolume?.()).toBeNull()
  })

  it.each(['', '   ', '\n', 'missing', 'NaN', 'Infinity', '-1', '101'])(
    'treats volume output %j as unknown',
    async (out) => {
      expect(await make(out).c.getVolume()).toBeNull()
    }
  )

  it.each(['0', '100', ' 42 \n'])('accepts a known volume of %j', async (out) => {
    const { c, scripts } = make(out)
    expect(await c.getVolume()).toBe(Number(out))
    expect(scripts[0]).toContain('to return sound volume')
  })

  it.each([
    '',
    ' ',
    '\ttrue\tfalse\t0\tstopped',
    ' \ttrue\tfalse\t0\tstopped',
    '60\ttrue\tfalse\t\tstopped'
  ])('refuses to change playback when saved state is incomplete: %j', async (out) => {
    const { c, scripts } = make(out)
    const action = vi.fn()
    await expect(c.withPlaybackRestored(action)).rejects.toThrow('Could not save Spotify state')
    expect(action).not.toHaveBeenCalled()
    expect(scripts).toHaveLength(1)
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

it('notifies when a one-song playlist restarts the same track', async () => {
  vi.useFakeTimers()
  try {
    let position = '10'
    const c = new SpotifyMacController(async () =>
      line(['spotify:track:a', 'A', 'Artist', '', '20000', position, 'playing', ''])
    )
    const cb = vi.fn()
    const off = c.onTrackChange(cb)
    await vi.advanceTimersByTimeAsync(2000)
    position = '12'
    await vi.advanceTimersByTimeAsync(2000)
    position = '0'
    await vi.advanceTimersByTimeAsync(2000)
    expect(cb).toHaveBeenCalledTimes(2)
    off()
  } finally {
    vi.useRealTimers()
  }
})

describe('play track pop-up refocus (decision 61)', () => {
  const OVRA = 'ASN:0x0-0x2c02c:'
  const SPOTIFY = 'ASN:0x0-0x44044-"Spotify":'
  /** Fake LaunchServices: `fronts` is what `lsappinfo front` answers on each call. */
  function make(fronts: string[]): { c: SpotifyMacController; cmds: string[] } {
    const cmds: string[] = []
    const c = new SpotifyMacController(
      async () => '',
      async (cmd, args) => {
        cmds.push([cmd, ...args].join(' '))
        if (args[0] === 'front') return fronts.length > 1 ? fronts.shift()! : fronts[0]
        if (args[0] === 'find') return SPOTIFY
        if (args[0] === 'info') return '"LSBundlePath"="/Applications/Ovra.app"'
        return ''
      }
    )
    return { c, cmds }
  }

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('puts the previous app back as soon as Spotify comes to the front', async () => {
    const { c, cmds } = make([OVRA, 'ASN:0x0-0x2c02c:', SPOTIFY])
    const done = c.play('spotify:track:a', 'spotify:playlist:b')
    await vi.advanceTimersByTimeAsync(200)
    await done
    expect(cmds.filter((x) => x.startsWith('open'))).toEqual(['open -a /Applications/Ovra.app'])
    expect(c.refocusResult).toBe('previous app requested')
  })

  it('never refocuses when the user was in Spotify, and gives up after the limit', async () => {
    const inSpotify = make([SPOTIFY])
    await inSpotify.c.play('spotify:track:a')
    expect(inSpotify.cmds.some((x) => x.startsWith('open'))).toBe(false)
    expect(inSpotify.c.refocusResult).toBe('already in Spotify')

    const never = make([OVRA])
    const done = never.c.play('spotify:track:a')
    await vi.advanceTimersByTimeAsync(2000)
    await done
    expect(never.cmds.some((x) => x.startsWith('open'))).toBe(false)
    expect(never.c.refocusResult).toBe('timed out; Spotify did not come forward')
  })

  it('leaves a different app the user switched to alone', async () => {
    const { c, cmds } = make([OVRA, 'ASN:0x0-0x99:'])
    await c.play('spotify:track:a')
    expect(cmds.some((x) => x.startsWith('open'))).toBe(false)
    expect(c.refocusResult).toBe('user changed app')
  })

  it('reports a failed refocus without failing playback', async () => {
    const c = new SpotifyMacController(
      async () => '',
      async (cmd, args) => {
        if (cmd === 'open') throw new Error('refused')
        if (args[0] === 'front') return c.refocusResult === 'front app unavailable' ? OVRA : SPOTIFY
        if (args[0] === 'find') return SPOTIFY
        if (args[0] === 'info') {
          c.refocusResult = 'waiting'
          return '"LSBundlePath"="/Applications/Ovra.app"'
        }
        return ''
      }
    )
    await c.play('spotify:track:a')
    expect(c.refocusResult).toBe('failed')
  })
})

describe('shuffle and repeat', () => {
  it('reads and sets shuffle/repeat only while Spotify runs', async () => {
    const scripts: string[] = []
    const c = new SpotifyMacController(async (s) => {
      scripts.push(s)
      return 'true\tfalse'
    })
    expect(await c.playMode()).toEqual({ shuffle: true, repeat: false })
    await c.setPlayMode({ shuffle: false, repeat: true })
    expect(scripts.every((s) => s.startsWith('if application "Spotify" is running then'))).toBe(
      true
    )
    expect(scripts.slice(1)).toEqual([
      expect.stringContaining('set shuffling to false'),
      expect.stringContaining('set repeating to true')
    ])
    expect(await new SpotifyMacController(async () => '').playMode()).toBeNull()
  })
})
