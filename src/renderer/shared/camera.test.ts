import { cameraConstraints, openCamera } from './camera'

const video = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
  facingMode: 'user'
}
const getUserMedia = vi.fn()
beforeEach(() => {
  getUserMedia.mockReset()
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
})
afterEach(() => vi.unstubAllGlobals())

it('keeps default constraints and selects an exact device without facingMode or audio', () => {
  expect(cameraConstraints('')).toEqual({ audio: false, video: true })
  expect(cameraConstraints('', video)).toEqual({ audio: false, video })
  expect(cameraConstraints('usb', video)).toEqual({
    audio: false,
    video: {
      width: video.width,
      height: video.height,
      frameRate: video.frameRate,
      deviceId: { exact: 'usb' }
    }
  })
})
it.each(['OverconstrainedError', 'NotFoundError'])(
  'falls back once on %s and keeps the other constraints',
  async (name) => {
    const stream = {}
    const notice = vi.fn()
    getUserMedia.mockRejectedValueOnce({ name }).mockResolvedValueOnce(stream)
    expect(await openCamera('usb', notice, video)).toBe(stream)
    expect(getUserMedia.mock.calls).toEqual([
      [cameraConstraints('usb', video)],
      [cameraConstraints('', video)]
    ])
    expect(notice).toHaveBeenCalledOnce()
  }
)
it.each(['NotAllowedError', 'NotReadableError'])(
  'does not hide %s with a default-camera retry',
  async (name) => {
    const error = { name }
    const notice = vi.fn()
    getUserMedia.mockRejectedValue(error)
    await expect(openCamera('usb', notice)).rejects.toBe(error)
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(notice).not.toHaveBeenCalled()
  }
)
it('does not retry a missing default or announce fallback when no camera opens', async () => {
  const error = { name: 'NotFoundError' }
  const notice = vi.fn()
  getUserMedia.mockRejectedValue(error)
  await expect(openCamera('', notice)).rejects.toBe(error)
  expect(getUserMedia).toHaveBeenCalledOnce()
  getUserMedia.mockClear()
  await expect(openCamera('usb', notice)).rejects.toBe(error)
  expect(getUserMedia).toHaveBeenCalledTimes(2)
  expect(notice).not.toHaveBeenCalled()
})
