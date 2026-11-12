import { createBus } from './bus'

describe('bus', () => {
  it('delivers typed events and unsubscribes', () => {
    const bus = createBus()
    const seen: number[] = []
    const off = bus.on('session:tick', (p) => seen.push(p.elapsedSec))
    bus.emit('session:tick', { sessionId: 'a', elapsedSec: 1, remainingSec: 9 })
    off()
    bus.emit('session:tick', { sessionId: 'a', elapsedSec: 2, remainingSec: 8 })
    expect(seen).toEqual([1])
  })
})
