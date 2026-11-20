// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '@shared/types'
import { installFakeBridge } from '../ui/fake-bridge'
import { Settings } from './Settings'

const device = (deviceId: string, label: string, kind = 'videoinput'): MediaDeviceInfo =>
  ({ deviceId, label, kind }) as MediaDeviceInfo

it('lists cameras without opening them, saves id and label, and refreshes after devicechange', async () => {
  const media = new EventTarget()
  const enumerateDevices = vi
    .fn()
    .mockResolvedValue([
      device('phone', 'Phone camera'),
      device('usb', 'USB webcam'),
      device('mic', 'Microphone', 'audioinput')
    ])
  const getUserMedia = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: Object.assign(media, { enumerateDevices, getUserMedia })
  })
  const bridge = installFakeBridge({
    'settings:set': (patch: object) => ({ ...DEFAULT_SETTINGS, ...patch })
  })
  const onChange = vi.fn()
  const view = render(<Settings settings={DEFAULT_SETTINGS} onChange={onChange} />)
  const select = screen.getByRole('combobox', { name: 'Camera' })
  await screen.findByRole('option', { name: 'USB webcam' })
  expect([...select.querySelectorAll('option')].map((o) => o.text)).toEqual([
    'Default camera',
    'Phone camera',
    'USB webcam'
  ])
  expect(
    select.compareDocumentPosition(screen.getByText('How often to use the camera')) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  fireEvent.change(select, { target: { value: 'usb' } })
  await waitFor(() =>
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      cameraId: 'usb',
      cameraLabel: 'USB webcam'
    })
  )
  expect(bridge.invokes).toContainEqual({
    channel: 'settings:set',
    req: { cameraId: 'usb', cameraLabel: 'USB webcam' }
  })
  enumerateDevices.mockResolvedValue([device('new', '')])
  await act(async () => {
    media.dispatchEvent(new Event('devicechange'))
  })
  expect(await screen.findByRole('option', { name: 'Camera 1' })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'USB webcam' })).toBeNull()
  expect(getUserMedia).not.toHaveBeenCalled()
  view.unmount()
  media.dispatchEvent(new Event('devicechange'))
  expect(enumerateDevices).toHaveBeenCalledTimes(2)
})

it('keeps an unplugged saved camera visible and labels cameras before permission without requesting it', async () => {
  const enumerateDevices = vi.fn().mockResolvedValue([device('one', ''), device('two', '')])
  const getUserMedia = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices, getUserMedia }
  })
  installFakeBridge()
  render(
    <Settings
      settings={{ ...DEFAULT_SETTINGS, cameraId: 'gone', cameraLabel: 'Desk webcam' }}
      onChange={vi.fn()}
    />
  )
  expect(await screen.findByRole('option', { name: 'Camera 2' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Camera' })).toHaveValue('gone')
  expect(screen.getByRole('option', { name: 'Desk webcam (not connected)' })).toBeInTheDocument()
  expect(getUserMedia).not.toHaveBeenCalled()
})
