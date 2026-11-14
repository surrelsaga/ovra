// No SDK imports, camera, Spotify controller or app storage. All inputs below are synthetic.
import { app } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import {
  DEFAULT_PRIVACY,
  DEFAULT_SETTINGS,
  type CaptureDiagnostics,
  type MovesService,
  type MusicService,
  type PrivacyService,
  type SensingPhase,
  type SensingService
} from '@shared/types'
import { emptyMonitorCounts } from '@shared/diagnostics'
import { createBus } from '../bus'
import { createStateEngine } from '../state'
import { createSessionService } from '../session/service'
import { startMonitor } from '.'
import { monitorHarnessConfig as cfg } from './harness-config'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function runHarness(): Promise<void> {
  const bus = createBus()
  let phase: SensingPhase = 'idle'
  let facePresent = false
  const privacy = {
    get: () => ({ ...DEFAULT_PRIVACY, camera: 'yes', face: 'vitals-and-face', music: 'none' }),
    getSettings: () => DEFAULT_SETTINGS,
    canUseCamera: () => true,
    canUseFace: () => true,
    saveSession: async () => {}
  } as unknown as PrivacyService
  const state = createStateEngine({ bus, privacy })
  const begin = (next: Exclude<SensingPhase, 'idle'>): void => {
    phase = next
    bus.emit('sdk:checkin-started', { phase: next })
    bus.emit('monitor:capture-status', { status: 'running' })
  }
  const sensing: SensingService = {
    startCalibration: async () => begin('calibration'),
    startContinuous: async () => begin('continuous'),
    startCheckins: () => {},
    startReturnCheck: async () => begin('return-check'),
    skipFraming: () => {},
    async stop() {
      const previous = phase
      phase = 'idle'
      if (previous !== 'idle') bus.emit('sdk:checkin-ended', { phase: previous })
      bus.emit('monitor:capture-status', { status: 'idle' })
    },
    pause: async () => {},
    resume: async () => {},
    phase: () => phase
  }
  const music = {
    status: () => ({
      available: false,
      leaveAlone: true,
      target: null,
      nowPlaying: null,
      scoringQueue: 0,
      scoredCount: 0
    }),
    startSession: async () => {},
    stopSession: async () => {}
  } as unknown as MusicService
  const moves = { startSession: () => {}, stopSession: () => {} } as unknown as MovesService
  const session = createSessionService({ bus, privacy, state, sensing, music, moves })
  const win = startMonitor({ bus, state, sensing, music, session })
  assert(win, 'Run this harness with OVRA_MONITOR=1')
  const dir = join(tmpdir(), `ovra-monitor-shots-${Date.now()}`)
  await mkdir(dir)
  const sample = (): void => {
    if (phase === 'idle') return
    for (let i = 0; i < cfg.snapshotsPerSec; i++)
      bus.emit('sdk:metrics', {
        t: Date.now(),
        pulse: { value: cfg.syntheticPulse, stable: facePresent, confidence: cfg.pulseConfidence },
        face: { present: facePresent }
      })
    const diag: CaptureDiagnostics = {
      ...emptyMonitorCounts(),
      t: Date.now(),
      phase,
      processing: 'kRunning',
      validation: {
        t: Date.now(),
        code: facePresent ? 0 : 17,
        hint: facePresent ? 'Ready' : 'Face the camera.'
      },
      payloads: cfg.rawPayloadsPerSec,
      snapshots: cfg.snapshotsPerSec
    }
    diag.pulse = {
      present: cfg.rawPayloadsPerSec,
      stable: facePresent ? cfg.rawPayloadsPerSec : 0,
      confidenceSum: cfg.rawPayloadsPerSec * cfg.pulseConfidence,
      confidenceCount: cfg.rawPayloadsPerSec
    }
    diag.face.object = cfg.rawPayloadsPerSec
    diag.face.landmarks = diag.face.present = facePresent ? cfg.rawPayloadsPerSec : 0
    diag.validationCodes = facePresent ? { 0: cfg.rawPayloadsPerSec } : { 0: 16, 17: 12 }
    bus.emit('monitor:diag', diag)
  }
  let timer: ReturnType<typeof setInterval> | undefined
  try {
    await session.start({
      activity: 'focus',
      lengthMin: cfg.sessionLengthMin,
      cameraMode: 'continuous',
      checkinIntervalMin: 5,
      music: false
    })
    bus.emit('sdk:validation', { t: Date.now(), code: 17, hint: 'Face the camera.' })
    sample()
    timer = setInterval(sample, cfg.sampleMs)
    await wait(cfg.calibrationMs)
    phase = 'idle'
    bus.emit('sdk:checkin-ended', { phase: 'calibration' })
    assert(state.diagnostics().baselineFailure)
    await wait(cfg.awayObserveMs)
    assert(
      state.current().away,
      'The unchanged state engine should become away without a derived face'
    )
    await wait(cfg.settleMs)
    const text = (await win.webContents.executeJavaScript('document.body.innerText')) as string
    assert(
      text.includes('baseline failed') &&
        text.includes('kRunning') &&
        text.includes('100% / 0% / 75')
    )
    const awayShot = join(dir, 'sensing-monitor-away.png')
    await writeFile(awayShot, (await win.webContents.capturePage()).toPNG())
    console.log(`[monitor:harness] screenshot=${awayShot}`)
    facePresent = true
    sample()
    assert(!state.current().away, 'A face-present snapshot should return immediately')
    bus.emit('sdk:validation', { t: Date.now(), code: 0, hint: 'Ready' })
    await wait(cfg.settleMs)
    const returnedShot = join(dir, 'sensing-monitor-returned.png')
    await writeFile(returnedShot, (await win.webContents.capturePage()).toPNG())
    console.log(`[monitor:harness] screenshot=${returnedShot}`)
    console.log(
      '[monitor:harness] passed: baseline failure, raw vs reduced face, away/returned, rolling/phase counters, UI and terminal; music none'
    )
  } finally {
    clearInterval(timer)
    await session.end('quit')
    win.destroy()
    app.quit()
  }
}
