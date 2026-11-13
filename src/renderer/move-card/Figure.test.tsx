// @vitest-environment jsdom
/// <reference types="node" />
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Figure } from './Figure'

// Vitest blanks CSS imports, so read the stylesheet that holds the phase offsets directly.
const css = readFileSync(join(__dirname, 'styles.css'), 'utf8')

describe('walking figure', () => {
  it.each(['walk', 'outside'])(
    '%s: two jointed legs and two arms, half a stride apart',
    (animation) => {
      const style = document.head.appendChild(document.createElement('style'))
      style.textContent = css
      const { container } = render(<Figure animation={animation} breathPeriodMs={8000} />)
      const delay = (sel: string): string =>
        getComputedStyle(container.querySelector(sel)!).animationDelay || '0s'

      for (const side of ['a', 'b']) {
        const leg = container.querySelector(`.fig-leg-${side}`)!
        expect(leg.querySelector('line')).not.toBeNull() // thigh
        expect(leg.querySelector('.fig-shin polyline')).not.toBeNull() // shin + foot
        expect(
          container.querySelector(`.fig-arm-${side} polyline`)!.getAttribute('points')!.split(' ')
        ).toHaveLength(3) // upper arm + forearm
      }
      // Leg a pairs with arm b; leg b and arm a run half a stride later.
      expect(delay('.fig-leg-a')).not.toBe(delay('.fig-leg-b'))
      expect(delay('.fig-arm-a')).not.toBe(delay('.fig-arm-b'))
      expect(delay('.fig-leg-b')).toBe(delay('.fig-arm-a'))
      expect(delay('.fig-leg-b .fig-shin')).toBe(delay('.fig-leg-b'))
      style.remove()
    }
  )
})
