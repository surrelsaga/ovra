// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_PRIVACY } from '@shared/types'
import { installFakeBridge } from '../ui/fake-bridge'
import { Privacy } from './Privacy'

it.each([
  ['darwin', 'Mac', 'Finder'],
  ['win32', 'computer', 'Explorer']
])(
  'shows local storage details and opens the real folder on %s',
  async (platform, device, manager) => {
    const bridge = installFakeBridge({
      'data:folder': { path: '/actual/user/data/ovra', platform }
    })
    render(<Privacy privacy={DEFAULT_PRIVACY} onChange={vi.fn()} onDeletedAll={vi.fn()} />)
    expect(
      await screen.findByRole('heading', { name: `Stored on this ${device}` })
    ).toBeInTheDocument()
    expect(screen.getByText('/actual/user/data/ovra')).toBeInTheDocument()
    expect(screen.getByText('Never stored:')).toBeInTheDocument()
    expect(screen.getByText('Temporary app files')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: `Show in ${manager}` }))
    await waitFor(() =>
      expect(bridge.invokes).toContainEqual({ channel: 'data:show-folder', req: undefined })
    )
    expect(screen.getByText(/Looks up public song descriptions on Last.fm/)).toBeInTheDocument()
  }
)
