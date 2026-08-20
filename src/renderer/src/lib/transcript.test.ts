import { describe, expect, it } from 'vitest'
import type { TranscriptEntry } from '@shared/agent-runtime'
import { isRenderable } from './transcript'

/**
 * `AgentSupervisor` appends every SDK message to the transcript before it
 * dispatches on type, so this filter is the only thing keeping non-content
 * messages out of the chat. A type missing from it does not fail loudly — it
 * renders as a raw JSON dump in every conversation, which is how
 * `rate_limit_event` went unnoticed.
 */

function entry(message: unknown): TranscriptEntry {
  return { agentId: 'janet', seq: 1, receivedAt: 0, message } as TranscriptEntry
}

describe('isRenderable', () => {
  it('keeps the messages that carry conversation content', () => {
    expect(isRenderable(entry({ type: 'assistant' }))).toBe(true)
    expect(isRenderable(entry({ type: 'user' }))).toBe(true)
    expect(isRenderable(entry({ type: 'result' }))).toBe(true)
  })

  it('drops rate_limit_event, which is a banner rather than a row', () => {
    // Emitted once per turn, almost always with status "allowed". It is
    // consumed onto AgentRuntime.rateLimit; showing it too was duplication.
    expect(
      isRenderable(entry({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }))
    ).toBe(false)
  })

  it('drops system and stream_event', () => {
    expect(isRenderable(entry({ type: 'system', subtype: 'init' }))).toBe(false)
    expect(isRenderable(entry({ type: 'stream_event' }))).toBe(false)
  })

  it('drops anything with no type at all', () => {
    // Would otherwise reach the debug fallthrough row and dump raw JSON.
    expect(isRenderable(entry(null))).toBe(false)
    expect(isRenderable(entry({}))).toBe(false)
  })
})
