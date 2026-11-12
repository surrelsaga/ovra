// Owner: Agent D. Dev-only harness: run with `npm run harness:moves`.
// Opens the move card, fakes state/metrics events and clicks the card's own buttons to play every move
// end to end with shortened durations. Screenshots go to OVRA_HARNESS_OUT (default: <tmp>/ovra-moves-harness),
// never into the repo. Exits 0 when every check passes.
import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  type BusEventName,
  type MetricsSnapshot,
  type Move,
  type MoveCardView,
  type PrivacyService,
  type Session,
  type StateUpdate
} from '@shared/types'
import { createBus } from '../bus'
import { push } from '../ipc'
import { loadPage, preloadPath } from '../paths'
import { createMoves, registerMovesIpc } from '.'
import { MOVES_CONFIG, type MovesConfig } from './config'

const STEP_SEC = 4
const BREATHE_SEC = 11

/** Every step a few seconds long; the breathing step long enough to see a full in/out cycle. */
function shorten(move: Move): Move {
  const steps = move.steps.map((s) => ({
    ...s,
    durationSec: s.animation === 'breathe' ? BREATHE_SEC : STEP_SEC
  }))
  return { ...move, steps, lengthSec: steps.reduce((a, s) => a + s.durationSec, 0) }
}

function harnessConfig(): MovesConfig {
  const moves = Object.fromEntries(
    Object.entries(MOVES_CONFIG.moves).map(([id, m]) => [id, shorten(m)])
  ) as MovesConfig['moves']
  return {
    ...MOVES_CONFIG,
    moves,
    breatheRound: shorten(MOVES_CONFIG.breatheRound),
    snoozeMin: 2 / 60,
    returnCheck: { durationSec: 3, settleMs: 300, graceSec: 1 },
    resultHideSec: 5
  }
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function runHarness(): Promise<void> {
  const outDir = process.env.OVRA_HARNESS_OUT ?? join(tmpdir(), 'ovra-moves-harness')
  mkdirSync(outDir, { recursive: true })

  const bus = createBus()
  let nudgeMinIntervalMin = 0
  const privacy = {
    canUseCamera: () => true,
    canUseFace: () => true,
    getSettings: () => ({ ...DEFAULT_SETTINGS, nudgeMinIntervalMin })
  } as unknown as PrivacyService
  const moves = createMoves({ bus, privacy }, harnessConfig())
  registerMovesIpc(moves)

  const win = new BrowserWindow({
    width: 340,
    height: 420,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: '#0b0c0f',
    webPreferences: { preload: preloadPath('index') }
  })
  let card: MoveCardView = { kind: 'hidden' }
  bus.on('move:card', (v) => {
    card = v
    push(win, 'push:move-card', v)
  })

  // Event log + counts for the final checks.
  const seen: Partial<Record<BusEventName, unknown[]>> = {}
  const logged: BusEventName[] = [
    'move:nudge',
    'move:started',
    'move:feedback',
    'move:completed',
    'move:snoozed',
    'move:skipped',
    'break:away',
    'break:returned',
    'break:return-check'
  ]
  for (const name of logged)
    bus.on(name, (p) => {
      ;(seen[name] ??= []).push(p)
      console.log(`[moves] ${name} ${JSON.stringify(p)}`)
    })

  await loadPage(win, 'move-card')
  await wait(500)

  let shotN = 0
  const shot = async (name: string): Promise<void> => {
    await wait(350) // let React render and the push land
    const file = join(outDir, `${String(++shotN).padStart(2, '0')}-${name}.png`)
    writeFileSync(file, (await win.webContents.capturePage()).toPNG())
    console.log(`[moves] screenshot ${file}`)
  }
  const click = async (label: string): Promise<void> => {
    const ok = await win.webContents.executeJavaScript(
      `(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`
    )
    if (!ok) throw new Error(`no button "${label}" on card ${card.kind}`)
    await wait(150)
  }
  const state = (p: Partial<StateUpdate>): void =>
    bus.emit('state:updated', {
      t: Date.now(),
      situation: 'focused',
      confidence: 0.8,
      seatedMinutes: 10,
      away: false,
      trend: 'steady',
      ...p
    })
  const metrics = (p: Partial<MetricsSnapshot>): void =>
    bus.emit('sdk:metrics', { t: Date.now(), ...p })
  const waitIdle = async (): Promise<void> => {
    for (let i = 0; i < 200 && card.kind !== 'hidden'; i++) await wait(100)
    if (card.kind !== 'hidden') throw new Error(`card stuck on ${card.kind}`)
  }
  const expectCard = (kind: MoveCardView['kind']): void => {
    if (card.kind !== kind) throw new Error(`expected card ${kind}, got ${card.kind}`)
  }

  const session: Session = {
    id: 'harness',
    config: {
      activity: 'deep-work',
      lengthMin: 60,
      cameraMode: 'continuous',
      checkinIntervalMin: 5,
      music: false
    },
    startedAt: Date.now(),
    status: 'running',
    sensingEnabled: true
  }
  moves.startSession(session)

  // 1. Breathe along: nudge → snooze → re-nudge → go, with breathing slowing down.
  state({ situation: 'tense' })
  expectCard('nudge')
  await shot('nudge-breathe')
  await click('5 more min')
  expectCard('hidden')
  await wait(2300)
  expectCard('nudge')
  await shot('renudge-after-snooze')
  await click("Let's go")
  await shot('breathe-settle')
  await wait(STEP_SEC * 1000)
  for (const value of [15, 15, 15, 13, 12, 11]) {
    metrics({ breathing: { value, confidence: 90, stable: true } })
    await wait(300)
  }
  await shot('breathe-with-feedback')
  await wait(2500)
  await shot('breathe-other-half')
  await waitIdle()

  // 2. Neck and shoulder stretch: seated 45+, head tilts verified.
  state({ seatedMinutes: 50 })
  await shot('nudge-neck')
  await click("Let's go")
  for (const roll of [-30, -32, -35, -33]) metrics({ face: { present: true, headRollDeg: roll } })
  await shot('neck-left-tilt-seen')
  await wait(STEP_SEC * 1000)
  for (const roll of [31, 34, 36, 33]) metrics({ face: { present: true, headRollDeg: roll } })
  await shot('neck-right-tilt-seen')
  await wait(STEP_SEC * 1000)
  await shot('neck-shoulder-rolls')
  await wait(STEP_SEC * 1000)
  await shot('neck-look-up')
  await waitIdle()

  // 3. Stand and stretch: low energy, face rises when standing.
  metrics({ face: { present: true, center: { x: 0.5, y: 0.55 }, size: 0.3 } })
  state({ situation: 'low' })
  await click("Let's go")
  await shot('stand-up')
  metrics({ face: { present: true, center: { x: 0.5, y: 0.3 }, size: 0.27 } })
  await shot('stand-up-seen')
  await wait(STEP_SEC * 1000)
  await shot('stand-reach-up')
  await wait(STEP_SEC * 1000)
  await shot('stand-side-bend')
  await wait(STEP_SEC * 1000)
  await shot('stand-fold')
  await waitIdle()

  // 4. Walk: crashing → manual break → back → return check still tense → 1 min breathing round.
  state({ situation: 'crashing' })
  await shot('nudge-walk')
  await click("Let's go")
  await wait(STEP_SEC * 1000 + 200)
  await shot('walk-ready-to-go')
  await click('Okay, going')
  await wait(2200)
  await shot('away-manual')
  await click("I'm back")
  await wait(1200)
  await shot('return-check')
  state({ situation: 'tense' })
  bus.emit('sdk:checkin-ended', { phase: 'return-check' })
  await wait(500)
  expectCard('return-result')
  await shot('return-still-tense')
  await click('Breathe for 1 min')
  await wait(1500)
  await shot('breathe-round')
  await waitIdle()

  // 5. Step outside: tense for 15+ min → continuous-mode away and back → calmer.
  nudgeMinIntervalMin = 999 // seed the tense run without a nudge
  state({ situation: 'focused' })
  state({ situation: 'tense', t: Date.now() - 16 * 60_000 })
  nudgeMinIntervalMin = 0
  state({ situation: 'tense' })
  await shot('nudge-step-outside')
  await click("Let's go")
  await wait(STEP_SEC * 1000 + 200)
  await shot('outside-ready-to-go')
  state({ situation: 'tense', away: true })
  await wait(1500)
  await shot('away-auto')
  state({ situation: 'focused', away: false })
  await wait(400)
  state({ situation: 'focused' })
  bus.emit('sdk:checkin-ended', { phase: 'return-check' })
  await wait(500)
  expectCard('return-result')
  await shot('return-calmer')
  await click('Done')

  // 6. Skip, and a return check with no fresh data → unknown.
  state({ seatedMinutes: 46 })
  await click('Skip')
  expectCard('hidden')
  moves.goingAway()
  moves.back()
  await wait(4300)
  expectCard('return-result')
  await shot('return-unknown')
  moves.stopSession()

  // Checks.
  const completed = (seen['move:completed'] ?? []) as { moveId: string; verified: boolean }[]
  const ids = new Set(completed.map((c) => c.moveId))
  const failures = [
    ...['breathe', 'neck-stretch', 'stand-stretch', 'walk', 'step-outside'].filter(
      (id) => !ids.has(id)
    ),
    ...(['move:snoozed', 'move:skipped', 'move:feedback', 'break:away', 'break:returned'] as const)
      .filter((e) => !seen[e]?.length)
      .map((e) => `no ${e}`)
  ]
  const results = (seen['break:return-check'] ?? []) as { result: string }[]
  for (const r of ['still-tense', 'calmer', 'unknown'])
    if (!results.some((x) => x.result === r)) failures.push(`no return result ${r}`)
  console.log(`[moves] completed: ${JSON.stringify(completed)}`)
  console.log(
    `[moves] feedback: ${seen['move:feedback']?.length ?? 0}, screenshots: ${shotN} in ${outDir}`
  )
  console.log(
    failures.length ? `[moves] HARNESS FAILED: ${failures.join(', ')}` : '[moves] HARNESS OK'
  )
  if (!process.env.OVRA_HARNESS_KEEP) app.exit(failures.length ? 1 : 0)
}
