import { join } from 'node:path'
import { unpackedSdkLibrary } from './sdk-library'

it.each([
  ['darwin', 'arm64', 'libsmartspectra_capi.dylib'],
  ['win32', 'x64', 'smartspectra_capi.dll'],
  ['linux', 'x64', 'libsmartspectra_capi.so']
])('resolves a real unpacked SDK path for %s/%s', (platform, arch, filename) => {
  expect(unpackedSdkLibrary('/resources', platform, arch)).toBe(
    join(
      '/resources',
      'app.asar.unpacked',
      'node_modules',
      '@smartspectra',
      `node-sdk-${platform}-${arch}`,
      filename
    )
  )
})

it('rejects an unsupported platform', () => {
  expect(() => unpackedSdkLibrary('/resources', 'unknown', 'x64')).toThrow(
    'Unsupported SmartSpectra platform'
  )
})
