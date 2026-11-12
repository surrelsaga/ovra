// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_PRIVACY, type PrivacySettings } from '@shared/types'
import { installFakeBridge } from '../ui/fake-bridge'
import { missingAnswers } from './consent'
import { Onboarding } from './Onboarding'

const next = (): HTMLElement => screen.getByRole('button', { name: /next|let’s start/i })

function setup(): {
  bridge: ReturnType<typeof installFakeBridge>
  onDone: ReturnType<typeof vi.fn>
} {
  const bridge = installFakeBridge({
    'privacy:set': (p: Partial<PrivacySettings>) => ({ ...DEFAULT_PRIVACY, ...p })
  })
  const onDone = vi.fn()
  render(<Onboarding initial={DEFAULT_PRIVACY} onDone={onDone} />)
  return { bridge, onDone }
}

describe('onboarding', () => {
  it('greets with the orb and says it is not a medical device', () => {
    setup()
    expect(screen.getByRole('img', { name: 'Ovra moon' })).toBeInTheDocument()
    expect(screen.getByText(/not a medical device/i)).toBeInTheDocument()
  })

  it('asks every question separately with no accept-all, enforcing must-answer ones', async () => {
    const { bridge, onDone } = setup()
    const seen: string[] = []
    fireEvent.click(next())
    expect(screen.getByText('Question 1 of 7')).toBeInTheDocument()

    // Camera: must answer.
    seen.push(screen.getByRole('group').querySelector('legend')!.textContent!)
    expect(next()).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/^Yes/))
    expect(next()).toBeEnabled()

    for (let i = 0; i < 6; i++) {
      expect(
        screen.queryByRole('button', { name: /accept all|allow all|agree to all|skip/i })
      ).toBeNull()
      expect(screen.getAllByRole('group')).toHaveLength(1)
      fireEvent.click(next())
      seen.push(screen.getByRole('group').querySelector('legend')!.textContent!)
      if (/face/i.test(seen[seen.length - 1])) {
        // Face: no default, must pick.
        expect(next()).toBeDisabled()
        fireEvent.click(screen.getByLabelText(/^Vitals only/))
      }
      if (i === 5) break
    }
    expect(seen).toHaveLength(7)
    expect(screen.getByText('Question 7 of 7')).toBeInTheDocument()
    expect(new Set(seen).size).toBe(7)

    const finish = screen.getByRole('button', { name: 'Finish' })
    fireEvent.click(finish)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const saved = bridge.invokes.find((c) => c.channel === 'privacy:set')!.req as PrivacySettings
    expect(saved).toMatchObject({
      camera: 'yes',
      face: 'vitals-only',
      telemetry: false,
      aiScoring: false
    })
    expect(saved.answeredAt).toEqual(expect.any(Number))
  })

  it('skips the camera follow-ups when the camera is declined', async () => {
    const { bridge } = setup()
    fireEvent.click(next())
    fireEvent.click(screen.getByLabelText(/^Not now/))
    const legends: string[] = []
    while (!screen.queryByRole('button', { name: 'Finish' })) {
      fireEvent.click(next())
      legends.push(screen.getByRole('group').querySelector('legend')!.textContent!)
    }
    expect(legends.join(' ')).not.toMatch(/how often|face/i)
    expect(screen.getByText('Question 7 of 7')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByText('Question 6 of 7')).toBeInTheDocument()
    fireEvent.click(next())
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    await waitFor(() => expect(bridge.invokes.some((c) => c.channel === 'privacy:set')).toBe(true))
  })

  it('missingAnswers requires camera, and face only when the camera is on', () => {
    expect(missingAnswers(DEFAULT_PRIVACY)).toEqual(['camera'])
    expect(missingAnswers({ ...DEFAULT_PRIVACY, camera: 'yes' })).toEqual(['face'])
    expect(missingAnswers({ ...DEFAULT_PRIVACY, camera: 'not-now' })).toEqual([])
    expect(missingAnswers({ ...DEFAULT_PRIVACY, camera: 'yes', face: 'vitals-only' })).toEqual([])
  })
})
