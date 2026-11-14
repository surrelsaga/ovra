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
  playlists: unknown[] = []
): ReturnType<typeof installFakeBridge> {
  let settings = { ...DEFAULT_SETTINGS, musicHelpShown: helped }
  return installFakeBridge({
    'privacy:get': { ...DEFAULT_PRIVACY, camera: 'not-now', answeredAt: onboarded ? 1 : null },
    'privacy:set': (patch: object) => ({ ...DEFAULT_PRIVACY, ...patch }),
    'settings:get': () => settings,
    'settings:set': (patch: object) => (settings = { ...settings, ...patch }),
    'music:status': {
      available: false,
      leaveAlone: false,
      target: null,
      nowPlaying: null,
      scoringQueue: 0,
      scoredCount: 0
    },
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
