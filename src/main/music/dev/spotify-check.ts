// Dev only: drives the real Spotify app through the controller. Volume 15 %, under a minute, always pauses.
// Run: npx tsx --tsconfig tsconfig.node.json src/main/music/dev/spotify-check.ts [spotify:track:…]
import { SpotifyMacController } from '../controller'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const show = (label: string, t: unknown): void => console.log(label, JSON.stringify(t))

async function main(): Promise<void> {
  const c = new SpotifyMacController()
  if (!(await c.isAvailable())) {
    console.log('Spotify is not running. Open it and retry (this script never launches it).')
    return
  }
  const uri = process.argv[2] ?? 'spotify:track:4cOdK2wGLETKBW3PvgPWqT'
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
      show(`current #${i + 1}:`, await c.current())
    }
    await c.next()
    await sleep(3000)
    show('after next:', await c.current())
  } finally {
    stop()
    await c.pause()
    await sleep(500)
    show('after pause:', await c.current())
  }
}

void main()
