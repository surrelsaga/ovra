// Owner: Agent C (music). Controller, library, scoring, learning, selector.
import type {
  Bus,
  MusicController,
  MusicService,
  MusicStatus,
  NowPlaying,
  PrivacyService,
  Session,
  Situation,
  Storage
} from '@shared/types'
import { TARGET_WORD } from '@shared/types'
import { handle } from '../ipc'
import { FALLBACK_PLAYLISTS, musicConfig } from './config'
import { createLibrary, parsePlaylistUrl } from './library'
import { applyOutcome, judgePlay } from './library/learning'
import { createScorer } from './scoring'
import {
  createTargetTracker,
  desiredTarget,
  effective,
  pickSong,
  steadyEnergy,
  TARGET_REASON
} from './selector'

export interface MusicDeps {
  bus: Bus
  storage: Storage
  privacy: PrivacyService
  controller: MusicController
  /** Returns a key or null. Never log it. */
  getKey: (name: 'OPENROUTER_API_KEY' | 'LASTFM_API_KEY') => string | null
  /** Test seams. */
  now?: () => number
  rng?: () => number
  fetch?: typeof fetch
}

const SPOTIFY_HINT = 'Open Spotify to let me pick music'

interface PlayRecord {
  songId: string
  startedAt: number
  before: Situation | null
  during: Situation[]
  endedByApp: boolean
}

