// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { OrbView } from '@shared/types'
import { installFakeBridge } from '../ui/fake-bridge'
import App from './App'
import { orbConfig } from './config'

const base: OrbView = { mood: 'calm', listening: false, paused: false, away: false }
const moon = (): HTMLElement => screen.getByRole('img', { name: /Ovra moon/ })
const ignoreCalls = (b: ReturnType<typeof installFakeBridge>): unknown[] =>
  b.invokes.filter((c) => c.channel === 'window:orb-ignore-mouse').map((c) => c.req)

describe('orb window', () => {
  afterEach(() => vi.useRealTimers())

  it('maps every orb view field to what is shown', async () => {
    const bridge = installFakeBridge()
    render(<App />)
    expect(moon()).toHaveAttribute('data-mood', 'calm')

    for (const mood of ['calm', 'uneasy', 'stormy', 'dim', 'bright'] as const) {
      bridge.push('push:orb', { ...base, mood })
      expect(moon()).toHaveAttribute('data-mood', mood)
      expect(moon()).toHaveAccessibleName(`Ovra moon, ${mood}`)
    }

    bridge.push('push:orb', { ...base, listening: true, bubble: 'Checking in' })
    expect(screen.getByTestId('listening-ring')).toBeInTheDocument()
    expect(screen.getByText('Camera on')).toBeInTheDocument()
    expect(screen.getByText('Checking in')).toBeInTheDocument()

    bridge.push('push:orb', { ...base, paused: true })
    expect(screen.getByText('Camera paused')).toBeInTheDocument()
    expect(screen.queryByTestId('listening-ring')).toBeNull()
    expect(moon()).toHaveAccessibleName('Ovra moon, calm, camera paused')

    bridge.push('push:orb', {
      ...base,
      mood: 'dim',
      away: true,
      awaySince: Date.now() - 12 * 60_000
    })
    expect(moon()).toHaveAttribute('data-away', 'true')
    expect(await screen.findByText('Away · 12 min')).toBeInTheDocument()

    bridge.push('push:orb', { ...base, breath: 1 })
    expect(moon()).toHaveAttribute('data-breathing', 'true')
    expect(moon().style.getPropertyValue('--breath')).toBe('1')

    bridge.push('push:orb', {
      ...base,
      nowPlaying: { name: 'Weightless', artist: 'Marconi Union', word: 'Calm' }
    })
    expect(screen.getByText('Calm')).toBeInTheDocument()
    expect(screen.getByText(/Weightless/)).toBeInTheDocument()
  })

  it('has labelled mini controls; pause reads its state from push:orb', () => {
    const bridge = installFakeBridge()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause camera' }))
    // Nothing changes until main says the camera is paused.
    expect(screen.getByRole('button', { name: 'Pause camera' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    bridge.push('push:orb', { ...base, paused: true })
    fireEvent.click(screen.getByRole('button', { name: 'Resume camera' }))
    fireEvent.click(screen.getByRole('button', { name: 'Leave my music alone' }))
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open main window' }))
    expect(bridge.invokes.map((c) => c.channel)).toEqual([
      'camera:pause',
      'camera:resume',
      'music:set-leave-alone',
      'session:end',
      'window:open-main'
    ])
  })

  it('is click-through except over the orb, and shows controls while hovering', () => {
    vi.useFakeTimers()
    const bridge = installFakeBridge()
    const { container } = render(<App />)
    const app = container.querySelector('.orb-app')!

    fireEvent.mouseMove(app)
    expect(ignoreCalls(bridge)).toEqual([{ ignore: true }])
    expect(app).not.toHaveAttribute('data-hover')

    fireEvent.mouseMove(moon())
    expect(ignoreCalls(bridge)).toEqual([{ ignore: true }, { ignore: false }])
    expect(app).toHaveAttribute('data-hover')

    // Crossing the gap to the controls: ignored again, but the controls stay up for the grace period.
    fireEvent.mouseMove(app)
    expect(app).toHaveAttribute('data-hover')
    fireEvent.mouseMove(screen.getByRole('toolbar'))
    expect(ignoreCalls(bridge).at(-1)).toEqual({ ignore: false })

    fireEvent.mouseMove(app)
    act(() => vi.advanceTimersByTime(orbConfig.hoverGraceMs + 1))
    expect(app).not.toHaveAttribute('data-hover')
    expect(ignoreCalls(bridge).at(-1)).toEqual({ ignore: true })
  })

  it('stays clickable while dragging off the moon', () => {
    const bridge = installFakeBridge()
    const { container } = render(<App />)
    const handle = screen.getByRole('button', { name: /Drag or use arrow keys/ })
    handle.setPointerCapture = () => undefined
    fireEvent.mouseMove(moon())
    fireEvent.pointerDown(handle, { pointerId: 1, screenX: 10, screenY: 10 })
    fireEvent.mouseMove(container.querySelector('.orb-app')!)
    expect(ignoreCalls(bridge).at(-1)).toEqual({ ignore: false })
    fireEvent.pointerMove(handle, { pointerId: 1, screenX: 40, screenY: 10 })
    expect(bridge.invokes.some((c) => c.channel === 'window:orb-moved')).toBe(true)
  })
})
