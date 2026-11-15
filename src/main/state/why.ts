// Why line (decision 34) and the monitor's per-window line. Coarse words and time steps only:
// never a vitals value, never stored or sent.
import type { CameraMode, OrbView, Situation } from '@shared/types'
import { streak, type WindowEval } from './classifier'
import type { StateConfig } from './config'

export type Why = NonNullable<OrbView['why']>

/** "20 of 30 s" for holds under a minute, else "1 of 3 min". Whole steps, rounded down. */
function steps(doneMs: number, needMin: number): string {
  const needSec = needMin * 60
  if (needSec < 60) return `${Math.min(needSec, Math.floor(doneMs / 10_000) * 10)} of ${needSec} s`
  return `${Math.min(needMin, Math.floor(doneMs / 60_000))} of ${needMin} min`
}

function hold(
  history: WindowEval[],
  signal: 'tense' | 'low',
  mode: CameraMode,
  checkins: number,
  minutes: number
): { label: string; progress: number } {
  const s = streak(history, signal)
  if (mode === 'checkins')
    return {
      label: `${Math.min(s.count, checkins)} of ${checkins} checks`,
      progress: Math.min(1, s.count / checkins)
    }
  return {
    label: steps(s.duration, minutes),
    progress: Math.min(1, s.duration / (minutes * 60_000))
  }
}

/** What Ovra is reading from the window history. Undefined before the first window. */
export function whyLine(
  history: WindowEval[],
  situation: Situation | null,
  mode: CameraMode,
  cfg: StateConfig
): Why | undefined {
  const last = history[history.length - 1]
  if (!last) return undefined
  if (last.signal === 'noread')
    return {
      text:
        situation === null
          ? 'Lost track of you for a bit · checking again'
          : "Couldn't see you clearly · no change",
      moving: false
    }
  const up = last.signal === 'tense' || !!last.nearTense
  const down = last.signal === 'low' || !!last.nearLow

  if (situation === 'tense' && last.signal === 'tense') {
    const s = streak(history, 'tense')
    return {
      text: `Heart rate higher than when you started · ${steps(s.duration, cfg.crashingTenseMin)}`,
      progress: Math.min(1, s.duration / (cfg.crashingTenseMin * 60_000)),
      moving: true
    }
  }
  if (situation === 'tense' || situation === 'crashing')
    return {
      text: up
        ? 'Heart rate higher than when you started'
        : 'Heart rate higher than when you started · coming back',
      moving: true
    }
  if (situation === 'low')
    return {
      text: down
        ? 'Heart rate lower than when you started'
        : 'Heart rate lower than when you started · coming back',
      moving: true
    }

  if (up && streak(history, 'tense').count > 0) {
    const h = hold(history, 'tense', mode, cfg.tenseHoldCheckins, cfg.tenseHoldMin)
    return {
      text: `Heart rate higher than when you started · ${h.label}`,
      progress: h.progress,
      moving: true
    }
  }
  if (down && streak(history, 'low').count > 0) {
    const h = hold(history, 'low', mode, cfg.lowHoldCheckins, cfg.lowHoldMin)
    return {
      text: `Heart rate lower than when you started · ${h.label}`,
      progress: h.progress,
      moving: true
    }
  }
  if (last.signal === 'unclear')
    return {
      text:
        last.pulseDelta > 0
          ? 'Heart rate a little higher than when you started'
          : 'Heart rate a little lower than when you started',
      moving: true
    }
  return { text: 'Heart rate like when you started', moving: false }
}

/** Monitor line for one window: signal, which rule decided it, flags. No values. */
export function describeWindow(w: WindowEval): string {
  const rule =
    w.signal === 'tense'
      ? w.backed
        ? 'pulse up, backed by HRV or breathing'
        : 'pulse up, pulse only'
      : w.signal === 'low'
        ? 'pulse down (or a softer drop with lots of blinking)'
        : w.signal === 'noread'
          ? 'under the steady-pulse bar, holds paused'
          : w.signal === 'steady'
            ? w.happyMajority
              ? 'near usual, happy most of the window'
              : 'near usual'
            : w.nearTense
              ? 'near the tense bar, hold paused'
              : w.nearLow
                ? 'near the low bar, hold paused'
                : 'between bars'
  return `signal=${w.signal} rule="${rule}"${w.negativeMajority ? ' negative-face' : ''}`
}
