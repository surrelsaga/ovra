// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_PRIVACY, DEFAULT_SETTINGS, type Session } from '@shared/types'
import { installFakeBridge } from '../ui/fake-bridge'
import App from './App'

it('navigates to Session from the orb action, shows the preview, and stops it on tab changes', async () => {
  const stop = vi.fn()
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  const session: Session = {
    id: 's1',
    startedAt: 0,
    status: 'running',
    sensingEnabled: true,
    config: {
      activity: 'focus',
      lengthMin: 60,
      cameraMode: 'continuous',
      checkinIntervalMin: 5,
      music: false
    }
  }
  const bridge = installFakeBridge({
    'privacy:get': { ...DEFAULT_PRIVACY, camera: 'yes', answeredAt: 1 },
    'settings:get': { ...DEFAULT_SETTINGS, musicHelpShown: true },
    'music:status': {
      available: false,
      leaveAlone: false,
      target: null,
      nowPlaying: null,
      scoringQueue: 0,
      scoredCount: 0
    },
    'session:current': session,
    'session:history': []
  })
  render(<App />)
  await screen.findByRole('heading', { name: 'Session running' })
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  bridge.push('push:main-window', { visible: true, showCamera: true })
  expect(screen.getByRole('heading', { name: 'Session running' })).toBeInTheDocument()
  bridge.push('push:orb', { mood: 'calm', listening: false, paused: false, away: false })
  await act(async () => {
    await Promise.resolve()
  })
  expect(screen.getByText('Not recorded')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  expect(stop).toHaveBeenCalledOnce()
})
