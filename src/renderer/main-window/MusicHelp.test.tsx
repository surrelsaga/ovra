// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { installFakeBridge } from '../ui/fake-bridge'
import { MusicHelp } from './MusicHelp'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

it('adds a playlist through the existing IPC and closes only on a successful read', async () => {
  const playlist = { uri: 'spotify:playlist:1', readError: 'This playlist is private or empty.' }
  const bridge = installFakeBridge({ 'music:add-playlist': () => playlist })
  const onDone = vi.fn().mockResolvedValue(undefined)
  render(<MusicHelp onDone={onDone} />)
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '  https://open.spotify.com/playlist/example  ' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(playlist.readError)
  expect(onDone).not.toHaveBeenCalled()
  playlist.readError = ''
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
  expect(bridge.invokes[0]).toEqual({
    channel: 'music:add-playlist',
    req: { url: 'https://open.spotify.com/playlist/example' }
  })
})

it('handles Escape as Later and restores focus when closed', async () => {
  installFakeBridge()
  const onDone = vi.fn().mockResolvedValue(undefined)
  const opener = document.createElement('button')
  document.body.append(opener)
  opener.focus()
  const view = render(<MusicHelp onDone={onDone} />)
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
  view.unmount()
  expect(opener).toHaveFocus()
  opener.remove()
})
