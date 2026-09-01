import { describe, expect, it } from 'vitest'
import { emptyRuntime } from './agent-runtime'
import { asksForReply, awaitingAfterTurn, captureTarget, mostRecentAwaiting } from './awaiting'

describe('asksForReply', () => {
  it('is true for a question and a blocker, which both wait on the user', () => {
    expect(asksForReply('question')).toBe(true)
    expect(asksForReply('blocker')).toBe(true)
  })

  it('is false for progress and done, which the user need not answer', () => {
    expect(asksForReply('progress')).toBe(false)
    expect(asksForReply('done')).toBe(false)
  })
})

describe('awaitingAfterTurn', () => {
  it('records the question when a turn that asked one ends normally', () => {
    expect(
      awaitingAfterTurn({ asked: 'Ship it?', isError: false, wasInterrupted: false }, 1000)
    ).toEqual({ text: 'Ship it?', since: 1000 })
  })

  it('records nothing when the turn never asked', () => {
    expect(awaitingAfterTurn({ asked: null, isError: false, wasInterrupted: false }, 1000)).toBe(
      null
    )
  })

  it('records nothing after an error or an interrupt, even if a question was spoken', () => {
    // A turn that failed is shown as failed; "waiting for you" on top of it
    // would send a reply into a session that may not take it.
    expect(awaitingAfterTurn({ asked: 'Ship it?', isError: true, wasInterrupted: false }, 1)).toBe(
      null
    )
    expect(awaitingAfterTurn({ asked: 'Ship it?', isError: false, wasInterrupted: true }, 1)).toBe(
      null
    )
  })
})

describe('mostRecentAwaiting', () => {
  it('returns the agent whose question is newest', () => {
    const runtimes = [
      { ...emptyRuntime('atlas'), awaiting: { text: 'A?', since: 10 } },
      { ...emptyRuntime('scout'), awaiting: { text: 'B?', since: 20 } },
      { ...emptyRuntime('juno'), awaiting: null }
    ]
    expect(mostRecentAwaiting(runtimes)).toBe('scout')
  })

  it('returns null when nobody is waiting', () => {
    expect(mostRecentAwaiting([emptyRuntime('atlas')])).toBe(null)
  })
})

describe('captureTarget', () => {
  it('lets an explicit agent win: a per-agent hotkey or a wake phrase named it', () => {
    expect(captureTarget({ explicit: 'juno', awaiting: 'scout', selected: 'atlas' })).toBe('juno')
  })

  it('redirects the global hotkey to the agent waiting for a reply', () => {
    expect(captureTarget({ explicit: null, awaiting: 'scout', selected: 'atlas' })).toBe('scout')
  })

  it('falls back to the selected agent when nobody is waiting', () => {
    expect(captureTarget({ explicit: null, awaiting: null, selected: 'atlas' })).toBe('atlas')
  })

  it('is null when there is nothing to aim at', () => {
    expect(captureTarget({ explicit: null, awaiting: null, selected: null })).toBe(null)
  })
})
