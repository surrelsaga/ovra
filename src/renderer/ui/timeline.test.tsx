// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import type { MoodPoint } from '@shared/types'
import { MoodTimeline } from '.'

it('uses plain labels in the legend and accessible timeline, preserving saved mood values', () => {
  const situations = ['focused', 'good', 'tense', 'crashing', 'low', 'unknown', 'away'] as const
  const points: MoodPoint[] = situations.map((situation, t) => ({ t, situation }))
  const { container } = render(<MoodTimeline points={points} start={0} end={7} legend />)
  for (const label of [
    'Steady',
    'Good mood',
    'Stressed',
    'Very stressed',
    'Tired',
    "Couldn't see you",
    'Away'
  ]) {
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAccessibleName(expect.stringContaining(label))
  }
  expect(
    [...container.querySelectorAll('.timeline__seg')].map((s) => s.getAttribute('data-situation'))
  ).toEqual(situations)
  expect(
    [...container.querySelectorAll('.timeline__swatch')].map((s) =>
      s.getAttribute('data-situation')
    )
  ).toEqual(situations)
})
