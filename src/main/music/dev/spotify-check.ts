// Dev only: drives the real Spotify app through the controller. Volume 15 %, under a minute, always pauses.
// Run: npx tsx --tsconfig tsconfig.node.json src/main/music/dev/spotify-check.ts [spotify:track:…]
import { runOsascript, SpotifyMacController, type OsascriptRunner } from '../controller'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const show = (label: string, t: unknown): void => console.log(label, JSON.stringify(t))

export async function runSpotifyCheck(
  c: SpotifyMacController,
  run: OsascriptRunner,
  uri = process.argv[2] ?? 'spotify:track:4cOdK2wGLETKBW3PvgPWqT'
): Promise<void> {
  if (!(await c.isAvailable())) {
    console.log('Spotify is not running. Open it and retry (this script never launches it).')
    return
  }
  const savedVolume = Number(
    (
      await run(
        'if application "Spotify" is running then tell application "Spotify" to get sound volume'
      )
    ).trim()
  )
  const savedTrack = await c.current()
  if (!Number.isFinite(savedVolume)) throw new Error('Could not read Spotify volume')
  let interrupted = false
  const onInterrupt = (): void => {
    interrupted = true
  }
  process.on('SIGINT', onInterrupt)
  const stop = c.onTrackChange((t) =>
    show('onTrackChange:', { id: t.id, name: t.name, state: t.state })
  )
  try {
    await c.play('spotify:track:x" & (do shell script "id") & "').then(
      () => console.log('UNSAFE: bad URI was accepted'),
      (e: Error) => console.log('bad URI rejected:', e.message)
    )
    await c.setVolume(15)
    await c.play(uri)
    for (let i = 0; i < 3; i++) {
      await sleep(2000)
      if (interrupted) break
      show(`current #${i + 1}:`, await c.current())
    }
    if (!interrupted) {
      await c.next()
      await sleep(3000)
      if (!interrupted) show('after next:', await c.current())
    }
  } finally {
    stop()
    process.off('SIGINT', onInterrupt)
    try {
      if (savedTrack) await c.play(savedTrack.uri).catch(() => {})
    } finally {
      try {
        await run(
          `if application "Spotify" is running then tell application "Spotify" to set sound volume to ${Math.round(savedVolume)}`
        )
      } finally {
        if (savedTrack?.state === 'paused' || savedTrack?.state === 'stopped') await c.pause()
      }
    }
  }
}

const controller = new SpotifyMacController()
if (process.argv[1]?.endsWith('spotify-check.ts')) void runSpotifyCheck(controller, runOsascript)
