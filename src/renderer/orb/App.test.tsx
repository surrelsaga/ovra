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

it('shows Spotify is closed in a music session and clears the note when it opens', () => {
  const bridge = installFakeBridge()
  render(<App />)
  expect(screen.queryByText('Open Spotify')).toBeNull()
  const s = {
    id: 's1',
    config: {
      activity: 'focus',
      lengthMin: 60,
      cameraMode: 'checkins',
      checkinIntervalMin: 5,
      music: true
    },
    startedAt: 0,
    status: 'running',
    sensingEnabled: false
  } as const
  bridge.push('push:session', s)
  expect(screen.getByRole('status')).toHaveTextContent('Open Spotify')
  const music = {
    available: true,
    leaveAlone: false,
    target: null,
    nowPlaying: null,
    scoringQueue: 0,
    scoredCount: 0
  }
  bridge.push('push:music', music)
  expect(screen.queryByText('Open Spotify')).toBeNull()
  bridge.push('push:music', { ...music, available: false })
  bridge.push('push:session', { ...s, config: { ...s.config, music: false } })
  expect(screen.queryByText('Open Spotify')).toBeNull()
})

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
      expect(moon()).toHaveAccessibleName(
        `Ovra moon, ${{ calm: 'Steady', uneasy: 'Stressed', stormy: 'Very stressed', dim: 'Tired', bright: 'Good mood' }[mood]}`
      )
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
    expect(moon()).toHaveAccessibleName('Ovra moon, Steady, camera paused')

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
    expect(screen.getByText('Calm down')).toBeInTheDocument()
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
    const pill = screen.getByLabelText('Steady · Bones · Imagine Dragons')
    expect(pill).toHaveAttribute('title', 'Steady · Bones · Imagine Dragons')
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
    expect(screen.getByLabelText('Steady · Bones · Imagine Dragons')).toBeInTheDocument()
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
    expect(screen.getByLabelText('Steady · Bones · Imagine Dragons')).toBeInTheDocument()
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

  it('shows the why line only while moving or hovered, and the Demo badge only in demo', () => {
    vi.useFakeTimers()
    const bridge = installFakeBridge()
    const { container } = render(<App />)
    const app = container.querySelector('.orb-app') as HTMLElement
    const line = (): HTMLElement | null => screen.queryByTestId('why-line')

    bridge.push('push:orb', {
      ...base,
      why: { text: 'Heart rate like when you started', moving: false }
    })
    expect(line()).toBeNull()
    expect(screen.queryByText('Demo')).toBeNull()
    fireEvent.mouseMove(moon())
    expect(line()).toHaveTextContent('Heart rate like when you started')
    fireEvent.mouseMove(app)
    act(() => vi.advanceTimersByTime(orbConfig.hoverGraceMs + 1))
    expect(line()).toBeNull()

    bridge.push('push:orb', {
      ...base,
      demo: true,
      why: {
        text: 'Heart rate higher than when you started · 20 of 30 s',
        progress: 0.66,
        moving: true
      }
    })
    expect(line()).toHaveTextContent('Heart rate higher than when you started · 20 of 30 s')
    expect(line()?.querySelector('.why__bar i')).toHaveStyle({ width: '66%' })
    expect(screen.getByText('Demo')).toBeInTheDocument()

    bridge.push('push:orb', { ...base, away: true, why: { text: 'x', moving: true } })
    expect(line()).toBeNull()
  })
})

it.each([
  ['lift', 'Boost', 'Pick me up'],
  ['ease-down', 'Calm', 'Calm down'],
  ['settle', 'Calm', 'Quiet'],
  ['let-it-ride', 'Focus', 'Keep it going'],
  ['steady', 'Focus', 'Steady'],
  ['wind-down', 'Calm', 'Wind down']
] as const)('shows %s in plain words without changing its IPC value', (target, word, label) => {
  const bridge = installFakeBridge()
  render(<App />)
  bridge.push('push:orb', {
    ...base,
    nowPlaying: { name: 'Song', artist: 'Artist', word }
  })
  bridge.push('push:music', {
    available: true,
    leaveAlone: false,
    target,
    nowPlaying: null,
    scoringQueue: 0,
    scoredCount: 0
  })
  expect(screen.getByLabelText(`${label} · Song · Artist`)).toHaveAttribute(
    'title',
    `${label} · Song · Artist`
  )
  expect(screen.getByText(label)).toHaveClass(`word--${word.toLowerCase()}`)
})

it('labels a demo music preview in the pill', () => {
  const bridge = installFakeBridge()
  render(<App />)
  bridge.push('push:orb', { ...base, nowPlaying: { name: 'Song', artist: 'Artist', word: 'Calm' } })
  const music = { available: true, leaveAlone: false, nowPlaying: null, scoringQueue: 0 }
  bridge.push('push:music', { ...music, scoredCount: 0, target: 'ease-down', preview: true })
  expect(screen.getByText('Preview · Calm down')).toBeInTheDocument()
  bridge.push('push:music', { ...music, scoredCount: 0, target: 'steady' })
  expect(screen.getByText('Steady')).toBeInTheDocument()
})

it('previews only the labelled demo moon and keeps the actual why and music visible', () => {
  const bridge = installFakeBridge()
  render(<App />)
  const view: OrbView = {
    ...base,
    demo: true,
    mood: 'bright',
    previewMood: 'uneasy',
    bubble: "Demo: 4/9 · Stressed didn't show for you. Preview: this is how Stressed looks.",
    why: { text: 'Heart rate like when you started', moving: true },
    nowPlaying: { name: 'Real song', artist: 'Real artist', word: 'Focus' }
  }
  bridge.push('push:orb', view)
  expect(moon()).toHaveAttribute('data-mood', 'uneasy')
  expect(moon()).toHaveAccessibleName(/demo preview/)
  expect(screen.getByText(view.bubble!)).toBeInTheDocument()
  expect(screen.getByTestId('why-line')).toHaveTextContent(view.why!.text)
  expect(screen.getByText('Real song', { exact: false })).toBeInTheDocument()
  bridge.push('push:orb', { ...view, previewMood: undefined })
  expect(moon()).toHaveAttribute('data-mood', 'bright')
  bridge.push('push:orb', { ...view, demo: false })
  expect(moon()).toHaveAttribute('data-mood', 'bright')
})

it('previews the away look in demo only, labelled, then restores the real moon', () => {
  const bridge = installFakeBridge()
  render(<App />)
  const view: OrbView = {
    ...base,
    demo: true,
    previewMood: 'away',
    bubble: "Demo: 7/9 · Ovra didn't see you leave. Preview: when you step away…",
    why: { text: 'Heart rate like when you started', moving: true }
  }
  bridge.push('push:orb', view)
  expect(moon()).toHaveAttribute('data-away', 'true')
  expect(moon()).toHaveAccessibleName(/demo preview/)
  expect(screen.getByText('Preview · Away · just now')).toBeInTheDocument()
  expect(screen.queryByTestId('why-line')).toBeNull()
  bridge.push('push:orb', { ...view, previewMood: undefined })
  expect(moon()).not.toHaveAttribute('data-away')
  expect(screen.queryByText(/Preview · Away/)).toBeNull()
  bridge.push('push:orb', { ...view, demo: false })
  expect(moon()).not.toHaveAttribute('data-away')
})
