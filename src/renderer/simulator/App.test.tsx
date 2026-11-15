// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SimulatorStatus } from '@shared/types'
import { installFakeBridge } from '../ui/fake-bridge'
import { App } from './App'

const status: SimulatorStatus = {
  scenario: 'tense',
  speed: 'instant',
  fastMode: true,
  phase: 'continuous',
  state: {
    t: 0,
    situation: 'focused',
    confidence: 0.9,
    seatedMinutes: 0,
    away: false,
    trend: 'steady'
  },
  target: 'ease-down',
  targetWord: 'Calm',
  lastNudge: null,
  countdown: 'Stressed in ~4 s'
}

it('shows current mood, engine countdown, plain labels and Instant speed', async () => {
  const bridge = installFakeBridge({
    'simulator:status': status,
    'simulator:set-speed': { ...status, speed: 'fast' }
  })
  render(<App />)
  await screen.findByText('Stressed in ~4 s')
  expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([
    'Steady',
    'Good mood',
    'Stressed',
    'Very stressed',
    'Tired',
    'Away'
  ])
  expect(screen.getByRole('button', { name: 'Instant' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('Calm down')).toBeInTheDocument()
  expect(screen.getByText('Current mood').nextSibling).toHaveTextContent('Steady · 90%')
  fireEvent.click(screen.getByRole('button', { name: 'Fast' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Fast' })).toHaveAttribute('aria-pressed', 'true')
  )
  expect(bridge.invokes).toContainEqual({ channel: 'simulator:set-speed', req: { speed: 'fast' } })
})

it('requests a switch through the dev IPC and reports failures', async () => {
  const bridge = installFakeBridge({
    'simulator:status': status,
    'simulator:switch-music': () => Promise.reject(new Error('closed'))
  })
  render(<App />)
  await screen.findByText('Stressed in ~4 s')
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Switch music now' })))
  expect(bridge.invokes).toContainEqual({ channel: 'simulator:switch-music', req: undefined })
  expect(
    screen.getByText("Couldn't switch music. Check Spotify and try again.")
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Switch music now' })).toBeEnabled()
})
