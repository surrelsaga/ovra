// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import type { MusicStatus } from '@shared/types'
import { installFakeBridge } from '../ui/fake-bridge'
import { Music } from './Music'

const status: MusicStatus = {
  available: false,
  leaveAlone: false,
  target: null,
  nowPlaying: null,
  scoringQueue: 0,
  scoredCount: 0
}

it('shows read results and errors and polls availability only while Music is mounted', async () => {
  vi.useFakeTimers()
  try {
    const bridge = installFakeBridge({
      'music:library': {
        songs: [],
        playlists: [
          {
            uri: 'spotify:playlist:1',
            url: '',
            addedAt: 0,
            name: 'Peaceful Piano',
            trackCount: 100
          },
          {
            uri: 'spotify:playlist:2',
            url: 'Private playlist',
            addedAt: 0,
            readError: 'This playlist is private or empty'
          }
        ]
      }
    })
    const view = render(<Music initialStatus={status} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('Read 100 songs')).toBeInTheDocument()
    expect(screen.queryByText(/scored so far/)).toBeNull()
    expect(screen.getByText('This playlist is private or empty')).toBeInTheDocument()
    expect(screen.getByText(/Spotify isn’t running/)).toBeInTheDocument()
    bridge.push('push:music', { ...status, available: true })
    expect(screen.queryByText(/Spotify isn’t running/)).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(bridge.invokes.filter((i) => i.channel === 'music:status')).toHaveLength(3)
    view.unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(bridge.invokes.filter((i) => i.channel === 'music:status')).toHaveLength(3)
  } finally {
    vi.useRealTimers()
  }
})

it('shows only songs left while provisional scores are pending and hides progress when done', () => {
  const bridge = installFakeBridge({ 'music:library': { songs: [], playlists: [] } })
  render(<Music initialStatus={{ ...status, scoredCount: 100, scoringQueue: 100 }} />)
  expect(screen.getByText('Getting to know your music · 100 songs left')).toBeInTheDocument()
  bridge.push('push:music', { ...status, scoredCount: 100, scoringQueue: 60 })
  expect(screen.getByText('Getting to know your music · 60 songs left')).toBeInTheDocument()
  bridge.push('push:music', { ...status, scoredCount: 100 })
  expect(screen.queryByText(/Getting to know your music/)).toBeNull()
})

it('shows plain group and singing labels for songs with unchanged stored scores', async () => {
  installFakeBridge({
    'music:library': {
      playlists: [],
      songs: [
        {
          id: 'known-song',
          title: 'Song',
          artist: 'Artist',
          scores: {
            energy: 3,
            mood: 'neutral',
            vocals: 'light',
            confidence: 0.9,
            source: 'rules',
            scoredAt: 0
          }
        }
      ]
    }
  })
  render(<Music initialStatus={status} />)
  expect(await screen.findByText('Some singing')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /^Steady/ })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: /^Pick me up/ })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Singing' })).toBeInTheDocument()
  expect(screen.getByText('Some singing')).toBeInTheDocument()
  expect(screen.getByText('Neutral')).toBeInTheDocument()
  expect(screen.queryByText('light')).toBeNull()
})
