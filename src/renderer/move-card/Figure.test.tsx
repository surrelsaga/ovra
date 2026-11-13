// @vitest-environment jsdom
/// <reference types="node" />
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MOVES } from '../../main/moves/config'
import { Figure } from './Figure'

// Vitest blanks CSS imports, so read the stylesheet that holds the poses and phase offsets directly.
const css = readFileSync(join(__dirname, 'styles.css'), 'utf8')

const ANIMATIONS = [
  ...new Set(Object.values(MOVES).flatMap((m) => m.steps.map((s) => s.animation)))
]

/** Every value a `--name` variable takes in rules or keyframes for this animation. */
function poseValues(animation: string, name: string): string[] {
  const rules = css.split('}').filter((r) => r.includes(`.fig--${animation}`))
  const frames = css.match(new RegExp(`@keyframes [\\w-]+ \\{[\\s\\S]*?\\n\\}`, 'g')) ?? []
  const used = css.match(new RegExp(`\\.fig--${animation} \\{\\s*animation: ([\\w-]+)`))?.[1]
  const own = frames.find((f) => f.startsWith(`@keyframes ${used} `)) ?? ''
  return [...rules, own].flatMap((r) =>
    [...r.matchAll(new RegExp(`${name}: ([^;]+);`, 'g'))].map((m) => m[1])
  )
}

describe('figure', () => {
  it('covers every step animation in the move library', () => {
    expect(ANIMATIONS.sort()).toEqual(
      [
        'breathe',
        'fold',
        'look-up',
        'neck-left',
        'neck-right',
        'outside',
        'reach-up',
        'shoulder-roll',
        'side-bend',
        'sit',
        'stand-up',
        'walk'
      ].sort()
    )
  })

  it.each(ANIMATIONS)('%s: a full jointed figure with distinct limbs', (animation) => {
    const { container } = render(<Figure animation={animation} breathPeriodMs={10000} />)
    const svg = container.querySelector('svg')!
    expect(svg.querySelectorAll('.fig-head circle')).toHaveLength(1)
    expect(svg.querySelector('.fig-torso .fig-chest .fig-head')).not.toBeNull()

    const origin = (el: Element): string => (el as SVGElement).style.transformOrigin
    for (const side of ['a', 'b']) {
      const leg = svg.querySelector(`.fig-leg-${side}`)!
      const shin = leg.querySelector(':scope > .fig-shin')!
      const foot = shin.querySelector(':scope > .fig-foot')!
      expect(leg.querySelector(':scope > line')).not.toBeNull() // thigh
      expect(shin.querySelector(':scope > line')).not.toBeNull()
      expect(foot.querySelector(':scope > line')).not.toBeNull()
      // Hip, knee and ankle are three different pivots.
      expect(new Set([origin(leg), origin(shin), origin(foot)]).size).toBe(3)

      const arm = svg.querySelector(`.fig-chest .fig-arm-${side}`)!
      const fore = arm.querySelector(':scope > .fig-fore')!
      expect(arm.querySelector(':scope > line')).not.toBeNull() // upper arm
      expect(fore.querySelector(':scope > line')).not.toBeNull()
      expect(origin(arm)).not.toBe(origin(fore)) // shoulder and elbow
    }

    // Limbs are distinct: spread apart (front view), out of phase (walk) or posed differently (side view).
    const legA = svg.querySelector('.fig-leg-a')!
    const legB = svg.querySelector('.fig-leg-b')!
    if (origin(legA) === origin(legB) && !['walk', 'outside'].includes(animation)) {
      expect(poseValues(animation, '--hip-a')).not.toEqual(poseValues(animation, '--hip-b'))
      expect(poseValues(animation, '--arm-a')).not.toEqual(poseValues(animation, '--arm-b'))
    }
    // Something moves, and there's a reduced-motion key pose for it.
    if (!['walk', 'outside'].includes(animation)) {
      expect(css).toMatch(new RegExp(`\\.fig--${animation} \\{\\s*animation: [\\w-]+ `))
      const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
      expect(reduced).toMatch(new RegExp(`\\.fig--${animation} \\{\\s*--`))
    }
  })

  it('keeps the breath in step with the wall clock', () => {
    const { container } = render(<Figure animation="breathe" breathPeriodMs={10000} />)
    expect(container.querySelector('svg')!.style.animationDelay).toMatch(/^-\d+ms$/)
  })
})

describe('walking figure', () => {
  it.each(['walk', 'outside'])(
    '%s: two jointed legs and two arms, half a stride apart',
    (animation) => {
      const style = document.head.appendChild(document.createElement('style'))
      style.textContent = css
      const { container } = render(<Figure animation={animation} breathPeriodMs={8000} />)
      const delay = (sel: string): string =>
        getComputedStyle(container.querySelector(sel)!).animationDelay || '0s'

      // Leg a pairs with arm b; leg b and arm a run half a stride later.
      expect(delay('.fig-leg-a')).not.toBe(delay('.fig-leg-b'))
      expect(delay('.fig-arm-a')).not.toBe(delay('.fig-arm-b'))
      expect(delay('.fig-leg-b')).toBe(delay('.fig-arm-a'))
      expect(delay('.fig-leg-b .fig-shin')).toBe(delay('.fig-leg-b'))
      style.remove()
    }
  )
})
