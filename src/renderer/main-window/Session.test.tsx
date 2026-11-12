// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import type { AppSettings, Session } from '@shared/types'
import { installFakeBridge } from '../ui/fake-bridge'
import { Calibration, Running } from './Session'

const session = (status: Session['status']): Session => ({
  id: 's1',
  config: {
    activity: 'deep-work',
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
  thresholdOverrides: {}
}

describe('calibration preview', () => {
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
      await screen.findByText('Camera preview isn’t available. Calibration can continue.')
    ).toBeInTheDocument()
  })

  it('keeps the session calm and explains the timed-break fallback after SDK failure', () => {
    installFakeBridge()
    render(<Running session={session('running')} sdkFailed />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Couldn’t start the camera check. Your session will keep running with timed breaks.'
    )
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
