import { describe, expect, it, vi } from 'vitest'
import { LiveSession, MIN_NEW_S, SAMPLE_RATE } from './live-session'

const seconds = (n: number, fill = 0.2): Float32Array =>
  new Float32Array(n * SAMPLE_RATE).fill(fill)

/** A transcribe that answers with a word per second of audio it was given. */
function transcriber(): {
  transcribe: (samples: Float32Array) => Promise<string>
  release: () => void
  calls: () => number[]
} {
  const lengths: number[] = []
  let resolvers: ((text: string) => void)[] = []
  const transcribe = (samples: Float32Array): Promise<string> => {
    lengths.push(samples.length / SAMPLE_RATE)
    return new Promise<string>((resolve) => {
      resolvers.push(() =>
        resolve(
          Array.from(
            { length: Math.round(samples.length / SAMPLE_RATE) },
            (_, i) => `w${i + 1}`
          ).join(' ')
        )
      )
    })
  }
  return {
    transcribe,
    release: () => {
      const pending = resolvers
      resolvers = []
      for (const done of pending) done('')
    },
    calls: () => lengths
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('LiveSession', () => {
  it('does not decode until enough new audio has arrived', () => {
    const t = transcriber()
    const session = new LiveSession({ transcribe: t.transcribe, onPartial: vi.fn() })
    session.feed(seconds(MIN_NEW_S / 2))
    expect(t.calls()).toHaveLength(0)
    session.feed(seconds(MIN_NEW_S / 2))
    expect(t.calls()).toHaveLength(1)
  })

  it('runs one decode at a time and reports a partial after each', async () => {
    const t = transcriber()
    const onPartial = vi.fn()
    const session = new LiveSession({ transcribe: t.transcribe, onPartial })
    session.feed(seconds(1))
    session.feed(seconds(1))
    session.feed(seconds(1))
    // The second and third chunks arrived while the first decode was in flight.
    expect(t.calls()).toHaveLength(1)
    t.release()
    await tick()
    await tick()
    // One follow-up decode covers everything that arrived meanwhile.
    expect(t.calls()).toHaveLength(2)
    expect(t.calls()).toEqual([1, 3])
    t.release()
    await tick()
    expect(onPartial).toHaveBeenCalledTimes(2)
    expect(onPartial).toHaveBeenLastCalledWith({ committed: 'w1', tentative: 'w2 w3' })
  })

  it('finishes with the last decode of the whole window, after the one in flight', async () => {
    const t = transcriber()
    const session = new LiveSession({ transcribe: t.transcribe, onPartial: vi.fn() })
    session.feed(seconds(2))
    const finishing = session.finish()
    t.release()
    await tick()
    t.release()
    await expect(finishing).resolves.toBe('w1 w2')
  })

  it('seals the head of a long window at a quiet gap and keeps decoding the tail', async () => {
    const t = transcriber()
    const onPartial = vi.fn()
    const session = new LiveSession({ transcribe: t.transcribe, onPartial })
    // 14 s with a silent gap at 9 s: past the 12 s limit, so the decode
    // first seals the audio before the gap.
    const audio = seconds(14)
    audio.fill(0, 9 * SAMPLE_RATE, 9.6 * SAMPLE_RATE)
    session.feed(audio)
    expect(t.calls()[0]).toBeGreaterThan(9)
    expect(t.calls()[0]).toBeLessThan(9.6)
    t.release()
    await tick()
    // Then the tail after the cut, on its own.
    expect(t.calls()[1]).toBeLessThan(5)
    t.release()
    await tick()
    const view = onPartial.mock.calls.at(-1)?.[0]
    expect(view.committed.startsWith('w1 w2')).toBe(true)
  })

  it('ignores audio after cancel and decodes nothing more', async () => {
    const t = transcriber()
    const session = new LiveSession({ transcribe: t.transcribe, onPartial: vi.fn() })
    session.cancel()
    session.feed(seconds(3))
    expect(t.calls()).toHaveLength(0)
    await expect(session.finish()).resolves.toBe('')
  })
})
