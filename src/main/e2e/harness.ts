import assert from 'node:assert/strict'
import { basename, isAbsolute, join } from 'node:path'
import { access } from 'node:fs/promises'
import { app } from 'electron'
import type {
  BusEventName,
  IpcInvoke,
  IpcInvokeChannel,
  Nudge,
  SensingPhase,
  Situation
} from '@shared/types'
import { startApp } from '../app'
import { onCapture } from '../ipc'
import { testMediaDir } from '../paths'
import { sessionRecordSchema } from '../privacy/schemas'
import { e2eConfig as cfg, e2eMoves } from './config'
import { scanUserData } from './scan'

export async function runHarness(): Promise<void> {
  const mode = process.env.OVRA_E2E_MODE ?? 'checkins'
  assert(['checkins', 'continuous', 'declined'].includes(mode), 'Unknown e2e mode')
  const video = process.env.OVRA_DEV_VIDEO ?? join(testMediaDir(), 'calm-working.mp4')
  assert(isAbsolute(video), 'Video must be an absolute path')
  await access(video)
  const deadline = setTimeout(() => {
    console.error('[e2e] FAIL deadline')
    app.exit(1)
  }, cfg.deadlineMs)
  const camera = mode !== 'declined'
  const continuous = mode === 'continuous'
  const application = await startApp({
    background: true,
    sensingConfig: {
      calibrationMs: basename(video).startsWith('leave-and-return')
        ? cfg.awayCalibrationMs
        : cfg.calibrationMs,
      checkinMs: cfg.checkinMs,
      checkinIntervalMs: cfg.checkinIntervalMs,
      returnCheckMs: cfg.returnCheckMs
    },
    movesConfig: e2eMoves,
    setup: async (privacy) => {
      await privacy.setSettings({
        devVideoSource: video,
        thresholdOverrides: cfg.thresholds,
        nudgeMinIntervalMin: cfg.nudgeIntervalMin
      })
      await privacy.set({
        camera: camera ? 'yes' : 'not-now',
        face: 'vitals-and-face',
        music: 'none',
        aiScoring: false,
        telemetry: false
      })
    }
  })
  const { bus, privacy, sensing, session, windows, music } = application
  const events: { name: BusEventName; phase?: SensingPhase }[] = []
  const phases: string[] = []
  const situations = new Set<Situation>()
  let nudge: Nudge | undefined
  let nudges = 0
  let moves = 0
  let baseline: boolean | undefined
  let metrics = 0
  let steadyPulseSamples = 0
  let capturing = false
  let captureStarts = 0
  let runningCapture = false
  let returnChecks = 0
  const returnResults: string[] = []
  let automaticAway = 0
  let automaticReturns = 0
  let onAutomaticBreak = false
  let fatal: string | undefined
  const watch = <E extends BusEventName>(name: E): void => {
    bus.on(name, (payload) => {
      const phase = 'phase' in payload ? (payload.phase as SensingPhase) : undefined
      events.push({ name, phase })
      if (phase && name === 'sdk:checkin-started') {
        phases.push(phase)
        captureStarts++
      }
    })
  }
  ;(
    [
      'session:started',
      'session:status',
      'state:baseline-ready',
      'sdk:checkin-started',
      'sdk:checkin-ended',
      'break:away',
      'break:returned',
      'break:return-check',
      'session:ended'
    ] as const
  ).forEach(watch)
  bus.on('state:baseline-ready', (r) => {
    baseline = r.ok
  })
  bus.on('state:updated', (s) => {
    if (s.situation) situations.add(s.situation)
  })
  bus.on('move:nudge', (n) => {
    nudge = n
    nudges++
  })
  bus.on('move:completed', () => moves++)
  bus.on('move:card', (view) => {
    nudge = view.kind === 'nudge' ? view.nudge : undefined
  })
  bus.on('break:away', (b) => {
    if (!b.manual) {
      automaticAway++
      onAutomaticBreak = true
    }
  })
  bus.on('break:returned', () => {
    if (onAutomaticBreak) {
      automaticReturns++
      onAutomaticBreak = false
    }
  })
  bus.on('break:return-check', (r) => {
    returnChecks++
    returnResults.push(r.result)
  })
  bus.on('sdk:metrics', (m) => {
    metrics++
    if (m.pulse?.stable) steadyPulseSamples++
    if (!privacy.canUseFace() && m.face) fatal = 'Face metrics after consent revoked'
  })
  bus.on('sdk:error', (e) => {
    fatal = `${e.code}: ${e.message}`
  })
  onCapture('capture:status', (s) => {
    runningCapture = s === 'running'
    if (s === 'starting' || s === 'running' || s === 'stopping') capturing = true
    if (s === 'idle') capturing = false
  })
  const wait = async (
    predicate: () => boolean | Promise<boolean>,
    label: string,
    timeoutMs = cfg.eventTimeoutMs
  ): Promise<void> => {
    const until = Date.now() + timeoutMs
    while (!(await predicate())) {
      assert(!fatal, fatal)
      assert(Date.now() < until, `Timed out: ${label}`)
      await new Promise((resolve) => setTimeout(resolve, cfg.pollMs))
    }
    assert(!fatal, fatal)
  }
  await windows.ready()
  const main = windows.windows()!.main
  const invoke = <C extends IpcInvokeChannel>(
    channel: C,
    req?: IpcInvoke[C]['req']
  ): Promise<IpcInvoke[C]['res']> =>
    main.webContents.executeJavaScript(
      `window.ovra.invoke(${JSON.stringify(channel)}${req === undefined ? '' : ', ' + JSON.stringify(req)})`
    )
  const text = (): Promise<string> => main.webContents.executeJavaScript('document.body.innerText')
  const orb = windows.windows()!.orb
  const orbView = (): Promise<{ listening: boolean; paused: boolean }> =>
    orb.webContents.executeJavaScript('window.__e2eOrb')
  const attachOrb = async (): Promise<void> => {
    await orb.webContents.executeJavaScript(
      "void window.ovra.on('push:orb', v => { window.__e2eOrb = v })"
    )
  }
  let saved = false
  let clean = false
  let stopped = false
  try {
    await wait(() => text().then((t) => /camera/i.test(t)), 'onboarding rendered')
    await invoke('privacy:set', { answeredAt: Date.now() })
    await attachOrb()
    await invoke('session:start', {
      activity: 'deep-work',
      lengthMin: cfg.sessionLengthMin,
      cameraMode: continuous ? 'continuous' : 'checkins',
      checkinIntervalMin: 3,
      music: false
    })
    if (camera) {
      await wait(() => baseline !== undefined, 'baseline')
      // Moving clips may never supply stable pulse; the real app must still reach running.
      assert(metrics > 0, 'Real SDK metrics reached the state engine')
      await wait(() => session.current()?.status === 'running', 'running session')
      if (continuous) {
        await wait(() => automaticAway > 0 && automaticReturns > 0, 'automatic away + return')
        await wait(() => returnChecks > 0, 'automatic return check')
      } else {
        await wait(
          () =>
            events.filter((e) => e.name === 'sdk:checkin-ended' && e.phase === 'checkin').length >=
            2,
          'two check-ins'
        )
        assert.equal(capturing, false, 'Stream stopped between check-ins')
        await wait(
          async () => (await orbView())?.listening === false,
          'orb stops listening between check-ins'
        )
      }
    } else {
      assert.equal(sensing.phase(), 'idle')
      assert.equal(captureStarts, 0, 'No camera code with consent declined')
    }
    await wait(() => !!nudge, 'timed or sensed nudge')
    await invoke('move:respond', { nudgeId: nudge!.id, response: 'go' })
    await wait(() => moves > 0, 'guided move complete')
    // Reload while live to prove the renderer receives a current snapshot after subscribing.
    const reloaded = new Promise<void>((resolve) =>
      orb.webContents.once('did-finish-load', resolve)
    )
    orb.reload()
    await reloaded
    await attachOrb()
    await invoke('camera:pause')
    const startsWhilePaused = captureStarts
    await wait(() => !capturing && sensing.phase() === 'idle', 'pause fully stops capture')
    await wait(async () => (await orbView())?.paused === true, 'reloaded orb paused state')
    assert.equal((await orbView()).listening, false)
    await new Promise((resolve) => setTimeout(resolve, cfg.idleObservationMs))
    assert.equal(captureStarts, startsWhilePaused, 'Nothing captures while paused')
    await invoke('camera:resume')
    await invoke('break:going')
    assert.equal(session.current()?.status, 'on-break')
    if (!continuous) await wait(() => !capturing, 'manual break stops camera')
    const returnedBefore = returnChecks
    await invoke('break:back')
    await wait(() => returnChecks > returnedBefore, 'manual return check')
    if (camera) {
      await wait(
        () => (continuous ? sensing.phase() === 'continuous' : sensing.phase() === 'checkin'),
        'sensing resumes after break'
      )
      // Revocation must take effect during active sensing, including dropping queued face metrics.
      await wait(() => runningCapture, 'resumed capture running')
      await wait(async () => (await orbView())?.listening === true, 'orb listening during capture')
      await invoke('privacy:set', { face: 'vitals-only' })
      await invoke('privacy:set', { camera: 'not-now' })
      await wait(() => !capturing && sensing.phase() === 'idle', 'camera consent revoked')
      assert.equal(session.current()?.sensingEnabled, false)
    }
    await invoke('session:end')
    stopped = !capturing && sensing.phase() === 'idle'
    assert(stopped, 'Camera stopped at session end')
    await wait(async () => (await orbView())?.listening === false, 'orb stops listening at end')
    const records = await invoke('history:list')
    assert.equal(records.length, 1)
    assert(sessionRecordSchema.safeParse(records[0]).success, 'Valid history schema')
    assert.equal(records[0].cameraMode, camera ? (continuous ? 'continuous' : 'checkins') : 'off')
    saved = true
    assert(
      events.findIndex((e) => e.name === 'session:started') <
        events.findIndex((e) => e.name === 'session:ended')
    )
    if (camera) {
      assert.equal(
        events.filter((e) => e.name === 'sdk:checkin-started').length,
        events.filter((e) => e.name === 'sdk:checkin-ended').length
      )
    }
    await wait(() => !session.current(), 'summary')
    await wait(() => text().then((t) => /Session done/.test(t)), 'summary rendered')
    await main.webContents.executeJavaScript("document.querySelector('[data-nav=history]').click()")
    await wait(
      () =>
        main.webContents.executeJavaScript(
          "document.querySelectorAll('.history-row').length === 1"
        ),
      'saved session rendered in history'
    )
    await scanUserData(app.getPath('userData'))
    clean = true
    await music.addPlaylist('https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO')
    // Delete during an active timer-only session: nothing may resurrect after deletion.
    await invoke('session:start', {
      activity: 'admin',
      lengthMin: cfg.sessionLengthMin,
      cameraMode: 'checkins',
      checkinIntervalMin: 3,
      music: false
    })
    await invoke('data:delete-all')
    await wait(() => !session.current(), 'delete cancels active session')
    assert.deepEqual(await music.library(), { songs: [], playlists: [] })
    assert.deepEqual(await privacy.listSessions(), [])
    assert.equal(privacy.get().answeredAt, null)
    await wait(() => !capturing, 'delete stops camera')
    await wait(() => text().then((t) => /camera/i.test(t)), 'onboarding after deletion')
    await scanUserData(app.getPath('userData'))
    if (camera && process.env.OVRA_E2E_QUIT_ACTIVE === '1') {
      await privacy.setSettings({ devVideoSource: video })
      await privacy.set({
        camera: 'yes',
        face: 'vitals-only',
        music: 'none',
        aiScoring: false,
        answeredAt: Date.now()
      })
      await invoke('session:start', {
        activity: 'admin',
        lengthMin: cfg.sessionLengthMin,
        cameraMode: 'checkins',
        checkinIntervalMin: 3,
        music: false
      })
      await wait(() => runningCapture, 'active sensing before quit')
    }
    console.log(
      `[e2e] PASS mode=${mode} video=${basename(video)} phases=${phases.join(',') || 'timer'} baseline=${baseline ?? 'off'} metrics=${metrics} steady-pulse-samples=${steadyPulseSamples} situations=${[...situations].join(',') || 'none'} nudges=${nudges} moves=${moves} manual-return=${returnResults.at(-1) ?? 'missing'} return-results=${returnResults.join(',')} auto=${automaticAway}/${automaticReturns} saved=${saved} raw-scan=${clean} camera-stopped=${stopped} orb=true quit-active=${process.env.OVRA_E2E_QUIT_ACTIVE === '1'} userData=${app.getPath('userData')}`
    )
    clearTimeout(deadline)
    app.quit()
  } catch (err) {
    console.error(
      `[e2e] FAIL mode=${mode} video=${basename(video)} phases=${phases.join(',')} saved=${saved} raw-scan=${clean} camera-stopped=${stopped}: ${err instanceof Error ? err.message : String(err)}`
    )
    clearTimeout(deadline)
    await application.shutdown()
    app.exit(1)
  }
}
