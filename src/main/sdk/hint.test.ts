import { createValidationSmoother } from './hint'

const ev = (code: number, hint = `hint ${code}`): { t: number; code: number; hint: string } => ({
  t: 0,
  code,
  hint
})

describe('validation smoother', () => {
  it('ignores codes that flap faster than the persist time', () => {
    const s = createValidationSmoother(1000)
    s.push(ev(0), 0)
    s.push(ev(17), 300)
    s.push(ev(0), 600)
    s.push(ev(17), 900)
    expect(s.poll(1500)).toBeNull()
    expect(s.hint()).toBeNull()
  })

  it('shows a hint once a code persists, and only reports changes', () => {
    const s = createValidationSmoother(1000)
    s.push(ev(7, 'Place more of the chest in view.'), 0)
    expect(s.poll(500)).toBeNull()
    expect(s.poll(1000)).toMatchObject({ code: 7, t: 1000 })
    expect(s.hint()).toBe('Place more of the chest in view.')
    expect(s.poll(2000)).toBeNull()
    s.push(ev(0), 2000)
    expect(s.hint()).toBe('Place more of the chest in view.')
    expect(s.poll(3000)).toMatchObject({ code: 0 })
    expect(s.hint()).toBeNull()
  })

  it('resets', () => {
    const s = createValidationSmoother(0)
    s.push(ev(7), 0)
    s.poll(0)
    s.reset()
    expect(s.hint()).toBeNull()
  })
})
