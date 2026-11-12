import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanUserData } from './scan'

it('scans nested files and rejects raw fields without rejecting threshold names', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ovra-scan-'))
  try {
    await mkdir(join(dir, 'cache'))
    await writeFile(join(dir, 'settings.json'), '{"thresholdOverrides":{"tensePulsePct":0.1}}')
    expect(await scanUserData(dir)).toBe(1)
    await writeFile(join(dir, 'cache', 'binary'), Buffer.from('prefix\0{"pulse":70}'))
    await expect(scanUserData(dir)).rejects.toThrow('Raw vital field')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
