// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import type { OrbView } from '@shared/types'
import { installFakeBridge } from '../ui/fake-bridge'
import App from './App'

const moon = (): HTMLElement => screen.getByRole('img', { name: /Ovra moon/ })

describe('orb window', () => {
  it('maps every orb view field to what is shown', async () => {
    const bridge = installFakeBridge()
    render(<App />)
    expect(moon()).toHaveAttribute('data-mood', 'calm')

    for (const mood of ['calm', 'uneasy', 'stormy', 'dim', 'bright'] as const) {
      bridge.push('push:orb', { mood, listening: false, away: false })
      expect(moon()).toHaveAttribute('data-mood', mood)
      expect(moon()).toHaveAccessibleName(`Ovra moon, ${mood}`)
    }

    const listening: OrbView = { mood: 'calm', listening: true, away: false, bubble: 'Checking in' }
    bridge.push('push:orb', listening)
    expect(screen.getByTestId('listening-ring')).toBeInTheDocument()
    expect(screen.getByText('Camera on')).toBeInTheDocument()
    expect(screen.getByText('Checking in')).toBeInTheDocument()

    bridge.push('push:orb', {
      mood: 'dim',
      listening: false,
      away: true,
      awaySince: Date.now() - 12 * 60_000
    })
    expect(moon()).toHaveAttribute('data-away', 'true')
    expect(await screen.findByText('Away · 12 min')).toBeInTheDocument()
    expect(screen.queryByTestId('listening-ring')).toBeNull()

    bridge.push('push:orb', { mood: 'calm', listening: false, away: false, breath: 1 })
    expect(moon()).toHaveAttribute('data-breathing', 'true')
    expect(moon().style.getPropertyValue('--breath')).toBe('1')

    bridge.push('push:orb', {
      mood: 'calm',
      listening: false,
      away: false,
      nowPlaying: { name: 'Weightless', artist: 'Marconi Union', word: 'Calm' }
    })
    expect(screen.getByText('Calm')).toBeInTheDocument()
    expect(screen.getByText(/Weightless/)).toBeInTheDocument()
  })

  it('has labelled mini controls that call the right channels', () => {
    const bridge = installFakeBridge()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause camera' }))
    expect(screen.getByRole('button', { name: 'Resume camera' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Leave my music alone' }))
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open main window' }))
    expect(bridge.invokes.map((c) => c.channel)).toEqual([
      'camera:pause',
      'music:set-leave-alone',
      'session:end',
      'window:open-main'
    ])
    expect(bridge.invokes[1].req).toEqual({ value: true })
  })
})
