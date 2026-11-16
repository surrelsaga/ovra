import type { MonitorMetricSummary, MonitorSnapshot } from '@shared/types'
import { rate } from './aggregate'

function summary(s: MonitorMetricSummary): string {
  const signal = (key: 'pulse' | 'breathing' | 'hrv'): string =>
    `${rate(s[key].present, s.payloads)}/${rate(s[key].stable, s.payloads)}/${s[key].confidence?.toFixed(0) ?? '-'}`
  const perSec = (n: number): string => (s.durationSec ? (n / s.durationSec).toFixed(1) : '0.0')
  return `seconds=${s.durationSec.toFixed(1)} raw/s=${perSec(s.payloads)} sent/s=${perSec(s.snapshots)} pulse=${signal('pulse')} breath=${signal('breathing')} hrv=${signal('hrv')} face=${Object.values(
    s.face
  )
    .map((n) => rate(n, s.payloads))
    .join('/')} codes=${JSON.stringify(s.validationCodes)}`
}

/** A single pasteable line containing the same fields as the monitor window. */
export function formatMonitor(s: MonitorSnapshot): string {
  const st = s.state
  const change = s.session.lastChange
  return `[monitor] t=${new Date(s.t).toISOString()} phase=${s.phase} sdk=${s.processing} capture=${s.capture} validation=${s.validation?.code ?? '-'} hint=${JSON.stringify(s.validation?.hint ?? '')} last10{${summary(s.recent)}} phaseTotal{${summary(s.phaseMetrics)}} calibration=${st.pulseCount}/${st.pulseNeeded}@${st.pulseSpanSec.toFixed(1)}/${st.pulseSpanNeededSec}s baseline=${st.baseline} fail=${JSON.stringify(st.baselineFailure)} lastFace=${st.secondsSinceFace?.toFixed(1) ?? '-'}s awayIn=${st.awayCountdownSec?.toFixed(1) ?? '-'}/${st.awayNoFaceSec}s away=${st.away} situation=${st.situation ?? 'unknown'} confidence=${Math.round(st.confidence * 100)}% seated=${st.seatedMinutes.toFixed(1)}m updated=${st.lastUpdated ? new Date(st.lastUpdated).toISOString() : '-'} session=${s.session.status ?? '-'} remaining=${s.session.remainingSec ?? '-'}s change=${JSON.stringify(change)} music=${s.music.available} track=${JSON.stringify(s.music.name)} artist=${JSON.stringify(s.music.artist)} target=${s.music.target ?? '-'} leave=${s.music.leaveAlone} playlist=${JSON.stringify(s.music.playlist?.name || s.music.playlist?.uri || null)} played=${s.music.playlist?.played ?? 0}`
}
