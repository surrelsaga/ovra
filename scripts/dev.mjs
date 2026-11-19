import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const modes = {
  simulate: ['OVRA_SIMULATE', '1'],
  monitor: ['OVRA_MONITOR', '1'],
  e2e: ['OVRA_HARNESS', 'e2e'],
  sensing: ['OVRA_HARNESS', 'sensing'],
  shell: ['OVRA_HARNESS', 'shell'],
  moves: ['OVRA_HARNESS', 'moves']
}
const mode = process.argv.splice(2, 1)[0]
assert(Object.hasOwn(modes, mode), 'Choose simulate, monitor, e2e, sensing, shell or moves')
const [key, value] = modes[mode]
process.env[key] = value
process.argv.splice(2, 0, 'dev')
const require = createRequire(import.meta.url)
await import(
  pathToFileURL(
    join(dirname(require.resolve('electron-vite/package.json')), 'bin/electron-vite.js')
  ).href
)
