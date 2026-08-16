import { describe, expect, it } from 'vitest'
import { PushableQueue } from './message-queue'

async function collect<T>(stream: AsyncGenerator<T>, count: number): Promise<T[]> {
  const out: T[] = []
  for await (const value of stream) {
    out.push(value)
    if (out.length === count) break
  }
  return out
}

describe('PushableQueue', () => {
  it('delivers values pushed before the stream is consumed', async () => {
    const q = new PushableQueue<string>()
    q.push('a')
    q.push('b')
    q.close()

    const out: string[] = []
    for await (const value of q.stream()) out.push(value)
    expect(out).toEqual(['a', 'b'])
  })

  it('delivers values pushed after the consumer parks', async () => {
    const q = new PushableQueue<string>()
    const collected = collect(q.stream(), 2)

    // Let the consumer reach its await before pushing.
    await new Promise((r) => setTimeout(r, 10))
    q.push('a')
    q.push('b')

    expect(await collected).toEqual(['a', 'b'])
  })

  it('preserves order when a push wakes a parked consumer', async () => {
    const q = new PushableQueue<number>()
    const collected = collect(q.stream(), 3)

    await new Promise((r) => setTimeout(r, 10))
    // The first push hands off directly; the rest buffer. All three must
    // still arrive in push order.
    q.push(1)
    q.push(2)
    q.push(3)

    expect(await collected).toEqual([1, 2, 3])
  })

  it('ends the stream when closed while a consumer is parked', async () => {
    const q = new PushableQueue<string>()
    const done = (async () => {
      const out: string[] = []
      for await (const value of q.stream()) out.push(value)
      return out
    })()

    await new Promise((r) => setTimeout(r, 10))
    q.close()

    expect(await done).toEqual([])
  })

  it('drains buffered values before ending after close', async () => {
    const q = new PushableQueue<string>()
    q.push('a')
    q.close()

    const out: string[] = []
    for await (const value of q.stream()) out.push(value)
    expect(out).toEqual(['a'])
  })

  it('ignores pushes after close rather than throwing', () => {
    const q = new PushableQueue<string>()
    q.close()
    expect(() => q.push('a')).not.toThrow()
    expect(q.isClosed).toBe(true)
  })

  it('is idempotent on repeated close', () => {
    const q = new PushableQueue<string>()
    q.close()
    expect(() => q.close()).not.toThrow()
  })
})
