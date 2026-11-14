import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { clearSdkCache } from './sdk-cache'

vi.mock('node:fs/promises', () => ({ rm: vi.fn().mockResolvedValue(undefined) }))

it.each(['darwin', 'win32'])(
  'removes only the known SDK cache on %s (mocked filesystem)',
  async (platform) => {
    vi.mocked(rm).mockClear()
    await clearSdkCache('/mock/cache', 'Ovra', platform)
    expect(rm).toHaveBeenCalledExactlyOnceWith(join('/mock/cache', 'Ovra', 'SmartSpectraSDK'), {
      recursive: true,
      force: true
    })
  }
)

it('skips platforms whose cache location has not been verified', async () => {
  vi.mocked(rm).mockClear()
  await clearSdkCache('/mock/cache', 'Ovra', 'linux')
  expect(rm).not.toHaveBeenCalled()
})
