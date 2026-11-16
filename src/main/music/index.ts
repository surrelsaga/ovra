// Owner: Agent C (music). Controller, library, scoring, learning, selector.
import type {
  Bus,
  MusicController,
  MusicDecision,
  MusicService,
  MusicStatus,
  MusicTarget,
  NowPlaying,
  PrivacyService,
  Session,
  Situation,
  Song,
  Storage
} from '@shared/types'
import { TARGET_WORD } from '@shared/types'
import { handle } from '../ipc'
import { FALLBACK_PLAYLISTS, musicConfig, SPOTIFY_CLOSED_HINT, SPOTIFY_HINT } from './config'
import { createLibrary, parsePlaylistUrl } from './library'
import { applyOutcome, judgePlay } from './library/learning'
import type { PlayMode, PlayModeControl } from './controller'
import { createScorer } from './scoring'
import {
  createTargetTracker,
  desiredTarget,
  effective,
  fitsNow,
  pickSong,
  songKey,
  steadyEnergy,
  TARGET_REASON,
  type PickContext,
  type TargetGap
} from './selector'

export interface MusicDeps {
  bus: Bus
  storage: Storage
  privacy: PrivacyService
  /** Mac also saves/restores shuffle and repeat around a session. */
  controller: MusicController & Partial<PlayModeControl>
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
  contextUri?: string
  durationMs: number
  listenedMs: number
  playingSince: number | null
  startPositionMs: number
}

