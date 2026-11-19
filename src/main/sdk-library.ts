import { join } from 'node:path'

/** dlopen needs a real path; Electron's require.resolve still returns app.asar paths. */
export function unpackedSdkLibrary(resources: string, platform: string, arch: string): string {
  const filename = {
    darwin: 'libsmartspectra_capi.dylib',
    win32: 'smartspectra_capi.dll',
    linux: 'libsmartspectra_capi.so'
  }[platform]
  if (!filename) throw new Error(`Unsupported SmartSpectra platform: ${platform}`)
  return join(
    resources,
    'app.asar.unpacked',
    'node_modules',
    '@smartspectra',
    `node-sdk-${platform}-${arch}`,
    filename
  )
}
