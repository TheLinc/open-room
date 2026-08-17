import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeechPriority, Utterance } from '@shared/speech'
import { SpeechBus, type SpeechSink } from './speech-bus'

/**
 * A sink that never finishes on its own, so tests control exactly when an
 * utterance ends. Playback is the thing the bus arbitrates, so it has to be
 * suspendable to observe preemption at all.
 */
function makeSink() {
  const spoken: string[] = []
  const notified: Utterance[][] = []
  let finish: (() => void) | null = null
  // Counted rather than a flag: the preempting utterance begins the moment
  // the aborted one resolves, so a per-call boolean is already reset by the
  // time a test looks at it.
  let abortCount = 0

  const sink: SpeechSink = {
    speak(text, { signal }) {
      spoken.push(text)
      return new Promise<void>((resolve) => {
        finish = resolve
        signal.addEventListener('abort', () => {
          abortCount += 1
          resolve()
        })
      })
    },
    notify(utterances) {
      notified.push(utterances)
    }
  }

  return {
    sink,
    spoken,
    notified,
    /** Ends the current utterance normally. */
    end: async () => {
      finish?.()
      finish = null
      await Promise.resolve()
      await Promise.resolve()
    },
    abortCount: () => abortCount
  }
}

let clock = 0
const now = (): number => clock
const tick = (ms: number): void => {
  clock += ms
}

let seq = 0
function utter(
  agentId: string,
  priority: SpeechPriority,
  text = `${agentId}-${priority}-${seq}`
): Utterance {
  seq += 1
  return {
    id: `u${seq}`,
    agentId,
    agentName: agentId[0].toUpperCase() + agentId.slice(1),
    text,
    priority,
    queuedAt: clock
  }
}

beforeEach(() => {
  clock = 1_000_000
  seq = 0
})

/** Lets the bus's internal promise chain settle. */
const settle = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('SpeechBus ordering', () => {
  it('speaks one utterance at a time', async () => {
    const { sink, spoken } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'done', 'first'))
    bus.enqueue(utter('atlas', 'done', 'second'))
    await settle()

    expect(spoken).toHaveLength(1)
  })

  it('is FIFO within a priority tier', async () => {
    const { sink, spoken, end } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'done', 'first'))
    tick(10)
    bus.enqueue(utter('atlas', 'done', 'second'))
    await settle()
    await end()
    await settle()

    expect(spoken.map((s) => s.replace(/^\w+ — /, ''))).toEqual(['first', 'second'])
  })

  it('takes higher priority ahead of lower regardless of arrival order', async () => {
    const { sink, spoken, end } = makeSink()
    const bus = new SpeechBus(sink, now)

    // Occupy the lane so the rest queue up behind it.
    bus.enqueue(utter('atlas', 'done', 'occupier'))
    await settle()

    bus.enqueue(utter('atlas', 'progress', 'low'))
    bus.enqueue(utter('atlas', 'blocker', 'high'))
    await end()
    await settle()

    expect(spoken[1]).toContain('high')
  })
})

describe('SpeechBus preemption', () => {
  it('interrupts a lower-priority utterance mid-playback', async () => {
    const { sink, spoken, abortCount } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'progress', 'rambling'))
    await settle()
    expect(spoken).toHaveLength(1)

    bus.enqueue(utter('atlas', 'question', 'urgent'))
    await settle()

    expect(abortCount()).toBe(1)
    expect(spoken[1]).toContain('urgent')
  })

  it('never interrupts a higher-priority utterance with a lower one', async () => {
    const { sink, spoken, abortCount } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'question', 'important'))
    await settle()

    bus.enqueue(utter('atlas', 'progress', 'trivial'))
    await settle()

    expect(abortCount()).toBe(0)
    expect(spoken).toHaveLength(1)
  })

  it('does not interrupt for an equal priority', async () => {
    const { sink, spoken, abortCount } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'done', 'one'))
    await settle()
    bus.enqueue(utter('atlas', 'done', 'two'))
    await settle()

    expect(abortCount()).toBe(0)
    expect(spoken).toHaveLength(1)
  })
})

