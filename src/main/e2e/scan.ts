import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const rawField =
  /"(?:pulse|pulseRate|heartRate|bpm|breathing|breathingRate|hrv|rmssd|sdnn|meanNn|baevsky|landmarks|expressions?|baseline|blinkRate|headRollDeg|metrics)"\s*:/i

/** Scan every regular file, including Chromium caches, without logging file contents. */
export async function scanUserData(dir: string): Promise<number> {
  let count = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) count += await scanUserData(path)
    else if (entry.isFile()) {
      const data = await readFile(path)
      if (rawField.test(data.toString('utf8'))) throw new Error(`Raw vital field in ${path}`)
      count++
    }
  }
  return count
}
