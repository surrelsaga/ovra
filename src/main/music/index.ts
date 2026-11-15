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
import { FALLBACK_PLAYLISTS, musicConfig, SPOTIFY_CLOSED_HINT, SPOTIFY_HINT } from './config'
import { createLibrary, parsePlaylistUrl } from './library'
import { applyOutcome, judgePlay } from './library/learning'
import { createScorer } from './scoring'
import {
  createTargetTracker,
  desiredTarget,
  effective,
  pickSong,
  steadyEnergy,
  TARGET_REASON,
  type TargetGap
} from './selector'

export interface MusicDeps {
  bus: Bus
  storage: Storage
  privacy: PrivacyService
  controller: MusicController
  /** Returns a key or null. Never log it. */
  getKey: (name: 'OPENROUTER_API_KEY' | 'LASTFM_API_KEY') => string | null
  /** Dev simulator: shorter target-change gap. Defaults to musicConfig.switching. */
  targetGap?: TargetGap
  /** Test seams. */
  now?: () => number
  rng?: () => number
  fetch?: typeof fetch
}

interface PlayRecord {
  songId: string
  startedAt: number
  before: Situation | null
  during: Situation[]
  endedByApp: boolean
}

export function createMusic(deps: MusicDeps): MusicService & {
  refreshStatus(): Promise<MusicStatus>
} {
  const { bus, privacy, controller } = deps
  const now = deps.now ?? Date.now
  const rng = deps.rng ?? Math.random
  const library = createLibrary(deps.storage, deps.fetch)
  const tracker = createTargetTracker(deps.targetGap)
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

  let generation = 0
  let session: Session | null = null
  let situation: Situation | null = null
  let hasSituation = false
  let remainingSec: number | undefined
  let leaveAlone = privacy.getSettings().leaveMusicAlone
  let available = false
  let nowPlaying: NowPlaying | null = null
  let stopPolling: (() => void) | null = null
  let endTimer: ReturnType<typeof setTimeout> | null = null
  let play: PlayRecord | null = null
  let hintShown = false
  let spotifyWasOpen = false
  let pausedForBreak = false
  let settleFade: Promise<void> | null = null
  let cancelSettleFade: (() => void) | null = null
  const played = new Map<string, number>()
  const unavailableSongs = new Set<string>()
  let verifyTimer: ReturnType<typeof setTimeout> | null = null
  let pendingPick: { id: string; previousId?: string } | null = null
  const fallbackLinks = new Map<string, number>()
  let picks = 0
  let fallbackPicks = 0
  let picking = -1
  let checkingAvailability: Promise<void> | null = null
  let lastRetry = 0

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
    bus.emit('orb:bubble', { text: spotifyWasOpen ? SPOTIFY_CLOSED_HINT : SPOTIFY_HINT })
  }

  function observeAvailability(running: boolean): void {
    available = running
    if (running) {
      if (session) spotifyWasOpen = true
      hintShown = false
    } else if (session) {
      safe(abortSettleFade())
      if (endTimer) clearTimeout(endTimer)
      endTimer = null
      if (verifyTimer) clearTimeout(verifyTimer)
      verifyTimer = null
      pendingPick = null
      finishPlay()
      nowPlaying = null
      hint()
    }
    emitStatus()
  }

  function checkAvailability(): Promise<void> {
    if (checkingAvailability) return checkingAvailability
    const g = generation
    const activeSession = session
    checkingAvailability = (async () => {
      const running = await controller.isAvailable().catch(() => false)
      if (g !== generation || session !== activeSession) return
      const wasAvailable = available
      observeAvailability(running)
      if (session && running && !wasAvailable && !leaveAlone && !pausedForBreak) await playNext()
    })().finally(() => {
      checkingAvailability = null
    })
    return checkingAvailability
  }

  async function fadePlay(
    uri: string,
    contextUri: string | undefined,
    activeSession: Session,
    g: number
  ): Promise<boolean> {
    if (settleFade) return false
    const getVolume = controller.getVolume
    if (!getVolume) {
      await controller.play(uri, contextUri)
      return true
    }
    let cancelled = false
    let userChanged = false
    let switched = false
    let initial: number | null = null
    let lastSet = 0
    let attemptedVolume: number | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let finishWait: (() => void) | undefined
    cancelSettleFade = () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      finishWait?.()
    }
    const wait = (): Promise<void> =>
      new Promise((resolve) => {
        finishWait = resolve
        timer = setTimeout(
          resolve,
          musicConfig.switching.settleFadeMs / musicConfig.switching.settleFadeSteps
        )
      })
    const stillCurrent = (): boolean =>
      !cancelled &&
      g === generation &&
      session === activeSession &&
      privacy.get().music === 'spotify' &&
      !leaveAlone
    const run = async (): Promise<void> => {
      try {
        initial = await getVolume.call(controller).catch(() => null)
        if (initial === null || cancelled) {
          if (initial === null && !cancelled) {
            await controller.play(uri, contextUri)
            switched = true
          }
          return
        }
        lastSet = initial
        const floor = Math.min(initial, musicConfig.switching.settleVolumeFloor)
        const change = async (volume: number): Promise<boolean> => {
          const actual = await getVolume.call(controller).catch(() => null)
          if (
            actual !== null &&
            Math.abs(actual - lastSet) > musicConfig.switching.settleVolumeTolerance
          ) {
            userChanged = true
            return false
          }
          if (!stillCurrent()) return false
          // A command can take effect in Spotify even if its reply fails.
          attemptedVolume = volume
          await controller.setVolume(volume)
          lastSet = volume
          attemptedVolume = null
          return true
        }
        for (let step = 1; step <= musicConfig.switching.settleFadeSteps; step++) {
          if (!stillCurrent()) return
          const volume =
            initial + ((floor - initial) * step) / musicConfig.switching.settleFadeSteps
          if (!(await change(Math.round(volume)))) return
          await wait()
          if (!stillCurrent()) return
        }
        await controller.play(uri, contextUri)
        switched = true
        for (let step = 1; step <= musicConfig.switching.settleFadeSteps; step++) {
          if (!stillCurrent()) return
          const volume = floor + ((initial - floor) * step) / musicConfig.switching.settleFadeSteps
          if (!(await change(Math.round(volume)))) return
          await wait()
          if (!stillCurrent()) return
        }
      } catch {
        // Restore the user's level below even when playback or a volume command fails.
      } finally {
        if (initial !== null && !userChanged && (lastSet !== initial || attemptedVolume !== null)) {
          const actual = await getVolume.call(controller).catch(() => null)
          if (
            actual === null ||
            Math.abs(actual - lastSet) <= musicConfig.switching.settleVolumeTolerance ||
            (attemptedVolume !== null &&
              Math.abs(actual - attemptedVolume) <= musicConfig.switching.settleVolumeTolerance)
          )
            await controller.setVolume(initial).catch(() => {})
        }
        if (settleFade === promise) {
          settleFade = null
          cancelSettleFade = null
        }
      }
    }
    const promise = run()
    settleFade = promise
    await promise
    return switched
  }

  async function abortSettleFade(): Promise<void> {
    cancelSettleFade?.()
    await settleFade
  }

  /** Every near-end decision makes a fresh exact pick, even when the target is unchanged. */
  async function playNext(): Promise<void> {
    const target = tracker.current()
    if (
      !session ||
      privacy.get().music !== 'spotify' ||
      leaveAlone ||
      !target ||
      picking === generation
    )
      return
    picking = generation
    const activeSession = session
    const g = generation
    try {
      const running = await controller.isAvailable().catch(() => false)
      if (
        g !== generation ||
        session !== activeSession ||
        privacy.get().music !== 'spotify' ||
        leaveAlone
      )
        return
      observeAvailability(running)
      if (!running) return
      const cur = nowPlaying ? library.get(nowPlaying.id) : undefined
      const context = {
        now: now(),
        activity:
          (situation === null || situation === 'focused' || situation === 'good') &&
          (target === 'steady' || target === 'lift' || target === 'let-it-ride')
            ? activeSession.config.activity
            : undefined,
        rng,
        currentId: nowPlaying?.id,
        played,
        picks,
        fallbackPicks,
        currentEnergy: cur ? effective(cur)?.energy : undefined,
        steadyEnergy: steadyEnergy(library.songs()),
        playlistNames: new Map(library.playlists().map((p) => [p.uri, p.name ?? '']))
      }
      if (fallbackPicks < Math.floor((picks + 1) / musicConfig.selection.fallbackEvery)) {
        for (const url of FALLBACK_PLAYLISTS[target]) {
          const parsed = parsePlaylistUrl(url)!
          const prev = fallbackLinks.get(parsed.uri)
          if (prev !== undefined && now() - prev < musicConfig.catalog.refreshMs) continue
          await library.readPlaylist({ ...parsed, addedAt: now() }, now(), 'fallback')
          fallbackLinks.set(parsed.uri, now())
          library.songs().forEach((s) => scorer.enqueue(s))
        }
      }
      if (g !== generation || session !== activeSession || leaveAlone) return
      const song = pickSong(
        library.songs().filter((s) => !unavailableSongs.has(s.id)),
        target,
        context
      )
      const link = library.playlists()[0]
      const uri = song?.id ?? link?.uri
      if (!uri) return
      const contextUri =
        song?.playlists?.[0] ?? link?.uri ?? parsePlaylistUrl(FALLBACK_PLAYLISTS[target][0])!.uri
      const previousId = nowPlaying?.id ?? (await controller.current())?.id
      if (g !== generation || session !== activeSession || leaveAlone) return
      if (play) play.endedByApp = true
      try {
        if (target === 'settle') {
          // Verifying an unplayed pick would restart a cancelled fade.
          if (!(await fadePlay(uri, contextUri, activeSession, g))) return
        } else await controller.play(uri, contextUri)
      } catch (error) {
        if (g !== generation || session !== activeSession) return
        if (!song) throw error
        unavailableSongs.add(song.id)
        verifyTimer = setTimeout(() => {
          if (g === generation) safe(playNext())
        }, 0)
        return
      }
      if (g !== generation || session !== activeSession) return
      if (song) played.set(song.id, now())
      picks++
      if (song?.origin === 'fallback') fallbackPicks++
      if (verifyTimer) clearTimeout(verifyTimer)
      pendingPick = song && process.platform !== 'win32' ? { id: song.id, previousId } : null
      if (song && pendingPick)
        verifyTimer = setTimeout(() => safe(verifyPick(song.id, g)), musicConfig.controller.pollMs)
    } finally {
      if (picking === g) picking = -1
    }
  }

  async function verifyPick(id: string, g: number): Promise<void> {
    verifyTimer = null
    const pending = pendingPick
    const actual = await controller.current()
    if (
      !pending ||
      pendingPick !== pending ||
      pending.id !== id ||
      g !== generation ||
      !session ||
      leaveAlone ||
      !actual ||
      actual.isAd ||
      actual.state !== 'playing'
    )
      return
    pendingPick = null
    if (library.resolve(actual).id === id) return
    // Spotify can reject an exact pick; avoid retrying that track for the rest of this session.
    unavailableSongs.add(id)
    played.delete(id)
    picks--
    if (library.get(id)?.origin === 'fallback') fallbackPicks--
    await playNext()
  }

  function evaluate(): void {
    if (!session || privacy.get().music !== 'spotify' || leaveAlone) return
    const desired = desiredTarget({ situation, activity: session.config.activity, remainingSec })
    if (!hasSituation && situation !== null) {
      hasSituation = true
      // The neutral starting pick must not delay the first real target.
      if (desired !== tracker.current()) tracker.reset()
    }
    const changed = tracker.update(desired, session.config.activity, now())
    if (!changed) return
    bus.emit('music:target-changed', {
      target: changed,
      word: TARGET_WORD[changed],
      reason: TARGET_REASON[changed]
    })
    emitStatus()
    // Only change between tracks, except Settle, which switches right away.
    if (changed === 'settle') safe(playNext())
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
    await playNext()
  }

  /** Learning: judge the song that just stopped playing. */
  function finishPlay(): void {
    const p = play
    play = null
    const song = p && library.get(p.songId)
    if (!p || !song) return
    const outcome = judgePlay({ ...p, listenedMs: now() - p.startedAt })
    const learnedSomething =
      outcome.settle || outcome.steady || outcome.lift || outcome.good || outcome.quickSkip
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
    if (!session) return
    const g = generation
    t = library.resolve(t)
    if (pendingPick && t.id !== pendingPick.previousId) {
      pendingPick = null
      if (verifyTimer) clearTimeout(verifyTimer)
      verifyTimer = null
    }
    const prev = nowPlaying
    nowPlaying = t
    observeAvailability(true)
    scheduleEnd(t)
    if (prev?.id === t.id && (prev.state !== t.state || t.state !== 'playing')) return emitStatus()
    finishPlay()
    bus.emit('music:track-changed', t)
    if (!t.isAd && t.id.startsWith('spotify:track:')) {
      played.set(t.id, now())
      play = { songId: t.id, startedAt: now(), before: situation, during: [], endedByApp: false }
    }
    safe(
      library.learn(t, now()).then((song) => {
        if (g !== generation) return
        if (song) scorer.enqueue(song)
        emitStatus()
      })
    )
  }

  async function stopInternal(): Promise<void> {
    await abortSettleFade()
    generation++
    if (verifyTimer) clearTimeout(verifyTimer)
    verifyTimer = null
    pendingPick = null
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
    situation = u.situation ?? situation
    if (play && u.situation) play.during.push(u.situation)
    evaluate()
  })
  bus.on('session:tick', (tick) => {
    if (!session || tick.sessionId !== session.id) return
    remainingSec = tick.remainingSec
    evaluate()
    if (now() - lastRetry < musicConfig.controller.unavailableRetryMs) return
    lastRetry = now()
    safe(checkAvailability())
  })
  bus.on('break:away', () => {
    safe(abortSettleFade())
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
    safe(stopInternal())
    nowPlaying = null
    available = false
    leaveAlone = privacy.getSettings().leaveMusicAlone
    scorer.reset()
    fallbackLinks.clear()
    library.forget()
    play = null
    emitStatus()
  })

  bus.on('privacy:changed', (p) => {
    if (p.aiScoring) safe(ready.then(() => library.songs().forEach((song) => scorer.enqueue(song))))
    if (p.music !== 'none') return
    safe(stopInternal())
    nowPlaying = null
    emitStatus()
  })

  return {
    status() {
      if (!session) safe(checkAvailability())
      return status()
    },
    async refreshStatus() {
      if (!session) await checkAvailability()
      return status()
    },
    async library() {
      await ready
      return { songs: library.songs(), playlists: library.playlists() }
    },
    async addPlaylist(url) {
      await ready
      const link = await library.addPlaylist(url, now())
      library.songs().forEach((s) => scorer.enqueue(s))
      emitStatus()
      return link
    },
    async removePlaylist(uri) {
      await ready
      await library.removePlaylist(uri)
    },
    setLeaveAlone(value) {
      leaveAlone = value
      if (value) safe(abortSettleFade())
      safe(privacy.setSettings({ leaveMusicAlone: value }))
      if (value && endTimer) clearTimeout(endTimer)
      if (!value) {
        if (nowPlaying) scheduleEnd(nowPlaying)
        evaluate()
        if (!nowPlaying) safe(playNext())
      }
      emitStatus()
    },
    async clearLibrary() {
      await ready
      scorer.reset()
      fallbackLinks.clear()
      unavailableSongs.clear()
      if (verifyTimer) clearTimeout(verifyTimer)
      verifyTimer = null
      pendingPick = null
      play = null
      await library.clear()
      emitStatus()
    },
    async rescore(songId) {
      await ready
      await scorer.rescore(songId)
    },
    async startSession(s) {
      const g = generation
      await ready
      if (g !== generation) return
      await stopInternal()
      if (!s.config.music || privacy.get().music !== 'spotify') return emitStatus()
      session = s
      situation = null
      hasSituation = false
      remainingSec = undefined
      hintShown = false
      spotifyWasOpen = false
      played.clear()
      unavailableSongs.clear()
      picks = 0
      fallbackPicks = 0
      nowPlaying = null
      lastRetry = now()
      const startedGeneration = generation
      stopPolling = controller.onTrackChange(onTrack)
      evaluate()
      const running = await controller.isAvailable().catch(() => false)
      if (generation !== startedGeneration || session !== s) return
      observeAvailability(running)
      await library.refresh(now())
      if (generation !== startedGeneration || session !== s) return
      library.songs().forEach((song) => scorer.enqueue(song))
      if (running && !leaveAlone) await playNext().catch(() => {})
      emitStatus()
    },
    async stopSession() {
      await stopInternal()
      emitStatus()
    }
  }
}

/** Registers music:* IPC handlers. */
export function registerMusicIpc(music: ReturnType<typeof createMusic>): void {
  handle('music:status', () => music.refreshStatus())
  handle('music:library', () => music.library())
  handle('music:add-playlist', ({ url }) => music.addPlaylist(url))
  handle('music:remove-playlist', ({ uri }) => music.removePlaylist(uri))
  handle('music:set-leave-alone', ({ value }) => music.setLeaveAlone(value))
  handle('music:clear-library', () => music.clearLibrary())
  handle('music:rescore', ({ songId }) => music.rescore(songId))
}
