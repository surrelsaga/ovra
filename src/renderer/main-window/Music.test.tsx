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
    expect(screen.getByText('Read 100 songs from Peaceful Piano')).toBeInTheDocument()
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
