import { describe, expect, it } from 'vitest'
import type { StateUpdate } from '@shared/types'
import { MOVES, MOVES_CONFIG as cfg } from './config'
import {
  canNudge,
  isBreathingSlowing,
  isStoodUp,
  isTilt,
  pickMove,
  returnResult,
  type NudgeInput
} from './logic'

const input = (p: Partial<NudgeInput>): NudgeInput => ({
  situation: 'focused',
  seatedMinutes: 0,
  tenseMinutes: 0,
  ...p
})
const pick = (p: Partial<NudgeInput>): string | undefined => pickMove(input(p), cfg)?.moveId

describe('move library', () => {
  it('has all five moves, each step with a check and an animation, lengths matching steps', () => {
    expect(Object.keys(MOVES)).toEqual([
      'breathe',
      'neck-stretch',
      'stand-stretch',
      'walk',
      'step-outside'
    ])
    for (const move of Object.values(MOVES)) {
      expect(move.steps.reduce((a, s) => a + s.durationSec, 0)).toBe(move.lengthSec)
      for (const s of move.steps) expect(s.animation && s.howTo && s.title).toBeTruthy()
    }
    expect(MOVES.walk.leavesDesk && MOVES['step-outside'].leavesDesk).toBe(true)
  })
})

describe('pickMove triggers', () => {
  it('focused and fresh → nothing', () => {
    expect(pickMove(input({}), cfg)).toBeNull()
    expect(pickMove(input({ situation: null, seatedMinutes: 44 }), cfg)).toBeNull()
  })
  it('tense early → breathe, tense later → neck stretch', () => {
    expect(pick({ situation: 'tense', tenseMinutes: 1 })).toBe('breathe')
    expect(pick({ situation: 'tense', tenseMinutes: 6 })).toBe('neck-stretch')
  })
  it('seated time: 45 → neck, 60 → stand, 90 → walk', () => {
    expect(pick({ seatedMinutes: 45 })).toBe('neck-stretch')
    expect(pick({ seatedMinutes: 60 })).toBe('stand-stretch')
    expect(pick({ seatedMinutes: 90 })).toBe('walk')
    expect(pick({ situation: null, seatedMinutes: 61 })).toBe('stand-stretch')
  })
  it('low energy → stand, crashing → walk', () => {
    expect(pick({ situation: 'low' })).toBe('stand-stretch')
    expect(pick({ situation: 'crashing', tenseMinutes: 2 })).toBe('walk')
  })
  it('tense or crashing for 15+ min → step outside', () => {
    expect(pick({ situation: 'tense', tenseMinutes: 15 })).toBe('step-outside')
    expect(pick({ situation: 'crashing', tenseMinutes: 20 })).toBe('step-outside')
  })
  it('uses wellness wording', () => {
    expect(pickMove(input({ situation: 'tense', tenseMinutes: 1 }), cfg)?.message).toMatch(
      /^You seem tense/
    )
    for (const m of Object.values(cfg.messages).flatMap((x) => Object.values(x)))
      expect(m).not.toMatch(/stress level|heart|pulse|diagnos|anxiety/i)
  })
})

describe('canNudge', () => {
  it('allows the first nudge, then one per interval', () => {
    expect(canNudge(0, null, 20)).toBe(true)
    expect(canNudge(19 * 60_000, 0, 20)).toBe(false)
    expect(canNudge(20 * 60_000, 0, 20)).toBe(true)
  })
})

describe('verification', () => {
  it('head tilt uses the threshold and direction (positive = right ear down)', () => {
    expect(isTilt('head-tilt-right', 25, 20)).toBe(true)
    expect(isTilt('head-tilt-right', 15, 20)).toBe(false)
    expect(isTilt('head-tilt-right', -40, 20)).toBe(false)
    expect(isTilt('head-tilt-left', -20, 20)).toBe(true)
    expect(isTilt('head-tilt-left', 3, 20)).toBe(false)
    expect(isTilt('none', 45, 20)).toBe(false)
  })
  it('breathing slows when the latest readings drop 10%+ from the first', () => {
    expect(isBreathingSlowing([14, 14, 14, 13, 12, 12], 0.1, 3)).toBe(true)
    expect(isBreathingSlowing([14, 14, 14, 14, 13.5, 14], 0.1, 3)).toBe(false)
    expect(isBreathingSlowing([14, 10], 0.1, 3)).toBe(false) // too few readings
    expect(isBreathingSlowing([10, 10, 10, 14, 14, 14], 0.1, 3)).toBe(false)
  })
  it('stand-up: face rises, changes size, or leaves', () => {
    const seated = { y: 0.5, size: 0.3 }
    const v = cfg.verify
    expect(isStoodUp(seated, { present: true, center: { x: 0.5, y: 0.48 }, size: 0.31 }, v)).toBe(
      false
    )
    expect(isStoodUp(seated, { present: true, center: { x: 0.5, y: 0.3 }, size: 0.3 }, v)).toBe(
      true
    )
    expect(isStoodUp(seated, { present: true, center: { x: 0.5, y: 0.5 }, size: 0.18 }, v)).toBe(
      true
    )
    expect(isStoodUp(seated, { present: false }, v)).toBe(true)
    expect(isStoodUp(seated, { present: true }, v)).toBe(false)
  })
})

describe('returnResult', () => {
  const st = (p: Partial<StateUpdate>): StateUpdate => ({
    t: 1,
    situation: 'focused',
    confidence: 0.8,
    seatedMinutes: 0,
    away: false,
    trend: 'steady',
    ...p
  })
  it('focused or good → calmer', () => {
    expect(returnResult(st({}), 'tense', cfg)).toEqual({
      result: 'calmer',
      message: "You're calmer than before."
    })
    expect(returnResult(st({ situation: 'good' }), 'focused', cfg).result).toBe('calmer')
  })
  it('tense or crashing → still tense, offers breathing', () => {
    const r = returnResult(st({ situation: 'crashing' }), 'tense', cfg)
    expect(r).toEqual({
      result: 'still-tense',
      message: 'Still a bit tense. Want a 1 min breathing round?'
    })
  })
  it('no data, away or no situation → unknown', () => {
    expect(returnResult(null, 'tense', cfg).result).toBe('unknown')
    expect(returnResult(st({ situation: null }), 'tense', cfg).result).toBe('unknown')
    expect(returnResult(st({ away: true }), 'tense', cfg).result).toBe('unknown')
  })
})
