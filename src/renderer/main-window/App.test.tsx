// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_PRIVACY, DEFAULT_SETTINGS, type Session } from '@shared/types'
import { installFakeBridge } from '../ui/fake-bridge'
import App from './App'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

function setup(
  onboarded = true,
  helped = false,
  playlists: unknown[] = [],
  available: boolean | (() => boolean) = true
): ReturnType<typeof installFakeBridge> {
  let settings = { ...DEFAULT_SETTINGS, musicHelpShown: helped }
  return installFakeBridge({
    'privacy:get': { ...DEFAULT_PRIVACY, camera: 'not-now', answeredAt: onboarded ? 1 : null },
    'privacy:set': (patch: object) => ({ ...DEFAULT_PRIVACY, ...patch }),
    'settings:get': () => settings,
    'settings:set': (patch: object) => (settings = { ...settings, ...patch }),
    'music:status': () => ({
      available: typeof available === 'function' ? available() : available,
      leaveAlone: false,
      target: null,
      nowPlaying: null,
      scoringQueue: 0,
      scoredCount: 0
    }),
    'music:library': { songs: [], playlists },
    'session:current': null,
    'session:start': (config: Session['config']) => ({
      id: 's1',
      config,
      startedAt: 0,
      status: 'running',
      sensingEnabled: false
    })
  })
}

