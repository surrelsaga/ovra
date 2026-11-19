import { spawnSync } from 'node:child_process'

it.each([
  ['simulate', 'OVRA_SIMULATE', '1'],
  ['monitor', 'OVRA_MONITOR', '1'],
  ['e2e', 'OVRA_HARNESS', 'e2e'],
  ['sensing', 'OVRA_HARNESS', 'sensing'],
  ['shell', 'OVRA_HARNESS', 'shell'],
  ['moves', 'OVRA_HARNESS', 'moves']
])('sets %s mode and forwards CLI arguments without starting Electron', (mode, key, value) => {
  const probe = `process.on('exit', () => console.log('mode=' + process.env.${key}))`
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(probe)}`,
      'scripts/dev.mjs',
      mode,
      '--help'
    ],
    { encoding: 'utf8' }
  )
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain(`mode=${value}`)
  expect(result.stdout).toContain('Usage:')
})

it('rejects an unknown mode before loading Electron', () => {
  const result = spawnSync(process.execPath, ['scripts/dev.mjs', 'unknown'], { encoding: 'utf8' })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('Choose simulate, monitor, e2e, sensing, shell or moves')
})
