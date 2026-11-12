// Owner: Agent E. Dev-only harness: run with `npm run harness:shell`.
// Real windows + real privacy (temp folder), fake session/music/moves IPC, a scripted bus.
// OVRA_SHOTS=<folder outside the repo> takes a screenshot tour of every screen and orb state, then quits.
// Without it, the orb cycles through every state on a loop.
import { app, type BrowserWindow } from 'electron'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Bus,
  MoodPoint,
  MusicStatus,
  PlaylistLink,
  PrivacyService,
  Session,
  SessionConfig,
  SessionRecord,
  Song,
  StateUpdate
} from '@shared/types'
import { createBus } from '../bus'
import { handle } from '../ipc'
import { createPrivacy, registerPrivacyIpc } from '../privacy'
import { createStorage } from '../storage'
import { createWindows, registerWindowsIpc, type ShellWindows } from '.'

const MIN = 60_000
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Fake data
// ---------------------------------------------------------------------------

const song = (
  n: number,
  title: string,
  artist: string,
  energy: 1 | 2 | 3 | 4 | 5,
  mood: 'dark' | 'neutral' | 'bright',
  vocals: 'instrumental' | 'light' | 'heavy',
  confidence: number,
  source: 'lastfm' | 'llm' | 'rules',
  learned = false
): Song => ({
  id: `spotify:track:fake${n}`,
  title,
  artist,
  scores: { energy, mood, vocals, confidence, source, scoredAt: Date.now() },
  learned: learned
    ? {
        energyDelta: -1,
        confidenceDelta: 0.1,
        settleVotes: 2,
        steadyVotes: 0,
        quickSkips: 0,
        plays: 3,
        updatedAt: Date.now()
      }
    : undefined,
  firstSeenAt: Date.now(),
  playCount: 2
})

const SONGS: Song[] = [
  song(1, 'Weightless', 'Marconi Union', 1, 'neutral', 'instrumental', 0.9, 'llm'),
  song(2, 'Avril 14th', 'Aphex Twin', 2, 'neutral', 'instrumental', 0.85, 'lastfm'),
  song(3, 'Nuvole Bianche', 'Ludovico Einaudi', 3, 'neutral', 'instrumental', 0.8, 'llm', true),
  song(4, 'Intro', 'The xx', 3, 'neutral', 'instrumental', 0.75, 'llm'),
  song(5, 'Midnight City', 'M83', 4, 'bright', 'light', 0.8, 'llm'),
  song(6, 'Electric Feel', 'MGMT', 4, 'bright', 'heavy', 0.7, 'rules'),
  song(7, 'Teardrop', 'Massive Attack', 3, 'dark', 'light', 0.7, 'lastfm'),
  song(8, 'Unknown Demo', 'Local Band', 3, 'neutral', 'light', 0.3, 'rules'),
  {
    id: 'spotify:track:fake9',
    title: 'Fresh Find',
    artist: 'New Artist',
    firstSeenAt: 0,
    playCount: 1
  }
]

const PLAYLISTS: PlaylistLink[] = [
  {
    uri: 'spotify:playlist:fakeA',
    url: 'https://open.spotify.com/playlist/fakeA',
    name: 'Deep focus',
    addedAt: 0
  },
  {
    uri: 'spotify:playlist:fakeB',
    url: 'https://open.spotify.com/playlist/fakeB',
    name: 'Late night coding',
    addedAt: 0
  }
]

function fakeRecord(id: string, startedAt: number, lengthMin: number): SessionRecord {
  const kinds: MoodPoint['situation'][] = [
    'focused',
    'focused',
    'tense',
    'away',
    'focused',
    'good',
    'low'
  ]
  const step = (lengthMin * MIN) / kinds.length
  return {
    id,
    activity: 'deep-work',
    startedAt,
    endedAt: startedAt + lengthMin * MIN,
    lengthMin,
    cameraMode: 'checkins',
    moodTimeline: kinds.map((situation, i) => ({ t: startedAt + i * step, situation })),
    moves: [
      { t: startedAt + 30 * MIN, moveId: 'breathe', outcome: 'done' },
      { t: startedAt + 50 * MIN, moveId: 'neck-stretch', outcome: 'snoozed' },
      { t: startedAt + 70 * MIN, moveId: 'walk', outcome: 'done' }
    ],
    snoozes: 1,
    longestSeatedMin: 52,
    learnedSongIds: ['spotify:track:fake1', 'spotify:track:fake3']
  }
}

// ---------------------------------------------------------------------------
// Fake services behind IPC
// ---------------------------------------------------------------------------

