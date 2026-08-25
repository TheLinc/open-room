import { describe, expect, it } from 'vitest'
import { isInjectedSummary, replayKey } from './compaction'

describe('isInjectedSummary', () => {
  it('is true for the summary the CLI injects as a synthetic user message after compaction', () => {
    expect(
      isInjectedSummary({
        type: 'user',
        isSynthetic: true,
        message: { role: 'user', content: 'This session is being continued…' }
      })
    ).toBe(true)
  })

  it('is false for something the user actually typed', () => {
    expect(isInjectedSummary({ type: 'user', message: { role: 'user', content: 'hi' } })).toBe(
      false
    )
  })

  it('is false for a synthetic assistant message, which is command output', () => {
    expect(isInjectedSummary({ type: 'assistant', isSynthetic: true })).toBe(false)
  })
})

describe('replayKey', () => {
  it('identifies an assistant or user message by its uuid', () => {
    expect(replayKey({ type: 'assistant', uuid: 'a1' })).toBe('a1')
    expect(replayKey({ type: 'user', uuid: 'u1' })).toBe('u1')
  })

  it('is null for messages that are not part of the conversation record', () => {
    expect(replayKey({ type: 'system', subtype: 'init', uuid: 's1' })).toBeNull()
    expect(replayKey({ type: 'result', uuid: 'r1' })).toBeNull()
    expect(replayKey({ type: 'rate_limit_event' })).toBeNull()
  })

  it('is null when there is no uuid to key on', () => {
    expect(replayKey({ type: 'user' })).toBeNull()
  })
})
