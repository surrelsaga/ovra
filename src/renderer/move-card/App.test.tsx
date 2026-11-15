// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { installFakeBridge } from '../ui/fake-bridge'
import App from './App'

it('labels the shorter demo snooze and restores the normal label next session', () => {
  const bridge = installFakeBridge()
  render(<App />)
  bridge.push('push:move-card', {
    kind: 'nudge',
    nudge: { id: 'n', moveId: 'breathe', message: 'A small break?', t: 0 }
  })
  expect(screen.getByRole('button', { name: '5 more min' })).toBeInTheDocument()
  const session = {
    id: 's',
    startedAt: 0,
    status: 'running',
    sensingEnabled: true,
    config: {
      activity: 'focus',
      lengthMin: 20,
      cameraMode: 'continuous',
      checkinIntervalMin: 5,
      music: false,
      demo: true
    }
  } as const
  bridge.push('push:session', session)
  expect(screen.getByRole('button', { name: '1 more min' })).toBeInTheDocument()
  bridge.push('push:session', { ...session, config: { ...session.config, demo: false } })
  expect(screen.getByRole('button', { name: '5 more min' })).toBeInTheDocument()
})