export function createMusic(deps: MusicDeps): MusicService {
  const { bus, privacy, controller } = deps
  const now = deps.now ?? Date.now
  const rng = deps.rng ?? Math.random
  const library = createLibrary(deps.storage)
  const tracker = createTargetTracker()
  const scorer = createScorer({
    library,
    aiEnabled: () => privacy.get().aiScoring,
    getKey: deps.getKey,
    fetch: deps.fetch,
    now,
    onChange: () => emitStatus()
  })
  const ready = library
    .load()
    .then(() => library.songs().forEach((s) => scorer.enqueue(s)))
    .catch(() => {})

  let session: Session | null = null
  let situation: Situation | null = null
  let remainingSec: number | undefined
  let leaveAlone = privacy.getSettings().leaveMusicAlone
  let available = false
  let nowPlaying: NowPlaying | null = null
  let stopPolling: (() => void) | null = null
  let endTimer: ReturnType<typeof setTimeout> | null = null
  let play: PlayRecord | null = null
  let hintShown = false
  let pausedForBreak = false
  /** Last target the app acted on with a playlist fallback (once per target change). */
  let actedTarget: string | null = null

  const status = (): MusicStatus => ({
    available,
    leaveAlone,
    target: tracker.current(),
    nowPlaying,
    scoringQueue: scorer.pending(),
    scoredCount: library.songs().filter((s) => s.scores).length
  })
  const emitStatus = (): void => bus.emit('music:status', status())
  const safe = (p: Promise<unknown>): void => void p.catch(() => {})

  function hint(): void {
    if (hintShown) return
    hintShown = true
    bus.emit('orb:bubble', { text: SPOTIFY_HINT })
  }

  function fallbackUri(target: string): string | null {
    const list = (FALLBACK_PLAYLISTS[target as keyof typeof FALLBACK_PLAYLISTS] ?? [])
      .map((u) => parsePlaylistUrl(u)?.uri)
      .filter((u): u is string => !!u)
    return list.length ? list[Math.floor(rng() * list.length)] : null
  }

  /** Plays the best song for the target; else a fallback playlist once per target (or a user playlist at start). */
  async function playNext(atStart: boolean): Promise<void> {
    const target = tracker.current()
    if (!session || privacy.get().music !== 'spotify' || leaveAlone || !target) return
    const activeSession = session
    available = await controller.isAvailable()
    if (session !== activeSession || privacy.get().music !== 'spotify') return
    if (!available) return hint()
    const songs = library.songs()
    const cur = nowPlaying ? library.get(nowPlaying.id) : undefined
    const song = pickSong(songs, target, {
      now: now(),
      rng,
      currentId: nowPlaying?.id,
      currentEnergy: cur ? effective(cur)?.energy : undefined,
      steadyEnergy: steadyEnergy(songs)
    })
    let uri = song?.id ?? null
    if (!uri && actedTarget !== target) {
      const mine = library.playlists()
      uri =
        fallbackUri(target) ??
        (atStart && mine.length ? mine[Math.floor(rng() * mine.length)].uri : null)
    }
    if (!uri) return
    actedTarget = target
    if (play) play.endedByApp = true
    await controller.play(uri)
  }

  function evaluate(): void {
    if (!session || privacy.get().music !== 'spotify' || leaveAlone) return
    const desired = desiredTarget({ situation, activity: session.config.activity, remainingSec })
    const changed = tracker.update(desired, session.config.activity, now())
    if (!changed) return
    bus.emit('music:target-changed', {
      target: changed,
      word: TARGET_WORD[changed],
      reason: TARGET_REASON[changed]
    })
    emitStatus()
    // Only change between tracks, except Settle, which switches right away.
    if (changed === 'settle') safe(playNext(false))
  }

  function scheduleEnd(t: NowPlaying): void {
    if (endTimer) clearTimeout(endTimer)
    endTimer = null
    if (!session || leaveAlone || t.isAd || t.state !== 'playing' || !t.durationMs) return
    const lead = musicConfig.switching.endLeadMs
    endTimer = setTimeout(() => safe(nearEnd()), Math.max(0, t.durationMs - t.positionMs - lead))
  }

  async function nearEnd(): Promise<void> {
    endTimer = null
    const t = await controller.current()
    if (!t || !nowPlaying || t.id !== nowPlaying.id) return
    if (t.durationMs - t.positionMs > musicConfig.switching.endLeadMs * 2) {
      nowPlaying = t
      return scheduleEnd(t)
    }
    await playNext(false)
  }

  /** Learning: judge the song that just stopped playing. */
  function finishPlay(): void {
    const p = play
    play = null
    const song = p && library.get(p.songId)
    if (!p || !song) return
    const outcome = judgePlay({ ...p, listenedMs: now() - p.startedAt })
    const learnedSomething = outcome.settle || outcome.steady || outcome.quickSkip
    safe(
      library.update({
        ...song,
        learned: applyOutcome(song.learned, outcome, now()),
        scores:
          song.scores && learnedSomething ? { ...song.scores, source: 'learned' } : song.scores
      })
    )
  }

  function onTrack(t: NowPlaying): void {
    available = true
    const prev = nowPlaying
    nowPlaying = t
    scheduleEnd(t)
    if (prev?.id === t.id) return emitStatus()
    finishPlay()
    bus.emit('music:track-changed', t)
    if (!t.isAd && t.id.startsWith('spotify:track:')) {
      play = { songId: t.id, startedAt: now(), before: situation, during: [], endedByApp: false }
    }
    safe(
      library.learn(t, now()).then((song) => {
        if (song) scorer.enqueue(song)
        emitStatus()
      })
    )
  }

  function stopInternal(): void {
    finishPlay()
    stopPolling?.()
    stopPolling = null
    if (endTimer) clearTimeout(endTimer)
    endTimer = null
    session = null
    nowPlaying = null
    available = false
    tracker.reset()
    pausedForBreak = false
  }

  bus.on('state:updated', (u) => {
    situation = u.situation
    if (play && u.situation) play.during.push(u.situation)
    evaluate()
  })
  bus.on('session:tick', (tick) => {
    if (!session || tick.sessionId !== session.id) return
    remainingSec = tick.remainingSec
    evaluate()
  })
  bus.on('break:away', () => {
    if (!session || nowPlaying?.state !== 'playing') return
    pausedForBreak = true
    safe(controller.pause())
  })
  bus.on('break:returned', () => {
    if (!pausedForBreak) return
    pausedForBreak = false
    safe(controller.resume())
  })
  bus.on('data:deleted-all', () => {
    play = null
    stopInternal()
    nowPlaying = null
    available = false
    leaveAlone = privacy.getSettings().leaveMusicAlone
    scorer.reset()
    library.forget()
    play = null
    emitStatus()
  })

  bus.on('privacy:changed', (p) => {
    if (p.music !== 'none') return
    stopInternal()
    nowPlaying = null
    emitStatus()
  })

  return {
    status,
    async library() {
      await ready
      return { songs: library.songs(), playlists: library.playlists() }
    },
    async addPlaylist(url) {
      await ready
      return library.addPlaylist(url, now())
    },
    async removePlaylist(uri) {
      await ready
      await library.removePlaylist(uri)
    },
    setLeaveAlone(value) {
      leaveAlone = value
      safe(privacy.setSettings({ leaveMusicAlone: value }))
      if (value && endTimer) clearTimeout(endTimer)
      if (!value) {
        if (nowPlaying) scheduleEnd(nowPlaying)
        evaluate()
      }
      emitStatus()
    },
    async clearLibrary() {
      await ready
      scorer.reset()
      play = null
      await library.clear()
      emitStatus()
    },
    async rescore(songId) {
      await ready
      await scorer.rescore(songId)
    },
    async startSession(s) {
      await ready
      stopInternal()
      if (!s.config.music || privacy.get().music !== 'spotify') return emitStatus()
      session = s
      situation = null
      remainingSec = undefined
      hintShown = false
      actedTarget = null
      nowPlaying = null
      stopPolling = controller.onTrackChange(onTrack)
      evaluate()
      if (leaveAlone) available = await controller.isAvailable()
      else await playNext(true).catch(() => {})
      emitStatus()
    },
    async stopSession() {
      stopInternal()
      emitStatus()
    }
  }
}

/** Registers music:* IPC handlers. */
export function registerMusicIpc(music: MusicService): void {
  handle('music:status', () => music.status())
  handle('music:library', () => music.library())
  handle('music:add-playlist', ({ url }) => music.addPlaylist(url))
  handle('music:remove-playlist', ({ uri }) => music.removePlaylist(uri))
  handle('music:set-leave-alone', ({ value }) => music.setLeaveAlone(value))
  handle('music:clear-library', () => music.clearLibrary())
  handle('music:rescore', ({ songId }) => music.rescore(songId))
}
