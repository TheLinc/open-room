import { describe, expect, it } from 'vitest'
import type { Agent } from '@shared/agent'
import { sideQuestionOptions, speakableAnswer } from './side-question'

const agent = {
  config: {
    id: 'atlas',
    name: 'Atlas',
    model: 'claude-haiku-4-5',
    workspacePath: 'C:\\work\\repo',
    persistSession: true
  },
  context: '# Atlas\nYou own the CI pipeline.'
} as unknown as Agent

describe('sideQuestionOptions', () => {
  it('forks the conversation without persisting, so the aside reads the context and writes nothing', () => {
    const options = sideQuestionOptions(agent, 'sess-1', 'C:\\work\\repo', 'C:\\claude.exe')
    expect(options.resume).toBe('sess-1')
    expect(options.forkSession).toBe(true)
    expect(options.persistSession).toBe(false)
  })

  it('answers with no tools, one turn, and none of the machine settings', () => {
    const options = sideQuestionOptions(agent, 'sess-1', 'C:\\work\\repo', 'C:\\claude.exe')
    expect(options.allowedTools).toEqual([])
    expect(options.tools).toEqual([])
    expect(options.maxTurns).toBe(1)
    expect(options.settingSources).toEqual([])
  })

  it("runs in the conversation's checkout on the agent's model with its AGENT.md", () => {
    const options = sideQuestionOptions(agent, 'sess-1', 'D:\\worktree', 'C:\\claude.exe')
    expect(options.cwd).toBe('D:\\worktree')
    expect(options.model).toBe('claude-haiku-4-5')
    expect(options.pathToClaudeCodeExecutable).toBe('C:\\claude.exe')
    const prompt = options.systemPrompt as { type: 'preset'; append: string }
    expect(prompt.type).toBe('preset')
    expect(prompt.append).toContain('You own the CI pipeline.')
    expect(prompt.append).toMatch(/spoken/i)
  })

  it('asks a fresh question when the agent has no conversation yet', () => {
    const options = sideQuestionOptions(agent, null, 'C:\\work\\repo', 'C:\\claude.exe')
    expect(options.resume).toBeUndefined()
    expect(options.forkSession).toBeUndefined()
  })

  it('never carries an API key into the child', () => {
    const options = sideQuestionOptions(agent, null, 'C:\\work\\repo', 'C:\\claude.exe')
    expect(options.env).toBeDefined()
    expect(options.env?.ANTHROPIC_API_KEY).toBeUndefined()
  })
})

describe('speakableAnswer', () => {
  it('speaks a short plain answer as written', () => {
    expect(speakableAnswer('The tests are green and the branch is pushed.')).toBe(
      'The tests are green and the branch is pushed.'
    )
  })

  it('takes the first sentences of a long answer rather than reading it all', () => {
    const long = 'First sentence here. Second sentence here. ' + 'More words. '.repeat(40)
    const spoken = speakableAnswer(long)
    expect(spoken.length).toBeLessThanOrEqual(200)
    expect(spoken.startsWith('First sentence here.')).toBe(true)
  })

  it('flattens markdown and line breaks, since the answer is spoken not shown', () => {
    expect(speakableAnswer('**Yes.**\n- it passed\n- twice')).toBe('Yes. it passed twice')
  })
})
