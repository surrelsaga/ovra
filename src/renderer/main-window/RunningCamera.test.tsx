// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Session } from '@shared/types'
import { installFakeBridge } from '../ui/fake-bridge'
import { Running } from './Session'

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
const orb = { mood: 'calm', listening: false, paused: false, away: false } as const
let stop: ReturnType<typeof vi.fn>
let getUserMedia: ReturnType<typeof vi.fn>
let stream: MediaStream
beforeEach(() => {
  stop = vi.fn()
  stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  getUserMedia = vi.fn().mockResolvedValue(stream)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

it('is opt-in, displays only the stream in video and releases it when hidden or unmounted', async () => {
  const bridge = installFakeBridge()
  const view = render(<Running session={session} cameraConsent />)
  bridge.push('push:orb', orb)
  expect(getUserMedia).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Show camera' }))
  await act(async () => {
    await Promise.resolve()
  })
  expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false })
  expect(document.querySelector('video')?.srcObject).toBe(stream)
  expect(document.querySelector('canvas')).toBeNull()
  expect(screen.getByText('Not recorded')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Hide camera' }))
  expect(stop).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Show camera' }))
  await act(async () => {
    await Promise.resolve()
  })
  view.unmount()
  expect(stop).toHaveBeenCalledTimes(2)
  expect(bridge.invokes).toEqual([])
})

it('stops on pause, consent withdrawal, hidden/minimised window and document hiding', async () => {
  const bridge = installFakeBridge()
  const view = render(<Running session={session} cameraConsent showCameraInitially />)
  expect(getUserMedia).not.toHaveBeenCalled() // paused state has not arrived yet
  bridge.push('push:orb', orb)
  await act(async () => {
    await Promise.resolve()
  })
  bridge.push('push:orb', { ...orb, paused: true })
  expect(stop).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Camera paused by you' })).toBeDisabled()
  bridge.push('push:orb', orb)
  await act(async () => {
    await Promise.resolve()
  })
  bridge.push('push:main-window', { visible: false })
  expect(stop).toHaveBeenCalledTimes(2)
  bridge.push('push:main-window', { visible: true })
  await act(async () => {
    await Promise.resolve()
  })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  fireEvent(document, new Event('visibilitychange'))
  expect(stop).toHaveBeenCalledTimes(3)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  fireEvent(document, new Event('visibilitychange'))
  await act(async () => {
    await Promise.resolve()
  })
  view.rerender(<Running session={session} cameraConsent={false} showCameraInitially />)
  expect(stop).toHaveBeenCalledTimes(4)
  expect(document.querySelector('video')).toBeNull()
})

it.each(['pagehide', 'beforeunload'])('releases the tracks on %s', async (event) => {
  const bridge = installFakeBridge()
  render(<Running session={session} cameraConsent showCameraInitially />)
  bridge.push('push:orb', orb)
  await act(async () => {
    await Promise.resolve()
  })
  fireEvent(window, new Event(event))
  expect(stop).toHaveBeenCalledOnce()
})

it('releases a media request that resolves after the preview is hidden', async () => {
  const bridge = installFakeBridge()
  let resolve!: (stream: MediaStream) => void
  getUserMedia.mockReturnValue(
    new Promise<MediaStream>((r) => {
      resolve = r
    })
  )
  render(<Running session={session} cameraConsent showCameraInitially />)
  bridge.push('push:orb', orb)
  fireEvent.click(screen.getByRole('button', { name: 'Hide camera' }))
  await act(async () => {
    resolve(stream)
  })
  expect(stop).toHaveBeenCalledOnce()
  expect(document.querySelector('video')).toBeNull()
})

it('never requests a preview without consent or sensing, even from the orb action', () => {
  const bridge = installFakeBridge()
  const view = render(<Running session={session} showCameraInitially />)
  bridge.push('push:orb', orb)
  expect(getUserMedia).not.toHaveBeenCalled()
  view.rerender(
    <Running session={{ ...session, sensingEnabled: false }} cameraConsent showCameraInitially />
  )
  expect(getUserMedia).not.toHaveBeenCalled()
})

it('explains preview failures and releases an acquired stream if video playback fails', async () => {
  const bridge = installFakeBridge()
  render(<Running session={session} cameraConsent showCameraInitially />)
  bridge.push('push:orb', orb)
  await act(async () => {
    await Promise.resolve()
  })
  fireEvent.error(document.querySelector('video')!)
  expect(stop).toHaveBeenCalledOnce()
  expect(screen.getByRole('status')).toHaveTextContent('Camera preview isn’t available.')
})