it('shows after onboarding, remembers Later across launches, and reopens from Music', async () => {
  const bridge = setup(false)
  const view = render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Let’s start' }))
  fireEvent.click(screen.getByRole('radio', { name: /Not now/ }))
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
  expect(await screen.findByRole('dialog')).toHaveAccessibleName('Ovra can play your own playlists')
  fireEvent.click(screen.getByRole('button', { name: 'Later' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(bridge.invokes).toContainEqual({ channel: 'settings:set', req: { musicHelpShown: true } })
  // The saved answers normally come from disk on the next launch.
  view.unmount()
  setup(true, true)
  render(<App />)
  await screen.findByRole('heading', { name: 'New session' })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Music' }))
  fireEvent.click(screen.getByRole('button', { name: 'How do I add one?' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('offers help once more before the first session when no playlist exists, then starts after Later', async () => {
  const bridge = setup(true, true)
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Start session' }))
  await screen.findByRole('dialog')
  expect(bridge.invokes.some((i) => i.channel === 'session:start')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Later' }))
  await screen.findByRole('heading', { name: 'Session running' })
  expect(bridge.invokes.filter((i) => i.channel === 'session:start')).toHaveLength(1)
  expect(bridge.invokes).toContainEqual({
    channel: 'settings:set',
    req: { musicStartHelpShown: true }
  })
  await act(async () => {
    bridge.push('push:session', null)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
  await screen.findByRole('heading', { name: 'Session running' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(bridge.invokes.filter((i) => i.channel === 'session:start')).toHaveLength(2)
})

it('skips the first-session reminder when a playlist has already been added', async () => {
  const bridge = setup(true, true, [{ uri: 'spotify:playlist:1' }])
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Start session' }))
  await screen.findByRole('heading', { name: 'Session running' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(bridge.invokes.filter((i) => i.channel === 'session:start')).toHaveLength(1)
})

it('keeps Spotify status current when switching between Music and Session', async () => {
  const bridge = setup(true, true, [{ uri: 'spotify:playlist:1' }])
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Start session' }))
  await screen.findByRole('heading', { name: 'Session running' })
  bridge.push('push:music', {
    available: false,
    leaveAlone: false,
    target: null,
    nowPlaying: null,
    scoringQueue: 0,
    scoredCount: 0
  })
  expect(
    screen.getByText("Spotify isn't open. Open the Spotify app to play your music.")
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Music' }))
  await act(async () => {
    bridge.push('push:music', {
      available: true,
      leaveAlone: false,
      target: 'steady',
      nowPlaying: null,
      scoringQueue: 0,
      scoredCount: 0
    })
  })
  expect(
    screen.queryByText("Spotify isn't open. Open the Spotify app to play your music.")
  ).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^Session/ }))
  expect(
    screen.queryByText("Spotify isn't open. Open the Spotify app to play your music.")
  ).toBeNull()
})

describe('Spotify session start', () => {
  afterEach(() => vi.useRealTimers())
  const starts = (bridge: ReturnType<typeof setup>): unknown[] =>
    bridge.invokes.filter((i) => i.channel === 'session:start').map((i) => i.req)

  it.each([false, true])(
    'waits before starting, then auto-continues with music (demo=%s)',
    async (demo) => {
      let available = false
      const bridge = setup(true, true, [{ uri: 'spotify:playlist:1' }], () => available)
      const view = render(<App />)
      const start = await screen.findByRole('button', { name: 'Start session' })
      if (demo) fireEvent.click(screen.getByRole('switch', { name: 'Demo mode' }))
      vi.useFakeTimers()
      await act(async () => fireEvent.click(start))
      expect(screen.getByRole('dialog')).toHaveAccessibleName("Spotify isn't open")
      expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
        "Ovra plays your music through the Spotify app. Open Spotify, and Ovra will start as soon as it's ready."
      )
      expect(starts(bridge)).toEqual([])
      await act(async () => vi.advanceTimersByTimeAsync(2000))
      expect(starts(bridge)).toEqual([])
      available = true
      await act(async () => vi.advanceTimersByTimeAsync(2000))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(starts(bridge)).toEqual([
        expect.objectContaining({ music: true, ...(demo ? { demo: true } : {}) })
      ])
      await act(async () => vi.advanceTimersByTimeAsync(4000))
      expect(starts(bridge)).toHaveLength(1)
      view.unmount()
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('starts without music for this session and leaves the saved music choice on', async () => {
    const bridge = setup(true, true, [{ uri: 'spotify:playlist:1' }], false)
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start session' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Start without music' }))
    await screen.findByRole('heading', { name: 'Session running' })
    expect(starts(bridge)).toEqual([expect.objectContaining({ music: false })])
    expect(bridge.invokes.some((i) => i.channel === 'privacy:set')).toBe(false)
    bridge.push('push:session', null)
    expect(screen.getByRole('switch', { name: 'Music' })).toHaveAttribute('aria-checked', 'true')
  })

  it.each(['button', 'Escape'])(
    'cancels back to setup via %s and stops checking',
    async (method) => {
      const bridge = setup(true, true, [{ uri: 'spotify:playlist:1' }], false)
      render(<App />)
      const start = await screen.findByRole('button', { name: 'Start session' })
      vi.useFakeTimers()
      await act(async () => fireEvent.click(start))
      if (method === 'button') fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      else fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
      await act(async () => {})
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(start).toBeEnabled()
      const count = bridge.invokes.length
      await act(async () => vi.advanceTimersByTimeAsync(6000))
      expect(bridge.invokes).toHaveLength(count)
      expect(starts(bridge)).toEqual([])
    }
  )

  it('ignores a successful availability reply after Cancel', async () => {
    const bridge = setup(true, true, [{ uri: 'spotify:playlist:1' }], false)
    render(<App />)
    const start = await screen.findByRole('button', { name: 'Start session' })
    vi.useFakeTimers()
    await act(async () => fireEvent.click(start))
    let resolve!: (status: unknown) => void
    vi.spyOn(window.ovra, 'invoke').mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }) as never
    )
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => {
      resolve({ available: true })
    })
    expect(starts(bridge)).toEqual([])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('starts straight away when music is off, even with Spotify closed', async () => {
    const bridge = setup(true, true, [{ uri: 'spotify:playlist:1' }], false)
    render(<App />)
    const start = await screen.findByRole('button', { name: 'Start session' })
    fireEvent.click(screen.getByRole('switch', { name: 'Music' }))
    const checks = bridge.invokes.filter((i) => i.channel === 'music:status').length
    fireEvent.click(start)
    await screen.findByRole('heading', { name: 'Session running' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(starts(bridge)).toEqual([expect.objectContaining({ music: false })])
    expect(bridge.invokes.filter((i) => i.channel === 'music:status')).toHaveLength(checks)
  })
})
