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

  it('keeps compaction boundaries, which are not silent status', () => {
    // Compaction is the conversation losing its middle, and it happens on its
    // own. Filtered out with the rest of `system`, an agent that had visibly
    // forgotten things had nothing in the transcript explaining why.
    expect(
      isRenderable(
        entry({
          type: 'system',
          subtype: 'compact_boundary',
          compact_metadata: { trigger: 'auto', pre_tokens: 152431, post_tokens: 41022 }
        })
      )
    ).toBe(true)
  })

  it('still drops system subtypes it does not know', () => {
    // The allow-list is the point: a new status subtype must not start
    // rendering as a JSON dump just because it appeared.
    expect(isRenderable(entry({ type: 'system', subtype: 'something_new' }))).toBe(false)
    expect(isRenderable(entry({ type: 'system' }))).toBe(false)
  })

  it('drops anything with no type at all', () => {
    // Would otherwise reach the debug fallthrough row and dump raw JSON.
    expect(isRenderable(entry(null))).toBe(false)
    expect(isRenderable(entry({}))).toBe(false)
  })
})

describe('command echoes', () => {
  const echo = (content: unknown) =>
    entry({ type: 'user', message: { role: 'user', content }, isReplay: true })

  it('drops the echo the CLI emits when the model changes', () => {
    // Observed verbatim from query.setModel() in the running app. Without
    // this, using the session controls posts an XML fragment into the
    // conversation as though someone had typed it.
    expect(
      isRenderable(echo('<local-command-stdout>Set model to claude-sonnet-5</local-command-stdout>'))
    ).toBe(false)
  })

  it('drops a stderr echo too', () => {
    expect(isRenderable(echo('<local-command-stderr>no such command</local-command-stderr>'))).toBe(
      false
    )
  })

  it('keeps ordinary typed text', () => {
    expect(isRenderable(echo('Set the model to sonnet please'))).toBe(true)
  })

  it('keeps a message that merely mentions the tag', () => {
    // The whole content must be the block. Someone who types that string has
    // still said it, and should see what they sent.
    expect(
      isRenderable(echo('why does <local-command-stdout>x</local-command-stdout> show up?'))
    ).toBe(true)
  })

  it('drops the invocation block that persisted history carries', () => {
    // Live and resumed are different routes. setModel emits the stdout form
    // immediately; the session file also stores the invocation, so it comes
    // back on the next launch. Filtering only the first left this one
    // appearing after a restart, which is how it survived the first fix.
    expect(
      isRenderable(
        echo(
          '<command-name>/model</command-name>\n  <command-message>model</command-message>\n  <command-args>claude-haiku-4-5</command-args>'
        )
      )
    ).toBe(false)
  })

  it('keeps block content, which is what a real user message carries', () => {
    expect(isRenderable(entry({ type: 'user', message: { role: 'user', content: [] } }))).toBe(true)
  })
})
