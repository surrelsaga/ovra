import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getKey, resolveEnvPath } from './env'

describe('getKey', () => {
  beforeEach(() => {
    vi.stubEnv('OVRA_ENV_PATH', join(tmpdir(), 'ovra-no-env-file'))
    vi.stubEnv('PRESAGE_API_KEY', '')
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('LASTFM_API_KEY', '')
    vi.stubEnv('OVRA_BUNDLED_PRESAGE_API_KEY', '')
    vi.stubEnv('OVRA_BUNDLED_LASTFM_API_KEY', '')
    vi.stubEnv('OVRA_BUNDLED_OPENROUTER_API_KEY', '')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('prefers a user key over the bundled key', () => {
    vi.stubEnv('PRESAGE_API_KEY', ' user-test ')
    vi.stubEnv('OVRA_BUNDLED_PRESAGE_API_KEY', 'bundled-test')
    expect(getKey('PRESAGE_API_KEY')).toBe('user-test')
  })

  it('loads a user .env key ahead of the bundled key', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ovra-key-precedence-'))
    try {
      const path = join(root, '.env')
      writeFileSync(path, 'PRESAGE_API_KEY=user-file-test')
      vi.stubEnv('OVRA_ENV_PATH', path)
      vi.stubEnv('PRESAGE_API_KEY', undefined)
      vi.stubEnv('OVRA_BUNDLED_PRESAGE_API_KEY', 'bundled-test')
      vi.resetModules()
      const env = await import('./env')
      expect(env.getKey('PRESAGE_API_KEY')).toBe('user-file-test')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back to the bundled Presage key, including for a blank user key', () => {
    vi.stubEnv('PRESAGE_API_KEY', '  ')
    vi.stubEnv('OVRA_BUNDLED_PRESAGE_API_KEY', ' bundled-test ')
    expect(getKey('PRESAGE_API_KEY')).toBe('bundled-test')
    expect(getKey('OPENROUTER_API_KEY')).toBeNull()
    expect(getKey('LASTFM_API_KEY')).toBeNull()
  })

  it('falls back to bundled music keys, and a user key still wins', () => {
    vi.stubEnv('OVRA_BUNDLED_LASTFM_API_KEY', 'bundled-lastfm')
    vi.stubEnv('OVRA_BUNDLED_OPENROUTER_API_KEY', 'bundled-openrouter')
    expect(getKey('LASTFM_API_KEY')).toBe('bundled-lastfm')
    expect(getKey('OPENROUTER_API_KEY')).toBe('bundled-openrouter')
    vi.stubEnv('OPENROUTER_API_KEY', 'user-openrouter')
    expect(getKey('OPENROUTER_API_KEY')).toBe('user-openrouter')
  })

  it('returns null when neither key is set', () => {
    expect(getKey('PRESAGE_API_KEY')).toBeNull()
  })
})

describe('resolveEnvPath', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ovra-env-'))
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('uses OVRA_ENV_PATH when set, otherwise prefers the dev .env', () => {
    const dev = join(root, 'repo', '.env')
    const user = join(root, 'user')
    mkdirSync(join(root, 'repo'), { recursive: true })
    writeFileSync(dev, 'LASTFM_API_KEY=test')

    expect(resolveEnvPath(dev, user)).toBe(dev)
    expect(resolveEnvPath(dev, user, join(root, 'override.env'))).toBe(join(root, 'override.env'))
  })

  it('falls back to the app userData .env when the dev file is absent', () => {
    const dev = join(root, 'missing', '.env')
    const user = join(root, 'user')

    expect(resolveEnvPath(dev, user)).toBe(join(user, '.env'))
  })
})
