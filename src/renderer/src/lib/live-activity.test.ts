import { describe, expect, it } from 'vitest'
import type { TranscriptEntry } from '@shared/agent-runtime'
import { describeToolUse, liveActivityLabel, pastRunLabel } from './live-activity'

let seq = 0
function entry(message: unknown): TranscriptEntry {
  seq += 1
  return { agentId: 'atlas', seq, receivedAt: 0, message }
}
const use = (name: string, input: Record<string, unknown>, id = `t${seq + 1}`, parent?: string) =>
  entry({
    type: 'assistant',
    parent_tool_use_id: parent ?? null,
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }
  })
const result = (id: string) =>
  entry({
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id }] }
  })
const thinking = () =>
  entry({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }] }
  })

describe('describeToolUse', () => {
  it('reads each common tool as a present-tense line while it runs', () => {
    expect(describeToolUse({ name: 'Bash', input: { command: 'npm test' } }, true)).toBe(
      'Running `npm test`'
    )
    expect(describeToolUse({ name: 'Read', input: { file_path: 'src/a.ts' } }, true)).toBe(
      'Reading src/a.ts'
    )
    expect(describeToolUse({ name: 'Edit', input: { file_path: 'src/a.ts' } }, true)).toBe(
      'Editing src/a.ts'
    )
    expect(describeToolUse({ name: 'Write', input: { file_path: 'src/b.ts' } }, true)).toBe(
      'Writing src/b.ts'
    )
    expect(describeToolUse({ name: 'Grep', input: { pattern: 'foo' } }, true)).toBe(
      'Searching for foo'
    )
    expect(describeToolUse({ name: 'Glob', input: { pattern: '**/*.ts' } }, true)).toBe(
      'Searching for **/*.ts'
    )
    expect(describeToolUse({ name: 'Skill', input: { skill: 'unslop' } }, true)).toBe(
      'Using skill unslop'
    )
    expect(describeToolUse({ name: 'Task', input: { description: 'Audit tests' } }, true)).toBe(
      'Running subagent: Audit tests'
    )
    expect(describeToolUse({ name: 'WebFetch', input: { url: 'https://x.y/z' } }, true)).toBe(
      'Fetching https://x.y/z'
    )
    expect(describeToolUse({ name: 'WebSearch', input: { query: 'vitest' } }, true)).toBe(
      'Searching the web for vitest'
    )
  })

  it('reads the same tools in the past tense once they have answered', () => {
    expect(describeToolUse({ name: 'Bash', input: { command: 'npm test' } }, false)).toBe(
      'Ran `npm test`'
    )
    expect(describeToolUse({ name: 'Read', input: { file_path: 'src/a.ts' } }, false)).toBe(
      'Read src/a.ts'
    )
    expect(describeToolUse({ name: 'Skill', input: { skill: 'unslop' } }, false)).toBe(
      'Used skill unslop'
    )
  })

  it('names an MCP tool by the tool alone, and an unknown tool by its name', () => {
    expect(describeToolUse({ name: 'mcp__openroom-voice__speak', input: {} }, true)).toBe(
      'Calling speak'
    )
    expect(
      describeToolUse({ name: 'NotebookEdit', input: { notebook_path: 'n.ipynb' } }, true)
    ).toBe('Editing n.ipynb')
    expect(describeToolUse({ name: 'Mystery', input: {} }, true)).toBe('Running Mystery')
  })

  it('shortens a long command and never carries a line break', () => {
    const command = 'echo ' + 'a'.repeat(200) + '\nsecond line'
    const line = describeToolUse({ name: 'Bash', input: { command } }, true)
    expect(line.length).toBeLessThan(90)
    expect(line).not.toContain('\n')
    expect(line.endsWith('…`')).toBe(true)
  })
})

describe('pastRunLabel', () => {
  it('counts calls, not entries, and reads a call-less run as thinking', () => {
    expect(pastRunLabel([use('Bash', { command: 'ls' }, 'b1'), result('b1')])).toBe('1 call')
    expect(
      pastRunLabel([
        use('Read', { file_path: 'a' }, 'r1'),
        result('r1'),
        use('Read', { file_path: 'b' }, 'r2')
      ])
    ).toBe('2 calls')
    expect(pastRunLabel([thinking()])).toBe('Thought')
    expect(pastRunLabel([use('Read', { file_path: 'inner' }, 'i', 'task1')])).toBe('Thought')
  })
})

describe('liveActivityLabel', () => {
  it('names the latest top-level call, present tense while it is pending', () => {
    const run = [
      thinking(),
      use('Read', { file_path: 'a.ts' }, 'r1'),
      result('r1'),
      use('Bash', { command: 'ls' }, 'b1')
    ]
    expect(liveActivityLabel(run)).toBe('Running `ls`')
  })

  it('keeps naming the latest call, past tense, once it has answered', () => {
    const run = [use('Bash', { command: 'ls' }, 'b1'), result('b1')]
    expect(liveActivityLabel(run)).toBe('Ran `ls`')
  })

  it('says Thinking when the run has no tool call yet', () => {
    expect(liveActivityLabel([thinking()])).toBe('Thinking')
  })

  it('counts subagents still working and ignores their own calls', () => {
    const run = [
      use('Task', { description: 'Audit tests' }, 'task1'),
      use('Task', { description: 'Audit docs' }, 'task2'),
      use('Read', { file_path: 'inner.ts' }, 'inner', 'task1'),
      result('task2')
    ]
    expect(liveActivityLabel(run)).toBe('Ran subagent: Audit docs · 1 subagent working')
  })

  it('pluralises the subagent count', () => {
    const run = [
      use('Task', { description: 'A' }, 'task1'),
      use('Task', { description: 'B' }, 'task2'),
      use('Bash', { command: 'ls' }, 'b1')
    ]
    expect(liveActivityLabel(run)).toBe('Running `ls` · 2 subagents working')
  })
})
