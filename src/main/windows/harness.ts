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
import { orbConfig } from '../../renderer/orb/config'
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
    'unknown',
    'focused',
    'good',
    'low'
  ]
  const step = (lengthMin * MIN) / kinds.length
  return {
    id,
    activity: 'focus',
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
      // Shell harness never opens the live camera; preview uses an explicitly supplied dev file.
      sensingEnabled: privacy.canUseCamera() && !!process.env.OVRA_PREVIEW_VIDEO
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
      p = elapsedSec <= 3 ? 0 : Math.min(1, p + 0.2)
      bus.emit('sdk:calibration-progress', {
        progress: p,
        hint: p === 0 ? 'Move up, or tilt the camera down.' : null,
        starting: elapsedSec < 2,
        framing: p === 0
      })
      setMusic({
        scoringQueue: Math.max(0, music.scoringQueue - 1),
        scoredCount: music.scoredCount + 1
      })
      if (p >= 1) {
        bus.emit('sdk:checkin-ended', { phase: 'calibration' })
        // Fake sensing after calibration enables countdowns without ever requesting a preview stream.
        session = { ...session, sensingEnabled: privacy.canUseCamera() }
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
  handle('camera:pause', () => {
    bus.emit('sdk:checkin-ended', { phase: 'checkin' })
    bus.emit('privacy:camera-paused', {})
  })
  handle('camera:resume', () => bus.emit('privacy:camera-resumed', {}))
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
    { name: 'done', run: () => bus.emit('move:completed', { moveId: 'breathe', verified: true }) },
    { name: 'paused', run: () => bus.emit('privacy:camera-paused', {}) },
    { name: 'resumed', run: () => bus.emit('privacy:camera-resumed', {}) }
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

/** Camera indicator frames: moonrise, satellite per mood and backdrop, waxing, fade, paused, reduced motion. */
async function indicatorTour(orb: BrowserWindow, bus: Bus, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const grab = async (name: string): Promise<void> => {
    const img = await orb.webContents.capturePage()
    await writeFile(join(dir, `${name}.png`), img.toPNG())
  }
  const frames = async (name: string, n: number, everyMs: number): Promise<void> => {
    for (let f = 0; f < n; f++) {
      const t0 = Date.now()
      await grab(`${name}-${String(f).padStart(2, '0')}`)
      await wait(Math.max(0, everyMs - (Date.now() - t0)))
    }
  }
  const backdrop = (bg: string): Promise<unknown> =>
    orb.webContents.executeJavaScript(`document.body.style.background = '${bg}'`)
  const off = (): void => bus.emit('sdk:checkin-ended', { phase: 'checkin' })
  bus.emit('break:returned', { awayMs: 0 })
  bus.emit('privacy:camera-resumed', {})
  off()
  await wait(1000)

  // Moonrise during calibration, then waxing at 0 / 0.5 / 1.
  await backdrop('#1e1f24')
  bus.emit('sdk:checkin-started', { phase: 'calibration' })
  await frames('rise', 14, 80)
  for (const p of [0, 0.5, 1]) {
    bus.emit('sdk:calibration-progress', { progress: p, hint: null })
    await wait(300)
    await grab(`wax-${p}`)
  }
  bus.emit('sdk:checkin-ended', { phase: 'calibration' })
  await frames('fade', 10, 80)

  // Satellite in each mood on a dark and a light desktop, plus away (continuous mode).
  bus.emit('sdk:checkin-started', { phase: 'checkin' })
  await wait(1200)
  const moods = [
    ['calm', 'focused'],
    ['uneasy', 'tense'],
    ['stormy', 'crashing'],
    ['dim', 'low'],
    ['bright', 'good']
  ] as const
  for (const [name, situation] of moods) {
    bus.emit('state:updated', state(situation))
    for (const [bg, colour] of [
      ['dark', '#1e1f24'],
      ['light', '#f2f2f2']
    ]) {
      await backdrop(colour)
      await wait(200)
      await frames(`sat-${name}-${bg}`, 4, 110)
    }
  }
  bus.emit('break:away', { since: Date.now() - 3 * MIN, manual: false })
  await frames('sat-away-light', 2, 110)
  bus.emit('break:returned', { awayMs: 3 * MIN })
  bus.emit('state:updated', state('focused'))
  await backdrop('#1e1f24')
  await frames('orbit', 34, 110)

  // Paused: camera stops, satellite fades and stays gone.
  bus.emit('privacy:camera-paused', {})
  await wait(900)
  await grab('paused')
  bus.emit('privacy:camera-resumed', {})

  // Reduced motion: reload with the media feature emulated, then turn the camera on.
  off()
  orb.webContents.debugger.attach()
  await orb.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  orb.webContents.reload()
  await wait(1500)
  await backdrop('#f2f2f2')
  bus.emit('sdk:checkin-started', { phase: 'checkin' })
  await frames('reduced', 3, 400)
  off()
  await wait(300)
  await grab('reduced-off')
  await orb.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
  orb.webContents.debugger.detach()
  orb.webContents.reload()
  await wait(1500)
  await backdrop('')
}

/** Song and camera status, using only fake bus events and isolated harness settings. */
async function pillTour(orb: BrowserWindow, bus: Bus, dir: string): Promise<void> {
  bus.emit('music:track-changed', {
    id: 'spotify:track:bones',
    uri: 'spotify:track:bones',
    name: 'Bones',
    artist: 'Imagine Dragons',
    album: '',
    durationMs: 200_000,
    positionMs: 0,
    state: 'playing',
    isAd: false
  })
  bus.emit('music:target-changed', { target: 'steady', word: 'Focus', reason: '' })
  const hover = async (selector: string, name: string): Promise<void> => {
    const point: { x: number; y: number } = await orb.webContents.executeJavaScript(
      `(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return {x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2)} })()`
    )
    orb.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    await shot(orb, dir, name)
    orb.webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 })
  }
  for (const count of [2, 3, 4]) {
    bus.emit('sdk:checkin-started', { phase: 'checkin' })
    await shot(orb, dir, `pill-${count}-on-note-and-lesson`)
    await wait(orbConfig.cameraNoteMs)
    await shot(orb, dir, `pill-${count}-song-camera-on`)
    if (count === 2) {
      await hover('.orb-app__moon', 'pill-tooltip-moon-on')
      await hover('.camera-dot', 'pill-tooltip-dot-on')
      bus.emit('privacy:camera-paused', {})
      await shot(orb, dir, 'pill-paused-dot-and-badge')
      await hover('.camera-dot', 'pill-tooltip-dot-paused')
      bus.emit('privacy:camera-resumed', {})
    }
    bus.emit('sdk:checkin-ended', { phase: 'checkin' })
    await shot(orb, dir, `pill-${count}-off-note-and-lesson`)
    await wait(orbConfig.cameraNoteMs)
    await shot(orb, dir, `pill-${count}-song-camera-off`)
  }
  await hover('.orb-app__moon', 'pill-tooltip-off-next-check')
  bus.emit('break:away', { since: Date.now() - 3 * MIN, manual: true })
  await shot(orb, dir, 'pill-away')
  bus.emit('break:returned', { awayMs: 3 * MIN })
  // Keep evidence of actual DOM labels alongside the screenshots (no SDK data).
  const labels = await orb.webContents.executeJavaScript(`({
    pill: document.querySelector('.pill')?.getAttribute('aria-label'),
    moon: document.querySelector('.orb-app__moon')?.getAttribute('aria-label'),
    bubble: document.querySelector('.bubble')?.textContent
  })`)
  await writeFile(join(dir, 'pill-labels.json'), JSON.stringify(labels, null, 2))
}