function fakeServices(bus: Bus, privacy: PrivacyService): { session: () => Session | null } {
  let session: Session | null = null
  let ticker: ReturnType<typeof setInterval> | undefined
  let library = { songs: [...SONGS], playlists: [...PLAYLISTS] }
  let music: MusicStatus = {
    available: true,
    leaveAlone: false,
    target: 'steady',
    nowPlaying: null,
    scoringQueue: 12,
    scoredCount: 8
  }
  const setMusic = (patch: Partial<MusicStatus>): MusicStatus => {
    music = { ...music, ...patch }
    bus.emit('music:status', music)
    return music
  }
  const setStatus = (status: Session['status']): void => {
    if (!session) return
    session = { ...session, status }
    bus.emit('session:status', session)
  }

  const start = (config: SessionConfig): Session => {
    session = {
      id: `h${Date.now()}`,
      config,
      startedAt: Date.now(),
      status: 'calibrating',
      sensingEnabled: privacy.canUseCamera()
    }
    bus.emit('session:started', session)
    bus.emit('session:status', session)
    bus.emit('sdk:checkin-started', { phase: 'calibration' })
    let p = 0
    ticker = setInterval(() => {
      if (!session) return
      const elapsedSec = Math.round((Date.now() - session.startedAt) / 1000)
      bus.emit('session:tick', {
        sessionId: session.id,
        elapsedSec,
        remainingSec: config.lengthMin * 60 - elapsedSec
      })
      if (session.status !== 'calibrating') return
      p = Math.min(1, p + 0.1)
      bus.emit('sdk:calibration-progress', {
        progress: p,
        hint: p < 0.4 ? 'Place more of the chest in view.' : null
      })
      setMusic({
        scoringQueue: Math.max(0, music.scoringQueue - 1),
        scoredCount: music.scoredCount + 1
      })
      if (p >= 1) {
        bus.emit('sdk:checkin-ended', { phase: 'calibration' })
        setStatus('running')
      }
    }, 1000)
    return session
  }

  const end = async (): Promise<SessionRecord | null> => {
    if (!session) return null
    clearInterval(ticker)
    const record = fakeRecord(session.id, session.startedAt - 95 * MIN, 95)
    await privacy.saveSession(record)
    setStatus('ended')
    session = null
    bus.emit('session:ended', record)
    return record
  }

  handle('session:start', (c) => start(c))
  handle('session:end', () => end())
  handle('session:current', () => session)
  handle('camera:pause', () => bus.emit('sdk:checkin-ended', { phase: 'checkin' }))
  handle('camera:resume', () => undefined)
  handle('music:status', () => music)
  handle('music:library', () => library)
  handle('music:add-playlist', ({ url }) => {
    const m = /playlist\/([A-Za-z0-9]+)/.exec(url)
    if (!m) throw new Error('not a playlist link')
    const link = {
      uri: `spotify:playlist:${m[1]}`,
      url,
      name: `Playlist ${m[1]}`,
      addedAt: Date.now()
    }
    library = { ...library, playlists: [...library.playlists, link] }
    return link
  })
  handle('music:remove-playlist', ({ uri }) => {
    library = { ...library, playlists: library.playlists.filter((p) => p.uri !== uri) }
  })
  handle('music:set-leave-alone', ({ value }) => void setMusic({ leaveAlone: value }))
  handle('music:clear-library', () => {
    library = { songs: [], playlists: library.playlists }
  })
  handle('music:rescore', () => undefined)
  for (const ch of ['move:end', 'break:going', 'break:back', 'break:breathe-round'] as const) {
    handle(ch, () => undefined)
  }
  handle('move:respond', () => undefined)
  return { session: () => session }
}

// ---------------------------------------------------------------------------
// Orb states
// ---------------------------------------------------------------------------

const state = (situation: StateUpdate['situation']): StateUpdate => ({
  t: Date.now(),
  situation,
  confidence: 0.8,
  seatedMinutes: 34,
  away: false,
  trend: 'steady'
})

/** Each step puts the orb in one state. */
function orbSteps(bus: Bus): { name: string; run: () => void }[] {
  const play = (name: string, artist: string): void =>
    bus.emit('music:track-changed', {
      id: `spotify:track:${name}`,
      uri: `spotify:track:${name}`,
      name,
      artist,
      album: '',
      durationMs: 200_000,
      positionMs: 0,
      state: 'playing',
      isAd: false
    })
  return [
    {
      name: 'calm',
      run: () => {
        bus.emit('state:updated', state('focused'))
        play('Nuvole Bianche', 'Ludovico Einaudi')
        bus.emit('music:target-changed', {
          target: 'steady',
          word: 'Focus',
          reason: 'Keeping the music steady while you focus.'
        })
      }
    },
    {
      name: 'uneasy',
      run: () => {
        bus.emit('state:updated', state('tense'))
        play('Avril 14th', 'Aphex Twin')
        bus.emit('music:target-changed', {
          target: 'ease-down',
          word: 'Calm',
          reason: 'You seem a bit tense. Easing into calmer songs.'
        })
        bus.emit('orb:bubble', { text: 'You seem tense, easing into calmer songs.' })
      }
    },
    { name: 'stormy', run: () => bus.emit('state:updated', state('crashing')) },
    { name: 'dim', run: () => bus.emit('state:updated', state('low')) },
    {
      name: 'bright',
      run: () => {
        bus.emit('state:updated', state('good'))
        play('Midnight City', 'M83')
        bus.emit('music:target-changed', {
          target: 'lift',
          word: 'Boost',
          reason: 'You seem in a good mood. Bringing in brighter songs.'
        })
      }
    },
    {
      name: 'listening',
      run: () => {
        bus.emit('state:updated', state('focused'))
        bus.emit('sdk:checkin-started', { phase: 'checkin' })
        bus.emit('orb:bubble', { text: 'Quick check-in.' })
      }
    },
    {
      name: 'away',
      run: () => {
        bus.emit('sdk:checkin-ended', { phase: 'checkin' })
        bus.emit('break:away', { since: Date.now() - 7 * MIN, manual: true })
        bus.emit('orb:bubble', { text: 'Enjoy the walk.' })
      }
    },
    {
      name: 'breathing',
      run: () => {
        bus.emit('break:returned', { awayMs: 7 * MIN })
        bus.emit('move:step', {
          moveId: 'breathe',
          stepIndex: 0,
          remainingSec: 60,
          step: {
            id: 'breathe-1',
            title: 'Breathe along',
            howTo: 'In as the moon grows, out as it shrinks',
            durationSec: 60,
            animation: 'breathe',
            check: 'breathing-slows'
          }
        })
        bus.emit('orb:bubble', { text: 'Breathe with me.' })
      }
    },
    { name: 'done', run: () => bus.emit('move:completed', { moveId: 'breathe', verified: true }) }
  ]
}

