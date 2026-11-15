// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import type { SessionRecord } from '@shared/types'
import { installFakeBridge } from '../ui/fake-bridge'
import { History, SessionSummaryView } from './History'

const record: SessionRecord = {
  id: 'demo',
  activity: 'focus',
  startedAt: 0,
  endedAt: 1_200_000,
  lengthMin: 20,
  cameraMode: 'continuous',
  moodTimeline: [],
  moves: [],
  snoozes: 0,
  longestSeatedMin: 3,
  learnedSongIds: [],
  demo: true
}

it('marks demo history and its opened summary, leaving older sessions unmarked', async () => {
  installFakeBridge({ 'history:list': [record, { ...record, id: 'old', demo: undefined }] })
  render(<History />)
  expect(await screen.findAllByText('Demo session · shorter waits')).toHaveLength(1)
  fireEvent.click(screen.getByText('Demo session · shorter waits'))
  expect(screen.getByRole('heading', { name: 'Session' })).toBeInTheDocument()
  expect(screen.getByText('Demo session · shorter waits')).toBeInTheDocument()
})

it('shows the marker on the end summary only when demo is true', () => {
  const props = {
    title: 'Session complete',
    onBack: vi.fn(),
    backLabel: 'New session',
    onDeleted: vi.fn()
  }
  const view = render(<SessionSummaryView {...props} record={record} />)
  expect(screen.getByText('Demo session · shorter waits')).toBeInTheDocument()
  view.rerender(<SessionSummaryView {...props} record={{ ...record, demo: undefined }} />)
  expect(screen.queryByText('Demo session · shorter waits')).not.toBeInTheDocument()
})
