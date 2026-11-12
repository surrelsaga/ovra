// Owner: Agent A. Dev-only harness: run with `npm run harness:sensing`.
// Fake privacy (consent yes) + real bus. Video: OVRA_DEV_VIDEO, else the first file in OVRA_TEST_MEDIA.
// Runs calibration, short check-ins and a return check, then prints a per-phase summary and quits.
// Logs counts only, never vitals values.
import { app } from 'electron'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_PRIVACY,
  DEFAULT_SETTINGS,
  type PrivacyService,
  type SensingPhase
} from '@shared/types'
import { createBus } from '../bus'
import { getKey } from '../env'
import { onCapture } from '../ipc'
import { testMediaDir } from '../paths'
import { createSensing } from '.'
import { harnessConfig } from './config'

interface PhaseSummary {
  phase: SensingPhase
  seconds: number
  metrics: number
  pulse: number
  firstPulseSec: number | null
  faceSeen: number
  rawCodes: number[]
  smoothedCodes: number[]
  progressEvents: number
  errors: string[]
  streamStopped: 'yes' | 'no' | 'unknown'
}

function pickVideo(): string {
  if (process.env.OVRA_DEV_VIDEO) return process.env.OVRA_DEV_VIDEO
  const dir = testMediaDir()
  const file = readdirSync(dir)
    .filter((f) => /\.(mp4|mov|webm)$/i.test(f))
    .sort()[0]
  if (!file) throw new Error(`No video in ${dir}`)
  return join(dir, file)
}

export async function runHarness(): Promise<void> {
  const deadline = setTimeout(() => {
    console.log('[harness] FAILED: deadline reached')
    app.exit(1)
  }, harnessConfig.deadlineMs)

  const video = pickVideo()
  const bus = createBus()
  const privacy = {
    assertCameraConsent: () => {},
    canUseCamera: () => true,
    canUseFace: () => true,
    get: () => ({ ...DEFAULT_PRIVACY, camera: 'yes', face: 'vitals-and-face' }),
    getSettings: () => ({ ...DEFAULT_SETTINGS, devVideoSource: video })
  } as unknown as PrivacyService
  const sensing = createSensing({
    bus,
    privacy,
    getApiKey: () => getKey('PRESAGE_API_KEY'),
    config: harnessConfig.overrides
  })

  const phases: PhaseSummary[] = []
  let cur: PhaseSummary | null = null
  let t0 = 0
  let stopping = false

  bus.on('sdk:checkin-started', ({ phase }) => {
    t0 = Date.now()
    stopping = false
    cur = {
      phase,
      seconds: 0,
      metrics: 0,
      pulse: 0,
      firstPulseSec: null,
      faceSeen: 0,
      rawCodes: [],
      smoothedCodes: [],
      progressEvents: 0,
      errors: [],
      streamStopped: 'unknown'
    }
    phases.push(cur)
    console.log(`[harness] ${phase} started`)
  })
  bus.on('sdk:checkin-ended', ({ phase }) => {
    if (cur) cur.seconds = Math.round((Date.now() - t0) / 1000)
    console.log(`[harness] ${phase} ended, stream stopped: ${cur?.streamStopped}`)
  })
  bus.on('sdk:metrics', (m) => {
    if (!cur) return
    cur.metrics++
    if (m.pulse) {
      cur.pulse++
      cur.firstPulseSec ??= Math.round((Date.now() - t0) / 1000)
    }
    if (m.face?.present) cur.faceSeen++
  })
  bus.on('sdk:validation', (v) => cur?.smoothedCodes.push(v.code))
  bus.on('sdk:calibration-progress', () => cur && cur.progressEvents++)
  bus.on('sdk:error', (e) => {
    cur?.errors.push(`${e.code}: ${e.message}`)
    console.log(`[harness] sdk:error ${e.code}: ${e.message}`)
  })
  onCapture('capture:validation', (v) => cur?.rawCodes.push(v.code))
  onCapture('capture:status', (s) => {
    if (s === 'stopping') stopping = true
    if (s === 'idle' && stopping && cur) cur.streamStopped = 'yes'
  })
  onCapture('capture:error', (e) => {
    if (e.code === 'stop-incomplete' && cur) cur.streamStopped = 'no'
  })

  const ended = (phase: SensingPhase): Promise<void> =>
    new Promise((resolve) => {
      const off = bus.on('sdk:checkin-ended', (p) => {
        if (p.phase !== phase) return
        off()
        resolve()
      })
    })

  console.log(`[harness] video: ${video.split('/').pop()}`)
  let done = ended('calibration')
  await sensing.startCalibration()
  await done

  sensing.startCheckins(5)
  for (let i = 0; i < harnessConfig.checkins; i++) await ended('checkin')
  await sensing.stop()

  done = ended('return-check')
  await sensing.startReturnCheck()
  await done
  await sensing.stop()

  console.log(`[harness] SUMMARY ${video.split('/').pop()}`)
  for (const p of phases) {
    const codes = (a: number[]): string => [...new Set(a)].join(',') || '-'
    console.log(
      `[harness]  ${p.phase.padEnd(12)} ${String(p.seconds).padStart(3)}s` +
        ` metrics=${p.metrics} pulse=${p.pulse > 0 ? 'yes' : 'no'}(${p.pulse}, first ${p.firstPulseSec ?? '-'}s)` +
        ` face=${p.faceSeen} codes=${codes(p.rawCodes)} smoothed=${codes(p.smoothedCodes)}` +
        ` progress=${p.progressEvents} errors=${p.errors.length} streamStopped=${p.streamStopped}`
    )
    for (const e of [...new Set(p.errors)]) console.log(`[harness]    error: ${e}`)
  }
  clearTimeout(deadline)
  app.quit()
}
