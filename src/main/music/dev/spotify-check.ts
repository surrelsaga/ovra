// Manual only: npx tsx --tsconfig tsconfig.node.json src/main/music/dev/spotify-check.ts <playlist link>
import { SpotifyMacController } from '../controller'
import { musicConfig } from '../config'
import { createLibrary } from '../library'
import { pickSong } from '../selector'
import { memoryStorage } from './memory-storage'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function runSpotifyCheck(
  c: SpotifyMacController,
  url = process.argv[2] ?? '',
  f: typeof fetch = fetch
): Promise<void> {
  if (!(await c.isAvailable())) {
    console.log('Spotify is not running. This check never launches it.')
    return
  }
  await c.withPlaybackRestored(async (interrupted) => {
    const library = createLibrary(memoryStorage(), f)
    const link = await library.addPlaylist(url, Date.now())
    if (link.readError) throw new Error(link.readError)
    const played = new Map<string, number>()
    for (let i = 0; i < musicConfig.devCheck.picks && !interrupted(); i++) {
      const song = pickSong(library.songs(), 'steady', { now: Date.now(), rng: () => 0, played })
      if (!song) throw new Error('No playable songs in this playlist')
      await c.setVolume(musicConfig.devCheck.volume)
      if (interrupted()) break
      await c.play(song.id, song.playlists?.[0])
      played.set(song.id, Date.now())
      await sleep(musicConfig.devCheck.listenMs)
      console.log('Pick', i + 1, song.title, '—', song.artist)
    }
  })
}

if (process.argv[1]?.endsWith('spotify-check.ts')) {
  void runSpotifyCheck(new SpotifyMacController()).catch(() => {
    console.error('Spotify check failed; restoration was attempted.')
    process.exitCode = 1
  })
}
