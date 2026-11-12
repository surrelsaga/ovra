import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveEnvPath } from './env'

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
