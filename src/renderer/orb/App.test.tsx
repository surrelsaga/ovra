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
    vi.useFakeTimers()
    const bridge = installFakeBridge()
    render(<App />)
    expect(moon()).toHaveAttribute('data-mood', 'calm')

    for (const mood of ['calm', 'uneasy', 'stormy', 'dim', 'bright'] as const) {
      bridge.push('push:orb', { ...base, mood })
      expect(moon()).toHaveAttribute('data-mood', mood)
      expect(moon()).toHaveAccessibleName(`Ovra moon, ${mood}`)
    }

    bridge.push('push:orb', { ...base, listening: true, bubble: 'Checking in' })
    expect(screen.getByTestId('camera-satellite')).toBeInTheDocument()
    expect(screen.getByText('Camera on')).toBeInTheDocument()
    expect(screen.getByText('Checking in')).toBeInTheDocument()

    bridge.push('push:orb', { ...base, paused: true })
    expect(screen.getByText('Camera paused')).toBeInTheDocument()
    // A user pause shows its badge immediately, without a lingering satellite.
    expect(screen.queryByTestId('camera-satellite')).toBeNull()
    expect(screen.getByTestId('camera-off-badge')).toBeInTheDocument()
    expect(moon()).toHaveAccessibleName('Ovra moon, calm, camera paused')

    bridge.push('push:orb', {
      ...base,
      mood: 'dim',
      away: true,
      awaySince: Date.now() - 12 * 60_000
    })
    expect(moon()).toHaveAttribute('data-away', 'true')
    act(() => vi.advanceTimersByTime(0))
    expect(screen.getByText('Away · 12 min')).toBeInTheDocument()

    bridge.push('push:orb', { ...base, breath: 1 })
    expect(moon()).toHaveAttribute('data-breathing', 'true')
    expect(moon()).toHaveAttribute('data-disk', '24')
    bridge.push('push:orb', { ...base, breath: 0 })
    expect(moon()).toHaveAttribute('data-disk', '16')

    bridge.push('push:orb', {
      ...base,
      nowPlaying: { name: 'Weightless', artist: 'Marconi Union', word: 'Calm' }
    })
    act(() => vi.advanceTimersByTime(orbConfig.cameraNoteMs))
    expect(screen.getByText('Calm')).toBeInTheDocument()
    expect(screen.getByText(/Weightless/)).toBeInTheDocument()
  })

  it('camera indicator: moonrise, satellite steps while on, two-step fade when off', () => {
    vi.useFakeTimers()
    const bridge = installFakeBridge()
    render(<App />)
    const sat = (): HTMLElement | null => screen.queryByTestId('camera-satellite')
    const head = (): string | null => sat()?.querySelector('.sat--0')?.getAttribute('x') ?? null
    expect(sat()).toBeNull()

    bridge.push('push:orb', { ...base, listening: true, calibration: 0 })
    // Satellite shows from the first frame; the moon builds out from its centre.
    expect(sat()).toHaveAttribute('opacity', '1')
    expect(moon()).toHaveAttribute('data-rise', '0.060')
    expect(moon()).toHaveAttribute('data-phase', '0.000')
    const x0 = head()
    act(() => void vi.advanceTimersByTime(110))
    expect(head()).not.toBe(x0)
    act(() => void vi.advanceTimersByTime(1000))
    expect(moon()).not.toHaveAttribute('data-rise')

    // Waxing follows calibration progress in 24 steps; check-ins show the full moon.
    bridge.push('push:orb', { ...base, listening: true, calibration: 0.5 })
    expect(moon()).toHaveAttribute('data-phase', '0.500')
    bridge.push('push:orb', { ...base, listening: true })
    expect(moon()).not.toHaveAttribute('data-phase')
    act(() => void vi.advanceTimersByTime(60_000))
    expect(sat()).toHaveAttribute('opacity', '1')

    bridge.push('push:orb', { ...base, listening: false })
    expect(sat()).toHaveAttribute('opacity', '0.6')
    act(() => void vi.advanceTimersByTime(330))
    expect(sat()).toHaveAttribute('opacity', '0.25')
    act(() => void vi.advanceTimersByTime(330))
    expect(sat()).toBeNull()
    expect(moon()).not.toHaveAttribute('data-rise')
  })

  it('reduced motion parks the satellite at the top, no moonrise', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }))
    vi.useFakeTimers()
    const bridge = installFakeBridge()
    render(<App />)
    bridge.push('push:orb', { ...base, listening: true })
    const sat = (): Element | null =>
      screen.getByTestId('camera-satellite').querySelector('.sat--0')
    expect(moon()).not.toHaveAttribute('data-rise')
    expect(screen.getByTestId('camera-satellite').querySelectorAll('rect')).toHaveLength(1)
    expect(sat()).toHaveAttribute('y', '0')
    act(() => void vi.advanceTimersByTime(1000))
    expect(sat()).toHaveAttribute('y', '0')
    bridge.push('push:orb', { ...base, listening: false })
    expect(screen.queryByTestId('camera-satellite')).toBeNull()
    vi.unstubAllGlobals()
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

  it('mouse presses never take focus (no stray focus ring), keyboard focus still works', () => {
    installFakeBridge()
    render(<App />)
    const handle = screen.getByRole('button', { name: /Drag or use arrow keys/ })
    // fireEvent returns false when the default (focusing) was prevented.
    expect(fireEvent.mouseDown(handle)).toBe(false)
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'End session' }))).toBe(false)
    handle.focus()
    expect(handle).toHaveFocus()
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

