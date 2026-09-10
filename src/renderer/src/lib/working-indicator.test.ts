import { describe, expect, it } from 'vitest'
import type { TranscriptEntry } from '@shared/agent-runtime'
import {
  describeElapsed,
  runningTool,
  turnStartedAt,
  VERB_ROTATION_MS,
  WORKING_VERBS,
  workingVerb
} from './working-indicator'

function entry(seq: number, message: unknown): TranscriptEntry {
  return { agentId: 'atlas', seq, receivedAt: 0, message }
}
const toolUse = (id: string, name: string): unknown => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name, input: {} }] }
})
const toolResult = (id: string): unknown => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id }] }
})

describe('workingVerb', () => {
  it('is the same verb for the same turn, however often it is asked', () => {
    expect(workingVerb(1234, 100)).toBe(workingVerb(1234, 2000))
  })

  it('moves to the next verb once the rotation window has passed', () => {
    const first = workingVerb(0, 0)
    const second = workingVerb(0, VERB_ROTATION_MS)
    expect(first).toBe(WORKING_VERBS[0])
    expect(second).toBe(WORKING_VERBS[1])
    expect(workingVerb(0, VERB_ROTATION_MS * WORKING_VERBS.length)).toBe(WORKING_VERBS[0])
  })

  it('starts different turns on different verbs', () => {
    expect(workingVerb(0, 0)).not.toBe(workingVerb(1, 0))
  })

  it('ends every verb with an ellipsis-ready stem, never punctuation', () => {
    for (const verb of WORKING_VERBS) expect(verb).toMatch(/^[A-Z][a-z]+$/)
  })
})

describe('describeElapsed', () => {
  it('counts seconds, then minutes and seconds', () => {
    expect(describeElapsed(0)).toBe('0s')
    expect(describeElapsed(14_400)).toBe('14s')
    expect(describeElapsed(65_000)).toBe('1m 05s')
    expect(describeElapsed(600_000)).toBe('10m 00s')
  })
})

describe('runningTool', () => {
  it('is null with nothing in flight', () => {
    expect(runningTool([])).toBeNull()
    expect(runningTool([entry(1, toolUse('a', 'Bash')), entry(2, toolResult('a'))])).toBeNull()
  })

  it('names the tool whose result has not arrived', () => {
    expect(runningTool([entry(1, toolUse('a', 'Bash'))])).toBe('Bash')
  })

  it('picks the unresolved one when several were issued together', () => {
    const entries = [
      entry(1, {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'a', name: 'Read', input: {} },
            { type: 'tool_use', id: 'b', name: 'Grep', input: {} }
          ]
        }
      }),
      entry(2, toolResult('a'))
    ]
    expect(runningTool(entries)).toBe('Grep')
  })

  it('shortens an MCP tool to its own name', () => {
    expect(runningTool([entry(1, toolUse('a', 'mcp__openroom-voice__speak'))])).toBe('speak')
  })

  it('looks no further back than the last prompt', () => {
    const entries = [
      entry(1, toolUse('old', 'Bash')),
      entry(2, { type: 'user', message: { content: 'next prompt' } })
    ]
    expect(runningTool(entries)).toBeNull()
  })
})

describe('turnStartedAt', () => {
  it('is the time stamped on the last prompt', () => {
    const entries = [
      { ...entry(1, { type: 'user', message: { content: 'first' } }), receivedAt: 1000 },
      entry(2, toolUse('a', 'Bash')),
      { ...entry(3, { type: 'user', message: { content: 'second' } }), receivedAt: 5000 },
      entry(4, toolUse('b', 'Read'))
    ]
    expect(turnStartedAt(entries, 99)).toBe(5000)
  })

  it('falls back when no prompt is in the live list', () => {
    expect(turnStartedAt([entry(1, toolUse('a', 'Bash'))], 99)).toBe(99)
    expect(turnStartedAt([], 99)).toBe(99)
  })
})
