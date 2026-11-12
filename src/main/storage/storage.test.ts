import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as fsp from 'node:fs/promises'
import type { StorageFile } from '@shared/types'
import { createStorage, RawDataError } from '.'

vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>()
  return { ...real, rename: vi.fn(real.rename) }
})

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ovra-storage-'))
})
afterEach(async () => {
  vi.mocked(fsp.rename).mockClear()
  await rm(dir, { recursive: true, force: true })
})

describe('storage', () => {
  it('round-trips JSON and returns the fallback for a missing file', async () => {
    const s = createStorage(dir)
    expect(await s.read('settings', { a: 1 })).toEqual({ a: 1 })
    await s.write('settings', { b: 2 })
    expect(await s.read('settings', {})).toEqual({ b: 2 })
  })

  it('refuses unknown file names', async () => {
    const s = createStorage(dir)
    expect(() => s.write('frames' as StorageFile, {})).toThrow(/unknown file/)
    expect(() => s.read('../etc' as StorageFile, null)).toThrow(/unknown file/)
    expect(() => s.remove('video' as StorageFile)).toThrow(/unknown file/)
    expect(await readdir(dir)).toEqual([])
  })

  it('falls back on a corrupt file and keeps a .corrupt copy', async () => {
    const s = createStorage(dir)
    await writeFile(join(dir, 'sessions.json'), '{not json')
    expect(await s.read('sessions', [])).toEqual([])
    expect(await readFile(join(dir, 'sessions.json.corrupt'), 'utf8')).toBe('{not json')
    expect((await readdir(dir)).includes('sessions.json')).toBe(false)
  })

  it('writes atomically: temp file then rename, no temp left behind', async () => {
    const s = createStorage(dir)
    await s.write('playlists', [1, 2, 3])
    const [from, to] = vi.mocked(fsp.rename).mock.calls[0]
    expect(String(from)).toMatch(/\.playlists\..+\.tmp$/)
    expect(to).toBe(join(dir, 'playlists.json'))
    expect(await readdir(dir)).toEqual(['playlists.json'])
  })

  it('keeps the old file intact when the rename fails', async () => {
    const s = createStorage(dir)
    await s.write('settings', { v: 1 })
    vi.mocked(fsp.rename).mockRejectedValueOnce(new Error('disk full'))
    await expect(s.write('settings', { v: 2 })).rejects.toThrow('disk full')
    expect(await s.read('settings', {})).toEqual({ v: 1 })
    expect(await readdir(dir)).toEqual(['settings.json'])
  })

  it('serialises writes per file (last call wins)', async () => {
    const s = createStorage(dir)
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.write('songs', { i })))
    expect(await s.read('songs', {})).toEqual({ i: 19 })
  })

  it('remove deletes the file and its .corrupt copy', async () => {
    const s = createStorage(dir)
    await writeFile(join(dir, 'songs.json'), 'x')
    await s.read('songs', [])
    await s.write('songs', [])
    await s.remove('songs')
    expect(await readdir(dir)).toEqual([])
  })
})

describe('raw data guard', () => {
  const sneaky: Array<[StorageFile, unknown]> = [
    ['sessions', [{ id: 'a', pulse: { value: 72, confidence: 90, stable: true } }]],
    ['sessions', [{ id: 'a', moodTimeline: [{ t: 1, situation: 'tense', Breathing: 14 }] }]],
    ['sessions', [{ id: 'a', extra: { hrv: { rmssd: 80 } } }]],
    ['sessions', [{ id: 'a', RMSSD: 80 }]],
    ['settings', { sdnn: 40 }],
    ['settings', { baevsky: 0.3 }],
    ['sessions', [{ id: 'a', landmarks: [[0, 0]] }]],
    ['sessions', [{ id: 'a', expressions: { happy: 80 } }]],
    ['privacy', { baseline: { pulse: 60 } }],
    ['sessions', [{ id: 'a', state: { confidence: 0.8 } }]],
    ['songs', [{ id: 'spotify:track:1', pulse: 70 }]],
    ['songs', [{ id: 'spotify:track:1', learned: { baseline: 62 } }]]
  ]

  it.each(sneaky)('refuses raw vitals in %s: %j', async (file, data) => {
    const s = createStorage(dir)
    expect(() => s.write(file, data)).toThrow(RawDataError)
    expect(await readdir(dir)).toEqual([])
  })

  it('allows song scores and learned adjustments in songs only', async () => {
    const s = createStorage(dir)
    const song = {
      id: 'spotify:track:1',
      scores: { energy: 2, mood: 'bright', vocals: 'light', confidence: 0.8, source: 'llm' },
      learned: { energyDelta: -0.5, confidenceDelta: 0.1, settleVotes: 2 }
    }
    await s.write('songs', [song])
    expect(await s.read('songs', [])).toEqual([song])
  })

  it('allows threshold override names that only contain a vital word', async () => {
    const s = createStorage(dir)
    await s.write('settings', {
      thresholdOverrides: { tensePulsePct: 0.12, lowBreathingPct: -0.2 }
    })
  })
})