describe('song pill and camera status', () => {
  const song = { name: 'Bones', artist: 'Imagine Dragons', word: 'Focus' as const }
  afterEach(() => vi.useRealTimers())

  it('keeps the song through continuous listening and unrelated pushes after the brief change note', () => {
    vi.useFakeTimers()
    const bridge = installFakeBridge()
    render(<App />)
    bridge.push('push:orb', { ...base, listening: true, nowPlaying: song })
    expect(screen.getByRole('status')).toHaveTextContent('Camera on')
    act(() => vi.advanceTimersByTime(orbConfig.cameraNoteMs - 1))
    expect(screen.getByRole('status')).toHaveTextContent('Camera on')
    act(() => vi.advanceTimersByTime(1))
    const pill = screen.getByLabelText('Focus · Bones · Imagine Dragons')
    expect(pill).toHaveAttribute('title', 'Focus · Bones · Imagine Dragons')
    expect(screen.getByRole('img', { name: "Camera on · checking how you're doing" })).toHaveClass(
      'camera-dot--on'
    )
    bridge.push('push:orb', { ...base, listening: true, mood: 'bright', nowPlaying: song })
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.queryByRole('status')).toBeNull()
    expect(pill).toBeInTheDocument()
  })

  it('announces off for three seconds, hides the dot between check-ins, and cancels older notes', () => {
    vi.useFakeTimers()
    const bridge = installFakeBridge()
    render(<App />)
    bridge.push('push:orb', { ...base, listening: true, nowPlaying: song })
    act(() => vi.advanceTimersByTime(2000))
    bridge.push('push:orb', { ...base, nowPlaying: song })
    expect(screen.getByRole('status')).toHaveTextContent('Camera off')
    act(() => vi.advanceTimersByTime(orbConfig.cameraNoteMs - 1))
    expect(screen.getByRole('status')).toHaveTextContent('Camera off')
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByLabelText('Focus · Bones · Imagine Dragons')).toBeInTheDocument()
    expect(document.querySelector('.camera-dot')).toBeNull()
    expect(screen.queryByTestId('camera-off-badge')).toBeNull()
  })

  it('gives away priority over pause, and pause priority over notes and music', () => {
    vi.useFakeTimers()
    const bridge = installFakeBridge()
    render(<App />)
    bridge.push('push:orb', { ...base, listening: true, nowPlaying: song })
    bridge.push('push:orb', { ...base, paused: true, nowPlaying: song })
    expect(screen.getByText('Camera paused')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Camera paused by you' })).toHaveClass(
      'camera-dot--paused'
    )
    expect(screen.queryByTestId('camera-satellite')).toBeNull()
    expect(screen.getByTestId('camera-off-badge')).toBeInTheDocument()
    bridge.push('push:orb', {
      ...base,
      paused: true,
      away: true,
      awaySince: Date.now() - 3 * 60_000,
      nowPlaying: song
    })
    act(() => vi.advanceTimersByTime(0))
    expect(screen.getByText('Away · 3 min')).toBeInTheDocument()
    expect(screen.queryByText('Camera paused')).toBeNull()
    bridge.push('push:orb', { ...base, paused: true, nowPlaying: song })
    act(() => vi.advanceTimersByTime(orbConfig.cameraNoteMs))
    expect(screen.getByText('Camera paused')).toBeInTheDocument()
    bridge.push('push:orb', { ...base, nowPlaying: song })
    expect(screen.getByLabelText('Focus · Bones · Imagine Dragons')).toBeInTheDocument()
  })

  it('describes on, paused and off, with a countdown only when known and still in the future', () => {
    vi.useFakeTimers()
    const bridge = installFakeBridge()
    render(<App />)
    const handle = screen.getByRole('button', { name: /Drag or use arrow keys/ })
    expect(handle).toHaveAccessibleDescription('Camera off')
    bridge.push('push:orb', { ...base, nextCheckAt: Date.now() + 5 * 60_000 })
    expect(handle).toHaveAccessibleDescription('Camera off · next check in 5 min')
    act(() => vi.advanceTimersByTime(60_000))
    expect(handle).toHaveAccessibleDescription('Camera off · next check in 4 min')
    act(() => vi.advanceTimersByTime(4 * 60_000))
    expect(handle).toHaveAccessibleDescription('Camera off')
    bridge.push('push:orb', { ...base, listening: true })
    expect(handle).toHaveAccessibleDescription("Camera on · checking how you're doing")
    bridge.push('push:orb', { ...base, paused: true })
    expect(handle).toHaveAccessibleDescription('Camera paused by you')
  })

  it('cleans up the change-note timer when unmounted', () => {
    vi.useFakeTimers()
    const bridge = installFakeBridge()
    const view = render(<App />)
    bridge.push('push:orb', { ...base, listening: true })
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
