import { z } from 'zod'
import { musicConfig } from '../config'

const track = z.object({
  uri: z.string(),
  title: z.string(),
  subtitle: z.string().default(''),
  duration: z.number().nonnegative().optional(),
  isPlayable: z.boolean(),
  entityType: z.string()
})
const entity = z.object({ name: z.string(), trackList: z.array(z.unknown()) })
const page = z.object({
  props: z.object({
    pageProps: z.object({
      status: z.number().optional(),
      state: z.object({ data: z.object({ entity }) }).optional()
    })
  })
})

export function parseEmbed(html: string): Omit<z.infer<typeof entity>, 'trackList'> & {
  trackList: z.infer<typeof track>[]
} {
  try {
    const json = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)
    if (!json) throw new Error()
    const p = page.parse(JSON.parse(json[1])).props.pageProps
    if (p.status === 404 || !p.state) throw new Error('This playlist is private or empty')
    const e = p.state.data.entity
    const tracks = e.trackList.flatMap((raw) => {
      const t = track.safeParse(raw)
      return t.success &&
        t.data.entityType === 'track' &&
        /^spotify:track:[A-Za-z0-9]+$/.test(t.data.uri)
        ? [{ ...t.data, subtitle: t.data.subtitle.trim() }]
        : []
    })
    if (!tracks.length) throw new Error('This playlist is private or empty')
    return { name: e.name, trackList: tracks }
  } catch (error) {
    if (error instanceof Error && error.message === 'This playlist is private or empty') throw error
    throw new Error("Couldn't read this playlist's songs. I'll learn them as they play.", {
      cause: error
    })
  }
}

export async function fetchPlaylist(
  uri: string,
  f: typeof fetch
): Promise<ReturnType<typeof parseEmbed>> {
  const c = musicConfig.catalog
  const res = await f(`${c.embedUrl}${uri.split(':').at(-1)}`, {
    headers: { 'User-Agent': c.userAgent },
    credentials: 'omit',
    signal: AbortSignal.timeout(c.timeoutMs)
  })
  if (!res.ok) throw new Error("Couldn't read this playlist's songs. I'll learn them as they play.")
  return parseEmbed(await res.text())
}
