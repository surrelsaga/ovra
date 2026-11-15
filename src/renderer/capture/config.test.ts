afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

const liveScale = async (): Promise<number> => (await import('./config')).captureConfig.liveScale

it('shrinks the live frame by default (decision 48)', async () => {
  vi.stubEnv('RENDERER_VITE_OVRA_LIVE_SCALE', '')
  expect(await liveScale()).toBe(0.8)
})

it('lets the dev override turn the shrunk frame off with 1', async () => {
  vi.stubEnv('RENDERER_VITE_OVRA_LIVE_SCALE', '1')
  expect(await liveScale()).toBe(1)
})