async function tour(shell: ShellWindows, bus: Bus, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const { main, orb } = shell.windows()!

  await shot(main, dir, '01-onboarding-hello')
  await click(main, 'Let’s start')
  await shot(main, dir, '02-onboarding-camera')
  await shot(main, dir, '02-onboarding-camera-moving')
  await click(main, 'Yes')
  await click(main, 'Next')
  await click(main, 'Next')
  await shot(main, dir, '03-onboarding-face')
  await click(main, 'Heart rate, breathing and expressions')
  for (let i = 0; i < 4; i++) await click(main, 'Next')
  await shot(main, dir, '04-onboarding-last')
  await click(main, 'Finish')
  await wait(300)
  await click(main, 'Later')
  await shot(main, dir, '05-session-new')

  await nav(main, 'music')
  await shot(main, dir, '06-music')
  await click(main, 'Calm')
  await shot(main, dir, '07-music-calm')
  await nav(main, 'history')
  await shot(main, dir, '08-history')
  await click(main, 'Focus')
  await shot(main, dir, '09-history-summary')
  await nav(main, 'privacy')
  await shot(main, dir, '10-privacy')
  await nav(main, 'settings')
  await click(main, 'Advanced')
  await shot(main, dir, '11-settings')

  await nav(main, 'session')
  await click(main, 'Start session')
  await shot(main, dir, '12a-calibration-starting')
  await wait(1000)
  await shot(main, dir, '12b-calibration-framing')
  await wait(2000)
  await shot(main, dir, '12c-calibration-steady-pulse')
  await shot(orb, dir, '13-first-camera-on-bubble')
  await wait(8000) // calibration finishes, orb shows
  await shot(orb, dir, '14-first-camera-off-bubble')
  await pillTour(orb, bus, dir)

  for (const [i, step] of orbSteps(bus).entries()) {
    step.run()
    await shot(orb, dir, `${20 + i}-orb-${step.name}`)
    // A few more frames of the animated states (stepped animations swap whole pixels).
    if (['stormy', 'bright', 'listening', 'breathing'].includes(step.name))
      for (const f of [1, 2, 3]) await shot(orb, dir, `${20 + i}-orb-${step.name}-f${f}`)
  }
  await indicatorTour(orb, bus, join(dir, 'indicator'))

  // Click-through: real mouse moves over empty space, then over the moon (the window logs each switch).
  const mouse = (x: number, y: number): void =>
    orb.webContents.sendInputEvent({ type: 'mouseMove', x, y })
  const moonCentre = async (): Promise<[number, number]> =>
    orb.webContents.executeJavaScript(
      `(() => { const r = document.querySelector('.orb-app__moon').getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] })()`
    )
  const hover = async (): Promise<void> => {
    mouse(2, 2)
    await wait(1000)
    mouse(...(await moonCentre()))
  }
  await hover()
  await shot(orb, dir, '40-orb-hover-controls')
  await orb.webContents.executeJavaScript(
    `document.head.insertAdjacentHTML('beforeend', '<style id="hit">[data-hit]{outline:2px dashed #7fd1ae;outline-offset:2px} .orb-app{outline:2px dashed #f08080;outline-offset:-2px}</style>')`
  )
  await shot(orb, dir, '41-orb-hit-areas')
  await orb.webContents.executeJavaScript(`document.getElementById('hit').remove()`)
  // Hover on a dark and a light desktop, with and without the now-playing chip.
  const backdrop = (bg: string): Promise<unknown> =>
    orb.webContents.executeJavaScript(`document.body.style.background = '${bg}'`)
  for (const chip of [true, false]) {
    if (!chip)
      bus.emit('music:track-changed', {
        id: 'spotify:ad:x',
        uri: 'spotify:ad:x',
        name: '',
        artist: '',
        album: '',
        durationMs: 30_000,
        positionMs: 0,
        state: 'playing',
        isAd: true
      })
    for (const [name, bg] of [
      ['dark', '#1e1f24'],
      ['light', '#f2f2f2']
    ]) {
      await backdrop(bg)
      await hover()
      await shot(orb, dir, `42-orb-hover-${chip ? 'chip' : 'nochip'}-${name}`)
    }
  }
  // A mouse click on the moon must not leave a focus ring.
  // A real first click activates the inactive orb window, so start from another window.
  const [cx, cy] = await moonCentre()
  main.focus()
  await wait(300)
  orb.focus()
  orb.webContents.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 })
  orb.webContents.sendInputEvent({ type: 'mouseUp', x: cx, y: cy, button: 'left', clickCount: 1 })
  await shot(orb, dir, '43-orb-after-click-light')
  // The click must not leave keyboard focus on the moon (a later key press would show the ring).
  const focused = await orb.webContents.executeJavaScript(`document.activeElement?.className`)
  console.log(`[harness:shell] focused after click: ${focused || 'nothing'}`)
  await backdrop('')
  mouse(8, 8)
  await wait(1000)

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
  await privacy.setSettings({ devVideoSource: process.env.OVRA_PREVIEW_VIDEO ?? null })
  registerPrivacyIpc(privacy)
  const now = Date.now()
  await privacy.saveSession(fakeRecord('past-1', now - 26 * 60 * MIN, 120))
  await privacy.saveSession({
    ...fakeRecord('past-2', now - 50 * 60 * MIN, 60),
    activity: 'focus'
  })
  await privacy.saveSession({
    ...fakeRecord('past-3', now - 74 * 60 * MIN, 180),
    activity: 'focus'
  })
  fakeServices(bus, privacy)

  const shell = createWindows({ bus, privacy })
  const ignore = shell.orbIgnoreMouse
  shell.orbIgnoreMouse = (value) => {
    console.log(`[harness:shell] orb click-through ${value ? 'on' : 'off'}`)
    ignore(value)
  }
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
