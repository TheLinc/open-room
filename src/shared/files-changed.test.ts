import { describe, expect, it } from 'vitest'
import type { TranscriptEntry } from './agent-runtime'
import { filesChangedIn, isPrompt, turnBefore } from './files-changed'

const entry = (seq: number, message: unknown): TranscriptEntry => ({
  agentId: 'a',
  seq,
  receivedAt: seq,
  message
})
const assistant = (blocks: unknown[]) => ({
  type: 'assistant',
  message: { role: 'assistant', content: blocks }
})
const toolUse = (name: string, input: Record<string, unknown>) => ({
  type: 'tool_use',
  name,
  input
})
const user = (content: unknown) => ({ type: 'user', message: { role: 'user', content } })
const result = { type: 'result', subtype: 'success' }

describe('filesChangedIn', () => {
  it('collects Edit, Write, MultiEdit and NotebookEdit targets, deduplicated, in order', () => {
    const files = filesChangedIn([
      assistant([toolUse('Read', { file_path: 'a.ts' })]),
      assistant([toolUse('Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' })]),
      assistant([toolUse('Write', { file_path: 'b.ts', content: '' })]),
      assistant([toolUse('MultiEdit', { file_path: 'a.ts', edits: [] })]),
      assistant([toolUse('NotebookEdit', { notebook_path: 'n.ipynb' })])
    ])
    expect(files.map((f) => f.path)).toEqual(['a.ts', 'b.ts', 'n.ipynb'])
  })

  it('marks a file created when its first touch was a Write', () => {
    const files = filesChangedIn([
      assistant([toolUse('Write', { file_path: 'new.ts', content: '' })]),
      assistant([toolUse('Edit', { file_path: 'old.ts', old_string: 'x', new_string: 'y' })])
    ])
    expect(files).toEqual([
      { path: 'new.ts', created: true },
      { path: 'old.ts', created: false }
    ])
  })

  it('ignores messages that are not assistant tool use', () => {
    expect(filesChangedIn([user('hi'), result, { type: 'system' }])).toEqual([])
  })
})

describe('turnBefore', () => {
  it('returns the entries between the previous prompt and the result', () => {
    const entries = [
      entry(1, user('first')),
      entry(2, assistant([toolUse('Write', { file_path: 'a.ts' })])),
      entry(3, result),
      entry(4, user('second')),
      entry(5, assistant([toolUse('Write', { file_path: 'b.ts' })])),
      entry(6, user([{ type: 'tool_result', tool_use_id: 't' }])),
      entry(7, result)
    ]
    expect(turnBefore(entries, 6).map((e) => e.seq)).toEqual([5, 6])
  })

  it('treats a tool result as part of the turn, not as a new prompt', () => {
    const entries = [
      entry(1, user('go')),
      entry(2, user([{ type: 'tool_result', tool_use_id: 't' }])),
      entry(3, result)
    ]
    expect(turnBefore(entries, 2).map((e) => e.seq)).toEqual([2])
  })

  it('does not treat an injected compaction summary as a prompt boundary', () => {
    const entries = [
      entry(1, user('go')),
      entry(2, assistant([toolUse('Write', { file_path: 'a.ts' })])),
      entry(3, {
        type: 'user',
        isSynthetic: true,
        message: { role: 'user', content: 'Summary of the conversation so far…' }
      }),
      entry(4, assistant([toolUse('Write', { file_path: 'b.ts' })])),
      entry(5, result)
    ]
    expect(turnBefore(entries, 4).map((e) => e.seq)).toEqual([2, 3, 4])
  })
})

describe('isPrompt', () => {
  it('is true for a user message with string content', () => {
    expect(isPrompt(entry(1, user('hello')))).toBe(true)
  })

  it('is false for a user message whose array content is only tool_result blocks', () => {
    expect(isPrompt(entry(1, user([{ type: 'tool_result', tool_use_id: 't' }])))).toBe(false)
  })

  it('is true for a user message with a text block plus a tool_result', () => {
    expect(
      isPrompt(
        entry(
          1,
          user([
            { type: 'text', text: 'hi' },
            { type: 'tool_result', tool_use_id: 't' }
          ])
        )
      )
    ).toBe(true)
  })

  it('is false for an injected compaction summary (isSynthetic)', () => {
    expect(
      isPrompt(
        entry(1, {
          type: 'user',
          isSynthetic: true,
          message: { role: 'user', content: 'Summary of the conversation so far…' }
        })
      )
    ).toBe(false)
  })

  it('is false for an assistant message', () => {
    expect(isPrompt(entry(1, assistant([toolUse('Write', { file_path: 'a.ts' })])))).toBe(false)
  })
})