// ---------------------------------------------------------------------------
// Screenshot tour
// ---------------------------------------------------------------------------

async function shot(win: BrowserWindow, dir: string, name: string): Promise<void> {
  await wait(700)
  const img = await win.webContents.capturePage()
  await writeFile(join(dir, `${name}.png`), img.toPNG())
  console.log(`[harness:shell] ${name}.png`)
}

/** Click the first button/label whose text starts with `text`. */
function click(win: BrowserWindow, text: string): Promise<unknown> {
  return win.webContents.executeJavaScript(
    `(() => { const el = [...document.querySelectorAll('button,label,summary')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)})); el?.click(); return !!el })()`
  )
}

const nav = (win: BrowserWindow, page: string): Promise<unknown> =>
  win.webContents.executeJavaScript(`document.querySelector('[data-nav=${page}]')?.click()`)

async function tour(shell: ShellWindows, bus: Bus, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const { main, orb } = shell.windows()!

  await shot(main, dir, '01-onboarding-hello')
  await click(main, 'Let’s start')
  await shot(main, dir, '02-onboarding-camera')
  await click(main, 'Yes')
  await click(main, 'Next')
  await click(main, 'Next')
  await shot(main, dir, '03-onboarding-face')
  await click(main, 'Vitals and face')
  for (let i = 0; i < 4; i++) await click(main, 'Next')
  await shot(main, dir, '04-onboarding-last')
  await click(main, 'Finish')
  await shot(main, dir, '05-session-new')

  await nav(main, 'music')
  await shot(main, dir, '06-music')
  await click(main, 'Calm')
  await shot(main, dir, '07-music-calm')
  await nav(main, 'history')
  await shot(main, dir, '08-history')
  await click(main, 'Deep work')
  await shot(main, dir, '09-history-summary')
  await nav(main, 'privacy')
  await shot(main, dir, '10-privacy')
  await nav(main, 'settings')
  await click(main, 'Advanced')
  await shot(main, dir, '11-settings')

  await nav(main, 'session')
  await click(main, 'Start session')
  await wait(3000)
  await shot(main, dir, '12-calibration')
  await wait(8000) // calibration finishes, orb shows

  for (const [i, step] of orbSteps(bus).entries()) {
    step.run()
    await shot(orb, dir, `${20 + i}-orb-${step.name}`)
  }
  await orb.webContents.executeJavaScript(`document.querySelector('.controls').style.opacity = 1`)
  await shot(orb, dir, '30-orb-controls')

  await shell
    .windows()!
    .orb.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'End session')?.click()`
    )
  await shot(main, dir, '31-session-summary')
  app.quit()
}

export async function runHarness(): Promise<void> {
  const bus = createBus()
  const dataDir = await mkdtemp(join(tmpdir(), 'ovra-shell-harness-'))
  const privacy = await createPrivacy({ storage: createStorage(dataDir), bus })
  registerPrivacyIpc(privacy)
  const now = Date.now()
  await privacy.saveSession(fakeRecord('past-1', now - 26 * 60 * MIN, 120))
  await privacy.saveSession({
    ...fakeRecord('past-2', now - 50 * 60 * MIN, 60),
    activity: 'writing'
  })
  await privacy.saveSession({
    ...fakeRecord('past-3', now - 74 * 60 * MIN, 180),
    activity: 'debugging'
  })
  fakeServices(bus, privacy)

  const shell = createWindows({ bus, privacy })
  registerWindowsIpc(shell)
  shell.bindBus()
  shell.showMain()
  await shell.ready()

  const shots = process.env.OVRA_SHOTS
  if (shots) return void tour(shell, bus, shots).catch((e) => console.error('[harness:shell]', e))

  // Interactive: once a session runs, cycle the orb through every state.
  const steps = orbSteps(bus)
  let i = 0
  setInterval(() => {
    if (!shell.windows()?.orb.isVisible()) return
    steps[i % steps.length].run()
    i++
  }, 4000)
}
