// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_PRIVACY, DEFAULT_SETTINGS, type AppSettings, type Session } from '@shared/types'
import { installFakeBridge } from '../ui/fake-bridge'
import { Calibration, NewSession, Running } from './Session'

const session = (status: Session['status']): Session => ({
  id: 's1',
  config: {
    activity: 'focus',
    lengthMin: 60,
    cameraMode: 'checkins',
    checkinIntervalMin: 5,
    music: false
  },
  startedAt: 0,
  status,
  sensingEnabled: true
})
const settings: AppSettings = {
  checkinIntervalMin: 5,
  nudgeMinIntervalMin: 20,
  leaveMusicAlone: false,
  devVideoSource: null,
  devFramingPad: 0.4,
  orbPosition: null,
  thresholdOverrides: {},
  cameraTeachCount: 0,
  musicHelpShown: false,
  musicStartHelpShown: false
}

const calls = (bridge: ReturnType<typeof installFakeBridge>): unknown[] =>
  bridge.invokes.filter((i) => i.channel === 'session:calibration').map((i) => i.req)

describe('calibration preview', () => {
  it('counts only the remaining queue and hides music progress when it is empty', () => {
    const bridge = installFakeBridge()
    const calibration = session('calibrating')
    render(
      <Calibration
        session={{
          ...calibration,
          sensingEnabled: false,
          config: { ...calibration.config, music: true }
        }}
        settings={settings}
      />
    )
    const music = {
      available: true,
      leaveAlone: false,
      target: null,
      nowPlaying: null,
      scoredCount: 100,
      scoringQueue: 100
    }
    bridge.push('push:music', music)
    expect(screen.getByText('Getting to know your music · 100 songs left')).toBeInTheDocument()
    bridge.push('push:music', { ...music, scoringQueue: 60 })
    expect(screen.getByText('Getting to know your music · 60 songs left')).toBeInTheDocument()
    bridge.push('push:music', { ...music, scoringQueue: 0 })
    expect(screen.queryByText(/Getting to know your music/)).toBeNull()
  })

  it('puts the framing hint in a prominent live status while positioning progress stays at zero', () => {
    const bridge = installFakeBridge()
    render(
      <Calibration
        session={{ ...session('calibrating'), sensingEnabled: false }}
        settings={settings}
      />
    )
    bridge.push('push:calibration', { progress: 0, hint: 'Move up, or tilt the camera down.' })
    expect(screen.getByRole('status')).toHaveTextContent('Let’s get you in view.')
    expect(screen.getByRole('status')).toHaveTextContent('Move up, or tilt the camera down.')
    expect(screen.getByText('Move up, or tilt the camera down.')).toHaveClass(
      'calibration-hint__text'
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('shows an unrecorded preview and stops its stream when calibration ends', async () => {
    installFakeBridge()
    const stop = vi.fn()
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia }
    })
    const view = render(<Calibration session={session('calibrating')} settings={settings} />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: true })
    expect(screen.getByText('Not recorded')).toBeInTheDocument()

    view.rerender(<Calibration session={session('running')} settings={settings} />)
    expect(stop).toHaveBeenCalledOnce()
    expect(screen.queryByText('Not recorded')).toBeNull()
  })

  it('uses the selected dev video file without requesting camera media', () => {
    installFakeBridge()
    window.ovra.isDev = true
    const getUserMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia }
    })
    render(
      <Calibration
        session={session('calibrating')}
        settings={{ ...settings, devVideoSource: '/tmp/test-video.mp4' }}
      />
    )
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(screen.getByText('Not recorded')).toBeInTheDocument()
    expect(document.querySelector('video')?.getAttribute('src')).toBe('ovra-preview://calibration')
  })

  it('explains when the display-only camera preview is unavailable', async () => {
    installFakeBridge()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error('permission denied')) }
    })
    render(<Calibration session={session('calibrating')} settings={settings} />)
    expect(
      await screen.findByText('Camera preview isn’t available. I can still get to know you.')
    ).toBeInTheDocument()
  })

  it('keeps the session calm and explains the timed-break fallback after SDK failure', () => {
    installFakeBridge()
    render(<Running session={session('running')} sdkFailed />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Couldn’t start the camera check. Your session will keep running with timed breaks.'
    )
  })

  it.each([false, true])('shows startup, framing and steady-pulse stages (demo=%s)', (demo) => {
    const bridge = installFakeBridge()
    const s = session('calibrating')
    render(<Calibration session={{ ...s, config: { ...s.config, demo } }} settings={settings} />)
    expect(screen.getByRole('heading', { name: 'Starting the camera…' })).toBeInTheDocument()
    expect(screen.queryByText('You’re in view. Keep breathing normally.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    expect(screen.queryByText(/steady heart rate left/)).toBeNull()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    bridge.push('push:calibration', { progress: 0, hint: null, framing: true, starting: true })
    expect(screen.getByRole('heading', { name: 'Starting the camera…' })).toBeInTheDocument()
    bridge.push('push:calibration', {
      progress: 0,
      hint: 'Lean back a little.',
      framing: true,
      starting: false
    })
    expect(screen.getByRole('heading', { name: 'Getting you in view' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Lean back a little.')
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(calls(bridge)).toEqual([{ action: 'skip-framing' }])
    bridge.push('push:calibration', { progress: 0.5, hint: null, framing: false, starting: false })
    expect(screen.getByRole('heading', { name: 'Getting to know you' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    expect(screen.getByText('About 15 s of steady heart rate left')).toBeInTheDocument()
    expect(
      screen.getByText('About 15 s of steady heart rate left').closest('.calibration__meta')
    ).toHaveTextContent('Getting to know you · About 15 s of steady heart rate left')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
  })

  it('failed calibration: plain reason, Try again and Start anyway, camera preview off', () => {
    const bridge = installFakeBridge()
    const getUserMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia }
    })
    render(
      <Calibration
        session={{
          ...session('calibrating'),
          calibrationFailed: 'I only got 12 of 30 s of steady heart rate.'
        }}
        settings={settings}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'I only got 12 of 30 s of steady heart rate.'
    )
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(screen.queryByRole('progressbar')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start anyway' }))
    expect(calls(bridge)).toEqual([{ action: 'retry' }, { action: 'start-anyway' }])
  })

  it('failed calibration from the SDK: shows its reason, not the readings advice', () => {
    const bridge = installFakeBridge()
    render(
      <Calibration
        session={{
          ...session('calibrating'),
          calibrationFailed: "Couldn't reach Presage. Check your internet or VPN.",
          calibrationSdkFailed: true
        }}
        settings={settings}
      />
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent("Couldn't reach Presage. Check your internet or VPN.")
    expect(alert).not.toHaveTextContent('steady read')
    expect(alert).not.toHaveTextContent('Even light')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(calls(bridge)).toEqual([{ action: 'retry' }])
  })

  it('does not request media after consent is absent', () => {
    installFakeBridge()
    const getUserMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia }
    })
    render(
      <Calibration
        session={{ ...session('calibrating'), sensingEnabled: false }}
        settings={settings}
      />
    )
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(screen.queryByText('Not recorded')).toBeNull()
  })
})

describe('new session', () => {
  it('passes the demo flag, continuous camera and custom 15 minutes through IPC, without saving a setting', async () => {
    const bridge = installFakeBridge({ 'session:start': session('running') })
    const view = render(
      <NewSession
        privacy={{ ...DEFAULT_PRIVACY, camera: 'yes' }}
        settings={DEFAULT_SETTINGS}
        onStarted={vi.fn()}
      />
    )
    expect(screen.getByRole('switch', { name: 'Demo mode' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Demo mode' }))
    expect(screen.getByRole('spinbutton')).toHaveValue(15)
    expect(screen.getByRole('radio', { name: /The whole session/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(bridge.invokes).toEqual([
      {
        channel: 'session:start',
        req: {
          activity: 'focus',
          lengthMin: 15,
          cameraMode: 'continuous',
          checkinIntervalMin: 5,
          music: true,
          demo: true
        }
      }
    ])
    view.unmount()
    render(<NewSession privacy={DEFAULT_PRIVACY} settings={DEFAULT_SETTINGS} onStarted={vi.fn()} />)
    expect(screen.getByRole('switch', { name: 'Demo mode' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('shows all activity examples and music hints and uses simple default lengths', () => {
    installFakeBridge()
    render(<NewSession privacy={DEFAULT_PRIVACY} settings={DEFAULT_SETTINGS} onStarted={vi.fn()} />)
    expect(screen.getByText('Studying, work, coding, writing')).toBeInTheDocument()
    expect(screen.getByText('Soft, mostly without singing')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /Everyday tasks/ }))
    expect(screen.getByRole('radio', { name: '45 min' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: /Reading/ }))
    expect(screen.getByRole('radio', { name: '1 h' })).toBeChecked()
    expect(screen.queryByRole('radio', { name: '10 min' })).toBeNull()
  })
})