export function createMusic(deps: MusicDeps): MusicService & {
  refreshStatus(): Promise<MusicStatus>
  /** Simulator-only IPC: a playlist switch to the current target's best song (normal guards apply). */
  switchNow(): Promise<void>
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
  let play: PlayRecord | null = null
  let hintShown = false
  let spotifyWasOpen = false
  let pausedForBreak = false
  let ducking: Promise<void> | null = null
  let cancelDuck: (() => void) | null = null
  const played = new Map<string, number>()
  const unavailableSongs = new Set<string>()
  let verifyTimer: ReturnType<typeof setTimeout> | null = null
  let pendingPick: {
    id?: string
    uri: string
    contextUri?: string
    previousId?: string
    attempts: number
  } | null = null
  let cancelReadyWait: (() => void) | null = null
  const fallbackLinks = new Map<string, number>()
  let switching = -1
  let checkingAvailability: Promise<void> | null = null
  let lastRetry = 0
  // Steering (decision 61): one playlist per stretch, silent `next track` skips inside it.
  /** The playlist Ovra last started. Spotify can't tell us its context, so this is our own record. */
  let contextUri: string | undefined
  let contextSongs = 0
  const usedContexts = new Set<string>()
  let lastSwitchAt = -Infinity
  /** Songs heard this session (title + lead artist), so duplicates under another id count too. */
  const heard = new Set<string>()
  /** Songs Ovra skipped: not the user's quick skips. */
  const appSkipped = new Set<string>()
  /** Energy of the last song kept, for Calm down's step-down. */
  let keptEnergy: number | undefined
  let savedMode: PlayMode | null = null
  let steering: Promise<void> | null = null
  let steerAgain = false
  let songChanged = false
  let refusedLogged = false
  let judgedId: string | null = null
  let skippedId: string | null = null

  const status = (): MusicStatus => ({
    available,
    leaveAlone,
    target: tracker.current(),
    nowPlaying,
    scoringQueue: scorer.pending(),
    scoredCount: library.songs().filter((s) => s.scores).length,
    playlist: contextUri
      ? {
          uri: contextUri,
          name: library.playlists().find((p) => p.uri === contextUri)?.name,
          played: contextSongs
        }
      : undefined
  })
  const emitStatus = (): void => bus.emit('music:status', status())
  const playlistName = (uri: string | undefined): string =>
    library.playlists().find((p) => p.uri === uri)?.name || uri || 'none'
  const decision = (
    action: MusicDecision['action'],
    reason: string,
    from?: string,
    to?: string
  ): void =>
    bus.emit('monitor:music', {
      action,
      reason,
      from,
      to,
      playlist: playlistName(contextUri),
      played: contextSongs
    })
  const safe = (p: Promise<unknown>): void => void p.catch(() => {})
  const canSteer = (): boolean =>
    !!session && privacy.get().music === 'spotify' && !leaveAlone && !pausedForBreak

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
      safe(abortDuck())
      cancelPendingPlay()
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
      if (session && running && !wasAvailable && !leaveAlone && !pausedForBreak)
        await startPlaylist()
    })().finally(() => {
      checkingAvailability = null
    })
    return checkingAvailability
  }

  function cancelPendingPlay(): void {
    cancelReadyWait?.()
    cancelReadyWait = null
    if (verifyTimer) clearTimeout(verifyTimer)
    verifyTimer = null
    pendingPick = null
  }

  async function playVerified(uri: string, contextUri?: string): Promise<void> {
    const pending = pendingPick
    const g = generation
    await controller.play(uri, contextUri)
    decision('refocus', controller.refocusResult ?? 'not reported by controller')
    const actual = await controller.current().catch(() => null)
    if (!pending || pendingPick !== pending || g !== generation) return
    if (
      actual?.isAd ||
      (actual?.state === 'playing' && (!pending.id || library.resolve(actual).id === pending.id))
    ) {
      cancelPendingPlay()
      return
    }
    verifyTimer = setTimeout(() => safe(verifyPick(g)), musicConfig.controller.playVerifyMs)
  }

  interface Fade {
    floor: (initial: number) => number
    steps: number
    stepMs: number
  }
  /** Skip chains dip in one step; Quiet fades (Job 6's volume rules for both). */
  const DUCK: Fade = {
    floor: (initial) => Math.round(initial * musicConfig.steering.duckRatio),
    steps: 1,
    stepMs: 0
  }
  const QUIET: Fade = {
    floor: (initial) => Math.min(initial, musicConfig.switching.settleVolumeFloor),
    steps: musicConfig.switching.settleFadeSteps,
    stepMs: musicConfig.switching.settleFadeMs / musicConfig.switching.settleFadeSteps
  }

  /**
   * Lowers the volume, runs `action`, and brings the user's level back. The original level is
   * always restored unless the user changed it (±tolerance: Spotify reads back one point off).
   */
  async function withVolumeDown(
    fade: Fade,
    activeSession: Session,
    g: number,
    action: (alive: () => boolean) => Promise<void>
  ): Promise<void> {
    if (ducking) return
    let cancelled = false
    const alive = (): boolean =>
      !cancelled && g === generation && session === activeSession && canSteer()
    const getVolume = controller.getVolume
    if (!getVolume) return action(alive)
    let userChanged = false
    let initial: number | null = null
    let lastSet = 0
    let attemptedVolume: number | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let finishWait: (() => void) | undefined
    cancelDuck = () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      finishWait?.()
    }
    const wait = (): Promise<void> =>
      new Promise((resolve) => {
        finishWait = resolve
        timer = setTimeout(resolve, fade.stepMs)
      })
    const tolerance = musicConfig.switching.settleVolumeTolerance
    const run = async (): Promise<void> => {
      try {
        initial = await getVolume.call(controller).catch(() => null)
        if (cancelled) return
        // Unknown volume = no fade.
        if (initial === null) return await action(alive)
        lastSet = initial
        const floor = fade.floor(initial)
        const change = async (volume: number): Promise<boolean> => {
          const actual = await getVolume.call(controller).catch(() => null)
          if (actual !== null && Math.abs(actual - lastSet) > tolerance) {
            userChanged = true
            return false
          }
          if (!alive()) return false
          // A command can take effect in Spotify even if its reply fails.
          attemptedVolume = volume
          await controller.setVolume(volume)
          lastSet = volume
          attemptedVolume = null
          return true
        }
        for (let step = 1; step <= fade.steps; step++) {
          if (!alive()) return
          const volume = initial + ((floor - initial) * step) / fade.steps
          if (!(await change(Math.round(volume)))) return
          if (fade.stepMs) await wait()
        }
        if (!alive()) return
        await action(alive)
        for (let step = 1; step <= fade.steps; step++) {
          if (!alive()) return
          const volume = floor + ((initial - floor) * step) / fade.steps
          if (!(await change(Math.round(volume)))) return
          if (fade.stepMs && step < fade.steps) await wait()
        }
      } catch {
        // Restore the user's level below even when playback or a volume command fails.
      } finally {
        if (initial !== null && !userChanged && (lastSet !== initial || attemptedVolume !== null)) {
          const actual = await getVolume.call(controller).catch(() => null)
          if (
            actual === null ||
            Math.abs(actual - lastSet) <= tolerance ||
            (attemptedVolume !== null && Math.abs(actual - attemptedVolume) <= tolerance)
          )
            await controller.setVolume(initial).catch(() => {})
        }
        if (ducking === promise) {
          ducking = null
          cancelDuck = null
        }
      }
    }
    const promise = run()
    ducking = promise
    await promise
  }

  async function abortDuck(): Promise<void> {
    cancelDuck?.()
    await ducking
  }

  function pickContext(
    target: MusicTarget,
    activeSession: Session,
    currentId?: string
  ): PickContext {
    return {
      now: now(),
      activity:
        (situation === null || situation === 'focused' || situation === 'good') &&
        (target === 'steady' || target === 'lift' || target === 'let-it-ride')
          ? activeSession.config.activity
          : undefined,
      rng,
      currentId,
      played,
      currentEnergy: keptEnergy,
      steadyEnergy: steadyEnergy(library.songs()),
      playlistNames: new Map(library.playlists().map((p) => [p.uri, p.name ?? '']))
    }
  }

  /** The user's playlists; with none, the target's editorial playlists (read at start or on change). */
  function candidates(target: MusicTarget): string[] {
    const mine = library.playlists().map((p) => p.uri)
    return mine.length ? mine : FALLBACK_PLAYLISTS[target].map((url) => parsePlaylistUrl(url)!.uri)
  }

  async function readFallback(target: MusicTarget, forSwitch = false): Promise<void> {
    if (!forSwitch && library.playlists().length) return
    for (const url of FALLBACK_PLAYLISTS[target]) {
      const parsed = parsePlaylistUrl(url)!
      const prev = fallbackLinks.get(parsed.uri)
      if (prev !== undefined && now() - prev < musicConfig.catalog.refreshMs) continue
      fallbackLinks.set(parsed.uri, now())
      await library.readPlaylist({ ...parsed, addedAt: now() }, now(), 'fallback')
      library.songs().forEach((s) => scorer.enqueue(s))
    }
  }

  const songsIn = (uri: string): Song[] =>
    library
      .songs()
      .filter(
        (s) => s.playlists?.includes(uri) && s.playable !== false && !unavailableSongs.has(s.id)
      )

  /** Unplayed songs in a playlist that fit the target. */
  function fitting(uri: string, target: MusicTarget, ctx: PickContext): Song[] {
    return songsIn(uri).filter(
      (s) =>
        s.id !== ctx.currentId &&
        !played.has(s.id) &&
        !heard.has(songKey(s.title, s.artist)) &&
        fitsNow(s, target, ctx)
    )
  }

  /** On switches unused playlists lead; then prefer scored fits and the largest fitting pool. */
  function bestPlaylist(
    target: MusicTarget,
    ctx: PickContext,
    exclude?: string,
    uris = candidates(target)
  ): { uri: string; song: Song | null; fits: number } | null {
    let best: {
      uri: string
      song: Song | null
      fits: number
      scored: number
      unused: boolean
    } | null = null
    for (const uri of uris) {
      if (uri === exclude) continue
      const fits = fitting(uri, target, ctx)
      const scored = fits.filter((s) => s.scores).length
      const unused = !!exclude && fits.length > 0 && !usedContexts.has(uri)
      if (
        best &&
        ((best.unused && !unused) ||
          (best.unused === unused &&
            (scored < best.scored || (scored === best.scored && fits.length <= best.fits))))
      )
        continue
      best = {
        uri,
        fits: fits.length,
        scored,
        unused,
        song: pickSong(fits.length ? fits : songsIn(uri), target, ctx)
      }
    }
    return best
  }

  const editorialUris = (target: MusicTarget): string[] =>
    FALLBACK_PLAYLISTS[target].map((url) => parsePlaylistUrl(url)!.uri)

  function canSwitchPlaylist(target: MusicTarget, ctx: PickContext): boolean {
    return (
      !!bestPlaylist(target, ctx, contextUri)?.fits ||
      (library.playlists().length !== 1 && editorialUris(target).some((uri) => uri !== contextUri))
    )
  }

  /** Does the playlist we're in still have a fitting unplayed song? Unknown context: assume yes. */
  function contextHasFit(target: MusicTarget, ctx: PickContext): boolean {
    if (!contextUri || !songsIn(contextUri).length) return true
    return fitting(contextUri, target, ctx).length > 0
  }

  /** Session start or availability: remember shuffle/repeat, shuffle on, start the best playlist. */
  async function startPlaylist(): Promise<void> {
    const target = tracker.current()
    if (!canSteer() || !target || switching === generation) return
    const activeSession = session!
    const g = generation
    const running = await controller.isAvailable().catch(() => false)
    if (g !== generation || session !== activeSession || !canSteer()) return
    observeAvailability(running)
    if (!running) return
    await readFallback(target)
    if (g !== generation || session !== activeSession) return
    if (controller.playMode && controller.setPlayMode) {
      savedMode ??= await controller.playMode().catch(() => null)
      if (savedMode && g === generation)
        await controller.setPlayMode({ ...savedMode, shuffle: true }).catch(() => {})
    }
    await switchPlaylist(target, true)
  }

  /**
   * The only `play track` during a session, so the only Spotify pop-up (the controller puts the
   * user's app back). Rate-limited except at start; own fits lead, then the target's editorial list.
   */
  async function switchPlaylist(
    target: MusicTarget,
    start: boolean,
    reason = 'mood needs'
  ): Promise<boolean> {
    const activeSession = session
    const g = generation
    if (!activeSession || switching === g) return false
    if (!start && now() - lastSwitchAt < musicConfig.steering.switchGapMs) {
      decision('switch blocked', 'gap')
      return false
    }
    switching = g
    try {
      for (;;) {
        let ctx = pickContext(target, activeSession, nowPlaying?.id)
        let best = bestPlaylist(target, ctx, start ? undefined : contextUri)
        let switchReason = start ? 'start' : reason
        if (!start && !best?.fits) {
          // One user playlist: stay rather than flash Spotify just for variety.
          if (library.playlists().length === 1) {
            decision('switch blocked', 'single playlist')
            return false
          }
          await readFallback(target, true)
          if (g !== generation || session !== activeSession || !canSteer()) return false
          ctx = pickContext(target, activeSession, nowPlaying?.id)
          best = bestPlaylist(target, ctx, contextUri, editorialUris(target))
          switchReason = 'editorial fallback'
        }
        if (!best) {
          decision('switch blocked', 'no fitting playlist')
          return false
        }
        const uri = best.song?.id ?? best.uri
        const context = best.song ? best.uri : undefined
        const previous = nowPlaying ?? (await controller.current().catch(() => null))
        if (!previous) {
          // Decision 58: a freshly opened player needs a moment before it accepts a play.
          const ready = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(true), musicConfig.controller.readyWaitMs)
            cancelReadyWait = () => {
              clearTimeout(timer)
              resolve(false)
            }
          })
          cancelReadyWait = null
          if (!ready) return false
        }
        if (g !== generation || session !== activeSession || !canSteer()) return false
        cancelPendingPlay()
        pendingPick = {
          id: best.song && process.platform !== 'win32' ? best.song.id : undefined,
          uri,
          contextUri: context,
          previousId: previous?.id,
          attempts: 1
        }
        if (play) play.endedByApp = true
        lastSwitchAt = now()
        const from = playlistName(contextUri)
        contextUri = best.uri
        contextSongs = 0
        usedContexts.add(best.uri)
        emitStatus()
        try {
          await playVerified(uri, context)
        } catch (error) {
          if (g !== generation || session !== activeSession) return false
          cancelPendingPlay()
          decision('switch blocked', 'play command failed')
          if (!best.song) throw error
          // Spotify can reject an exact track; try the next best one right away.
          unavailableSongs.add(best.song.id)
          continue
        }
        if (g !== generation || session !== activeSession) return false
        decision('switch', switchReason, from, playlistName(best.uri))
        if (best.song) played.set(best.song.id, now())
        return true
      }
    } finally {
      if (switching === g) switching = -1
    }
  }

  async function verifyPick(g: number): Promise<void> {
    verifyTimer = null
    const pending = pendingPick
    const actual = await controller.current().catch(() => null)
    if (!pending || pendingPick !== pending || g !== generation || !canSteer()) return
    const id = actual && library.resolve(actual).id
    // A different new track belongs to the user, even if they left it paused.
    if (id && pending.id && id !== pending.id && id !== pending.previousId) {
      cancelPendingPlay()
      return
    }
    if (actual?.isAd || actual?.state === 'playing') {
      cancelPendingPlay()
      if (!pending.id || id === pending.id || actual.isAd) return
      // Spotify can reject an exact pick; avoid retrying that track for the rest of this session.
      unavailableSongs.add(pending.id)
      played.delete(pending.id)
      const target = tracker.current()
      if (target) await switchPlaylist(target, true)
      return
    }
    if (pending.attempts >= musicConfig.controller.maxPlayAttempts) {
      cancelPendingPlay()
      return
    }
    const running = await controller.isAvailable().catch(() => false)
    if (pendingPick !== pending || g !== generation) return
    if (!running) return observeAvailability(false)
    pending.attempts++
    // A failed reply can still have started playback; check again before another attempt.
    await playVerified(pending.uri, pending.contextUri).catch(() => {
      if (pendingPick === pending && g === generation)
        verifyTimer = setTimeout(() => safe(verifyPick(g)), musicConfig.controller.playVerifyMs)
    })
  }

  /** Library title when known, so Spotify's spelling and the playlist's agree. */
  function trackKey(t: NowPlaying): string {
    const s = library.get(t.id)
    return songKey(s?.title ?? t.name, s?.artist ?? t.artist)
  }

  /** The song playing now, if Ovra may judge it (ads and pauses are left alone). */
  async function playingTrack(): Promise<NowPlaying | null> {
    const t = await controller.current().catch(() => null)
    const resolved = t && library.resolve(t)
    return resolved && resolved.id !== skippedId && !resolved.isAd && resolved.state === 'playing'
      ? resolved
      : null
  }

  function decide(
    t: NowPlaying,
    target: MusicTarget,
    activeSession: Session,
    skips: number
  ): 'keep' | 'skip' | 'switch' {
    if (judgedId === t.id) return 'keep'
    judgedId = t.id
    const ctx = pickContext(target, activeSession, t.id)
    const song = library.get(t.id)
    if (!heard.has(trackKey(t)) && fitsNow(song, target, ctx)) {
      const e = song && effective(song)
      if (e) keptEnergy = e.energy
      decision('keep', 'fits target')
      return 'keep'
    }
    const reason = heard.has(trackKey(t))
      ? 'already heard'
      : `doesn't fit ${musicConfig.targetLabels[target]}`
    if (skips < musicConfig.steering.maxSkips && contextHasFit(target, ctx)) {
      decision('skip', reason)
      return 'skip'
    }
    const canSwitch =
      now() - lastSwitchAt >= musicConfig.steering.switchGapMs && canSwitchPlaylist(target, ctx)
    // Nothing better is reachable without a pop-up: the song may stay.
    if (!canSwitch) {
      decision(
        'switch blocked',
        now() - lastSwitchAt < musicConfig.steering.switchGapMs
          ? 'gap'
          : library.playlists().length === 1
            ? 'single playlist'
            : 'no fitting playlist'
      )
      decision('keep', 'no reachable alternative')
    }
    return canSwitch ? 'switch' : 'keep'
  }

  /** After `next track`: the new song, or null for an ad, a pause or a refused skip. */
  async function nextTrack(previousId: string, alive: () => boolean): Promise<NowPlaying | null> {
    const { skipWaitMs, skipPollMs } = musicConfig.steering
    for (let waited = 0; waited < skipWaitMs && alive(); waited += skipPollMs) {
      await new Promise((r) => setTimeout(r, skipPollMs))
      const raw = await controller.current().catch(() => null)
      if (!alive()) return null
      if (raw && library.resolve(raw).id !== previousId)
        return raw.isAd || raw.state !== 'playing' ? null : library.resolve(raw)
    }
    if (alive()) refused()
    return null
  }

  function refused(): void {
    decision('keep', 'Spotify did not skip')
    if (refusedLogged) return
    refusedLogged = true
    // Spotify Free can refuse skips; keep the current song.
    console.warn('[music] Spotify did not skip; keeping the current song')
  }

  async function skipChain(
    first: NowPlaying,
    firstAction: 'skip' | 'switch',
    target: MusicTarget,
    activeSession: Session,
    alive: () => boolean
  ): Promise<void> {
    let t: NowPlaying | null = first
    for (let skips = 0; t && alive(); skips++) {
      const action = skips === 0 ? firstAction : decide(t, target, activeSession, skips)
      if (action === 'keep') return
      if (action === 'switch') {
        await switchPlaylist(target, false)
        return
      }
      appSkipped.add(t.id)
      skippedId = t.id
      heard.add(trackKey(t))
      try {
        await controller.next()
      } catch {
        return refused()
      }
      t = await nextTrack(t.id, alive)
    }
  }

  /** Runs on every new song and on target changes that should be heard now. One chain at a time. */
  function steer(atSongChange = false): Promise<void> {
    songChanged ||= atSongChange
    if (steering) {
      steerAgain = true
      return steering
    }
    const run = async (): Promise<void> => {
      do {
        steerAgain = false
        const checkVariety = songChanged
        songChanged = false
        const target = tracker.current()
        const activeSession = session
        const g = generation
        if (!activeSession || !target || !canSteer() || pendingPick || switching === g) return
        const t = await playingTrack()
        if (!t || g !== generation || !canSteer() || pendingPick) return
        const count = deps.targetGap?.switchAfterSongs ?? musicConfig.steering.switchAfterSongs
        if (
          checkVariety &&
          contextSongs >= count[activeSession.config.activity] &&
          (await switchPlaylist(target, false, 'song count'))
        )
          continue
        const action = decide(t, target, activeSession, 0)
        if (action === 'keep') continue
        await withVolumeDown(target === 'settle' ? QUIET : DUCK, activeSession, g, (alive) =>
          skipChain(t, action, target, activeSession, alive)
        )
      } while (steerAgain)
    }
    steering = run()
      .catch(() => {})
      .finally(() => {
        steering = null
      })
    return steering
  }

  function evaluate(): void {
    if (!session || privacy.get().music !== 'spotify' || leaveAlone) return
    const desired = desiredTarget(
      { situation, activity: session.config.activity, remainingSec },
      deps.targetGap
    )
    const previous = tracker.current()
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
    if (previous !== null) safe(readFallback(changed))
    // Normal sessions judge the next song; Quiet and demo changes are heard right away.
    if (previous !== null && (changed === 'settle' || deps.targetGap?.switchNow)) safe(steer())
  }

  /** Learning: judge the song that just stopped playing. */
  function finishPlay(atSongChange = false): void {
    const p = play
    play = null
    const song = p && library.get(p.songId)
    if (!p || !song) return
    // Delete first so the set never keeps an old entry.
    const endedByApp = appSkipped.delete(p.songId) || p.endedByApp
    const outcome = judgePlay({ ...p, endedByApp, listenedMs: now() - p.startedAt })
    const listenedMs = p.listenedMs + (p.playingSince === null ? 0 : now() - p.playingSince)
    // shortcut: skips in the last poll look complete; use an end reason if a controller gains one.
    if (
      atSongChange &&
      p.contextUri === contextUri &&
      contextUri &&
      !endedByApp &&
      p.durationMs > 0 &&
      listenedMs >= Math.min(p.durationMs, musicConfig.learning.quickSkipMs) &&
      listenedMs + musicConfig.controller.pollMs >= p.durationMs
    ) {
      contextSongs++
      decision('playlist', 'song completed')
      emitStatus()
    }
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
    if (t.id === skippedId) return
    if (
      pendingPick &&
      (t.isAd ||
        (t.state === 'playing' && (!pendingPick.id || t.id === pendingPick.id)) ||
        (pendingPick.id && t.id !== pendingPick.id && t.id !== pendingPick.previousId))
    )
      cancelPendingPlay()
    const prev = nowPlaying
    const listenedMs = play
      ? play.listenedMs + (play.playingSince === null ? 0 : now() - play.playingSince)
      : 0
    const restarted =
      prev?.id === t.id &&
      prev.state === 'playing' &&
      t.state === 'playing' &&
      !!play &&
      t.positionMs + musicConfig.controller.restartSlackMs < play.startPositionMs + listenedMs
    if (restarted) judgedId = null
    nowPlaying = t
    observeAvailability(true)
    if (prev?.id === t.id && !restarted) {
      if (play) {
        if (play.playingSince !== null) play.listenedMs += now() - play.playingSince
        play.playingSince = t.state === 'playing' ? now() : null
      }
      return emitStatus()
    }
    if (prev && !prev.isAd && prev.id !== t.id) heard.add(trackKey(prev))
    finishPlay(true)
    bus.emit('music:track-changed', t)
    if (!t.isAd && t.id.startsWith('spotify:track:')) {
      played.set(t.id, now())
      play = {
        songId: t.id,
        startedAt: now(),
        before: situation,
        during: [],
        endedByApp: false,
        contextUri,
        durationMs: t.durationMs,
        listenedMs: 0,
        playingSince: t.state === 'playing' ? now() : null,
        startPositionMs: t.positionMs
      }
    }
    safe(
      library.learn(t, now()).then((song) => {
        if (g !== generation) return
        if (song) scorer.enqueue(song)
        emitStatus()
      })
    )
    safe(steer(true))
  }

  async function stopInternal(): Promise<void> {
    generation++
    cancelPendingPlay()
    await abortDuck()
    finishPlay()
    stopPolling?.()
    stopPolling = null
    const mode = savedMode
    savedMode = null
    // Give back the user's shuffle/repeat, unless they turned shuffle off themselves (they took over).
    if (mode && session && controller.playMode && controller.setPlayMode) {
      const current = await controller.playMode().catch(() => null)
      if (current?.shuffle) await controller.setPlayMode(mode).catch(() => {})
    }
    session = null
    contextUri = undefined
    contextSongs = 0
    nowPlaying = null
    judgedId = skippedId = null
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
    cancelPendingPlay()
    safe(abortDuck())
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
    switchNow: startPlaylist,
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
      if (value) {
        cancelPendingPlay()
        safe(abortDuck())
      }
      safe(privacy.setSettings({ leaveMusicAlone: value }))
      if (!value) {
        evaluate()
        safe(nowPlaying ? steer() : startPlaylist())
      }
      emitStatus()
    },
    async clearLibrary() {
      await ready
      scorer.reset()
      fallbackLinks.clear()
      unavailableSongs.clear()
      cancelPendingPlay()
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
      heard.clear()
      appSkipped.clear()
      contextUri = undefined
      contextSongs = 0
      usedContexts.clear()
      songChanged = false
      lastSwitchAt = -Infinity
      keptEnergy = undefined
      refusedLogged = false
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
      // Ovra's main window is in front at start (calibration), so this one pop-up lands on Ovra.
      if (running && !leaveAlone) await startPlaylist().catch(() => {})
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
