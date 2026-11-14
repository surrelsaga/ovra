// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { installFakeBridge } from '../ui/fake-bridge'
import App from './App'

it('has a CSS tooltip for each control, including the updated camera and music labels', () => {
  const bridge = installFakeBridge()
  render(<App />)
  const toolbar = screen.getByRole('toolbar')
  for (const label of ['Pause camera', 'Leave my music alone', 'End session', 'Open main window']) {
    const button = within(toolbar).getByRole('button', { name: label })
    expect(within(button).getByRole('tooltip')).toHaveTextContent(label)
    button.focus()
    expect(button).toHaveFocus()
  }
  bridge.push('push:orb', { mood: 'calm', listening: false, paused: true, away: false })
  expect(
    within(screen.getByRole('button', { name: 'Resume camera' })).getByRole('tooltip')
  ).toHaveTextContent('Resume camera')
  fireEvent.click(screen.getByRole('button', { name: 'Leave my music alone' }))
  expect(
    within(screen.getByRole('button', { name: 'Leave my music alone' })).getByRole('tooltip')
  ).toHaveTextContent('Music: hands off (on)')
})

it('opens the main Session preview from the optional framing action', () => {
  const bridge = installFakeBridge()
  render(<App />)
  bridge.push('push:orb', {
    mood: 'calm',
    listening: true,
    paused: false,
    away: false,
    bubble: 'Place more of the chest in view.',
    bubbleAction: 'show-camera'
  })
  fireEvent.click(screen.getByRole('button', { name: 'Show camera' }))
  expect(bridge.invokes).toContainEqual({ channel: 'window:open-main', req: { showCamera: true } })
  bridge.push('push:orb', {
    mood: 'calm',
    listening: false,
    paused: false,
    away: false,
    bubble: 'Other advice'
  })
  expect(screen.queryByRole('button', { name: 'Show camera' })).toBeNull()
})