describe('SpeechBus progress handling', () => {
  it('keeps only the latest progress per agent', async () => {
    const { sink, spoken, end } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'done', 'occupier'))
    await settle()

    bus.enqueue(utter('atlas', 'progress', 'stale'))
    bus.enqueue(utter('atlas', 'progress', 'fresh'))
    await end()
    await settle()

    expect(spoken.some((s) => s.includes('stale'))).toBe(false)
    expect(spoken.some((s) => s.includes('fresh'))).toBe(true)
  })

  it('coalesces progress per agent, not across agents', async () => {
    const { sink, spoken, end } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'done', 'occupier'))
    await settle()

    bus.enqueue(utter('atlas', 'progress', 'atlas-update'))
    bus.enqueue(utter('juniper', 'progress', 'juniper-update'))
    await end()
    await settle()
    await end()
    await settle()

    expect(spoken.some((s) => s.includes('atlas-update'))).toBe(true)
    expect(spoken.some((s) => s.includes('juniper-update'))).toBe(true)
  })

  it('drops progress that went stale while queued', async () => {
    const { sink, spoken, end } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'done', 'occupier'))
    await settle()
    bus.enqueue(utter('atlas', 'progress', 'old-news'))

    tick(31_000)
    await end()
    await settle()

    expect(spoken.some((s) => s.includes('old-news'))).toBe(false)
  })

  it('still speaks a question queued behind a long blocker', async () => {
    // The named regression: expiry must apply to progress only. An unheard
    // question is the worst failure this app can produce.
    const { sink, spoken, end } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'blocker', 'long-blocker'))
    await settle()
    bus.enqueue(utter('atlas', 'question', 'may-i-proceed'))

    tick(120_000)
    await end()
    await settle()

    expect(spoken.some((s) => s.includes('may-i-proceed'))).toBe(true)
  })

  it('does not expire done utterances either', async () => {
    const { sink, spoken, end } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'blocker', 'occupier'))
    await settle()
    bus.enqueue(utter('atlas', 'done', 'finished-the-job'))

    tick(120_000)
    await end()
    await settle()

    expect(spoken.some((s) => s.includes('finished-the-job'))).toBe(true)
  })
})

describe('SpeechBus speaker prefix', () => {
  it('names the speaker on the first utterance', async () => {
    const { sink, spoken } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'done', 'green'))
    await settle()

    expect(spoken[0]).toBe('Atlas — green')
  })

  it('omits the name when the same agent speaks again quickly', async () => {
    const { sink, spoken, end } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'done', 'one'))
    await settle()
    await end()
    tick(5_000)
    bus.enqueue(utter('atlas', 'done', 'two'))
    await settle()

    expect(spoken[1]).toBe('two')
  })

  it('names the speaker again on a change of agent', async () => {
    const { sink, spoken, end } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'done', 'one'))
    await settle()
    await end()
    bus.enqueue(utter('juniper', 'done', 'two'))
    await settle()

    expect(spoken[1]).toBe('Juniper — two')
  })

  it('re-announces the same agent after the window lapses', async () => {
    const { sink, spoken, end } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'done', 'one'))
    await settle()
    await end()
    tick(31_000)
    bus.enqueue(utter('atlas', 'done', 'two'))
    await settle()

    expect(spoken[1]).toBe('Atlas — two')
  })

  it('never produces a valid wake phrase', async () => {
    // Wake requires a "hey" prefix; the bus emits a bare name. TTS output
    // therefore cannot re-trigger an agent by construction.
    const { sink, spoken } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'done', 'green'))
    await settle()

    expect(spoken[0].toLowerCase()).not.toContain('hey atlas')
  })
})

describe('SpeechBus burst collapse', () => {
  it('speaks the top priority and notifies the remainder', async () => {
    const { sink, spoken, notified, end } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'done', 'occupier'))
    await settle()

    bus.enqueue(utter('a', 'done', 'one'))
    bus.enqueue(utter('b', 'done', 'two'))
    bus.enqueue(utter('c', 'question', 'three'))
    await end()
    await settle()

    expect(spoken[1]).toContain('three')
    expect(notified).toHaveLength(1)
    expect(notified[0].map((u) => u.text).sort()).toEqual(['one', 'two'])
  })

  it('does not collapse below the burst threshold', async () => {
    const { sink, notified, end } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'done', 'occupier'))
    await settle()
    bus.enqueue(utter('a', 'done', 'one'))
    bus.enqueue(utter('b', 'done', 'two'))
    await end()
    await settle()

    expect(notified).toHaveLength(0)
  })
})

describe('SpeechBus barge-in', () => {
  it('stops playback when the user starts speaking', async () => {
    const { sink, abortCount } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'done', 'talking'))
    await settle()

    bus.bargeIn()
    await settle()

    expect(abortCount()).toBe(1)
  })

  it('clears anything still queued, since the user has taken over', async () => {
    const { sink, spoken } = makeSink()
    const bus = new SpeechBus(sink, now)

    bus.enqueue(utter('atlas', 'done', 'talking'))
    await settle()
    bus.enqueue(utter('atlas', 'progress', 'queued'))

    bus.bargeIn()
    await settle()

    expect(spoken.some((s) => s.includes('queued'))).toBe(false)
  })
})

describe('SpeechBus resilience', () => {
  it('carries on after a sink failure rather than wedging the lane', async () => {
    const failing: SpeechSink = {
      speak: vi
        .fn()
        .mockRejectedValueOnce(new Error('audio device gone'))
        .mockResolvedValue(undefined),
      notify: vi.fn()
    }
    const bus = new SpeechBus(failing, now)

    bus.enqueue(utter('atlas', 'done', 'first'))
    await settle()
    bus.enqueue(utter('atlas', 'done', 'second'))
    await settle()

    expect(failing.speak).toHaveBeenCalledTimes(2)
  })
})
