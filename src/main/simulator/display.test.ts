import { describe, expect, it } from 'vitest'
import type { StateUpdate } from '@shared/types'
import { MUSIC_TARGET_LABEL } from '../../renderer/orb/config'
import { SITUATION_LABEL } from '../../renderer/ui/timeline'
import { stateConfig, resolveConfig } from '../state/config'
import { MOVES_CONFIG } from '../moves/config'
import { countdown, MOOD_LABEL, SCENARIO_LABEL, MUSIC_LABEL } from './display'
import { simConfig, simulatorMovesConfig } from './config'

const steady: StateUpdate = {
  t: 0,
  situation: 'focused',
  confidence: 1,
  seatedMinutes: 0,
  away: false,
  trend: 'steady'
}
const cfg = resolveConfig(simConfig.instant.thresholds)

describe('simulator display and pace', () => {
  it('uses the current app mood labels without changing identifiers', () => {
    expect(MUSIC_LABEL).toEqual(MUSIC_TARGET_LABEL)
    expect(SCENARIO_LABEL).toEqual({
      calm: 'Steady',
      good: 'Good mood',
      tense: 'Stressed',
      crashing: 'Very stressed',
      low: 'Tired',
      away: 'Away'
    })
    for (const [id, label] of Object.entries(MOOD_LABEL)) expect(SITUATION_LABEL[id]).toBe(label)
  })

  it('counts from engine hold progress, including escalation and tired holds', () => {
    const up = { text: 'Heart rate higher than when you started', moving: true, progress: 0.2 }
    expect(countdown(steady, up, 'continuous', cfg)).toBe('Stressed in ~4 s')
    expect(
      countdown(
        steady,
        { ...up, text: 'Heart rate lower than when you started' },
        'continuous',
        cfg
      )
    ).toBe('Tired in ~4 s')
    expect(countdown({ ...steady, situation: 'tense' }, up, 'continuous', cfg)).toBe(
      'Very stressed in ~24 s'
    )
    expect(
      countdown(steady, { ...up, text: "Couldn't see you · away in 4 s" }, 'continuous', cfg)
    ).toBe("Couldn't see you · away in 4 s")
  })

  it('does not promise seconds during check-in gaps or low-signal holds', () => {
    expect(
      countdown(steady, { text: 'No change', moving: false }, 'continuous', cfg)
    ).toBeUndefined()
    expect(countdown(steady, undefined, 'continuous', cfg)).toBeUndefined()
    expect(
      countdown(
        { ...steady, away: true },
        { text: 'up', moving: true, progress: 0.5 },
        'continuous',
        cfg
      )
    ).toBeUndefined()
    expect(
      countdown(steady, { text: '1 of 2 checks', moving: true, progress: 0.5 }, 'checkins', cfg)
    ).toContain('after qualifying check-ins')
  })

  it('only shortens time bars, leaving the real classification thresholds untouched', () => {
    expect(simConfig.defaultSpeed).toBe('instant')
    for (const speed of ['instant', 'fast'] as const) {
      const c = resolveConfig(simConfig[speed].thresholds)
      for (const key of [
        'tensePulsePct',
        'tenseBackedPulsePct',
        'tenseRmssdDropPct',
        'lowPulsePct',
        'crashingPulsePct'
      ] as const)
        expect(c[key]).toBe(stateConfig[key])
      expect(c.windowMinPulseSec).toBeLessThanOrEqual(c.continuousWindowSec)
    }
    expect(simConfig.profiles.tense.pulse * (1 - simConfig.noise)).toBeGreaterThan(
      1 + stateConfig.tensePulsePct
    )
    expect(simConfig.profiles.low.pulse * (1 + simConfig.noise)).toBeLessThan(
      1 + stateConfig.lowPulsePct
    )
    const moves = simulatorMovesConfig('instant')
    expect(
      moves.moves['neck-stretch'].steps
        .map((s) => s.durationSec)
        .every((s) => s <= simConfig.instant.maxStepSec)
    ).toBe(true)
    expect(MOVES_CONFIG.moves['neck-stretch'].lengthSec).toBeGreaterThan(
      moves.moves['neck-stretch'].lengthSec
    )
  })
})
