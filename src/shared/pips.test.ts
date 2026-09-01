import { describe, expect, it } from 'vitest'
import type { Agent } from './agent'
import { emptyRuntime, type AgentRuntime, type PermissionRequest } from './agent-runtime'
import { pipsFor } from './pips'

// `color` is an identity colour id from AGENT_COLORS, not a hex string.
const agent = (id: string, name: string, color: string): Agent =>
  ({ config: { id, name, color }, context: '' }) as unknown as Agent

const runtime = (agentId: string, state: AgentRuntime['state']): AgentRuntime => ({
  ...emptyRuntime(agentId),
  state
})

const asking = (agentId: string, text: string, since = 1): AgentRuntime => ({
  ...emptyRuntime(agentId),
  state: 'ready',
  awaiting: { text, since }
})

const permission = (
  agentId: string,
  input: Record<string, unknown> = { command: 'git push' },
  canRemember = false
): PermissionRequest => ({
  id: `req-${agentId}`,
  agentId,
  toolName: 'Bash',
  input,
  canRemember
})

describe('pipsFor', () => {
  const agents = [agent('atlas', 'Atlas', 'cyan'), agent('scout', 'Scout', 'amber')]

  it('includes only agents that are working', () => {
    const pips = pipsFor(agents, [runtime('atlas', 'working'), runtime('scout', 'ready')], [])

    expect(pips.map((p) => p.agentId)).toEqual(['atlas'])
  })

  it('marks an agent with a pending permission request as needing attention', () => {
    const pips = pipsFor(agents, [runtime('atlas', 'working')], [permission('atlas')])

    expect(pips[0].state).toBe('needs-attention')
  })

  it('includes a blocked agent even when it is not working', () => {
    // An agent sitting on a permission prompt reports `ready`, not `working`.
    // Dropping it would make the one agent that needs you the one you cannot
    // see.
    const pips = pipsFor(agents, [runtime('scout', 'ready')], [permission('scout')])

    expect(pips.map((p) => p.agentId)).toEqual(['scout'])
    expect(pips[0].state).toBe('needs-attention')
  })

  it('carries the permission so the HUD can answer it in place', () => {
    const pips = pipsFor(
      agents,
      [runtime('scout', 'ready')],
      [permission('scout', { command: 'git push origin main' }, true)]
    )

    expect(pips[0].permission).toEqual({
      id: 'req-scout',
      summary: 'git push origin main',
      canRemember: true
    })
  })

  it('carries no permission on an agent that is merely working', () => {
    const pips = pipsFor(agents, [runtime('atlas', 'working')], [])

    expect(pips[0].permission).toBeUndefined()
  })

  it('carries the name and resolves the identity colour to hex for the roster', () => {
    const pips = pipsFor(agents, [runtime('scout', 'working')], [])

    expect(pips[0]).toMatchObject({ name: 'Scout', color: '#f59e0b' })
  })

  it('puts agents needing attention first', () => {
    const pips = pipsFor(
      agents,
      [runtime('atlas', 'working'), runtime('scout', 'working')],
      [permission('scout')]
    )

    expect(pips.map((p) => p.agentId)).toEqual(['scout', 'atlas'])
  })

  it('keeps a stable order among agents in the same state', () => {
    // The cluster is on screen for minutes; pips reshuffling under the pointer
    // as unrelated runtimes update would make it unclickable.
    const pips = pipsFor(agents, [runtime('atlas', 'working'), runtime('scout', 'working')], [])

    expect(pips.map((p) => p.agentId)).toEqual(['atlas', 'scout'])
  })

  it('ignores a runtime whose agent no longer exists', () => {
    const pips = pipsFor(agents, [runtime('deleted', 'working')], [])

    expect(pips).toEqual([])
  })

  it('is empty when nothing is happening', () => {
    expect(pipsFor(agents, [runtime('atlas', 'ready')], [])).toEqual([])
  })

  it('does not show a starting agent, which has nothing to report yet', () => {
    expect(pipsFor(agents, [runtime('atlas', 'starting')], [])).toEqual([])
  })
})

describe('pipsFor with an agent waiting for a reply', () => {
  const agents = [agent('atlas', 'Atlas', 'cyan'), agent('scout', 'Scout', 'amber')]

  it('shows an idle agent that asked a question, with the question', () => {
    // The agent spoke its question and ended the turn. It reports `ready`,
    // which is exactly what an agent with nothing to say reports.
    const pips = pipsFor(agents, [asking('scout', 'Ship the branch?')], [])

    expect(pips).toHaveLength(1)
    expect(pips[0]).toMatchObject({
      agentId: 'scout',
      state: 'asking',
      question: 'Ship the branch?'
    })
  })

  it('sorts a question after a permission prompt and before everything else', () => {
    const pips = pipsFor(
      agents,
      [runtime('atlas', 'working'), asking('scout', 'Ship it?')],
      [permission('atlas')]
    )
    expect(pips.map((p) => [p.agentId, p.state])).toEqual([
      ['atlas', 'needs-attention'],
      ['scout', 'asking']
    ])

    const paused = pipsFor(
      agents,
      [runtime('atlas', 'ready'), asking('scout', 'Ship it?')],
      [],
      true
    )
    expect(paused.map((p) => p.state)).toEqual(['asking', 'paused'])
  })

  it('lets a permission prompt win over a stale question on the same agent', () => {
    // A prompt is the thing blocking the agent right now; the question can be
    // answered once it is unblocked.
    const pips = pipsFor(agents, [asking('scout', 'Ship it?')], [permission('scout')])

    expect(pips[0].state).toBe('needs-attention')
    expect(pips[0].question).toBeUndefined()
  })
})

describe('pipsFor under account quota', () => {
  const agents = [agent('atlas', 'Atlas', 'cyan'), agent('scout', 'Scout', 'amber')]

  it('shows an idle-but-ready agent as paused', () => {
    // The failure this exists for: with the window hidden, an agent stalled
    // on quota looks exactly like one with nothing to do.
    const pips = pipsFor(agents, [runtime('atlas', 'ready')], [], true)

    expect(pips).toHaveLength(1)
    expect(pips[0].state).toBe('paused')
  })

  it('leaves agents with no session alone', () => {
    // Nothing was going to happen for these anyway, so pausing them would be
    // noise rather than news.
    const pips = pipsFor(agents, [runtime('atlas', 'idle')], [], true)
    expect(pips).toEqual([])
  })

  it('does not pause anything while quota is fine', () => {
    const pips = pipsFor(agents, [runtime('atlas', 'ready')], [], false)
    expect(pips).toEqual([])
  })

  it('keeps a permission prompt ahead of a quota pause', () => {
    // A permission is something the user can clear right now; quota is not.
    const pips = pipsFor(
      agents,
      [runtime('atlas', 'working'), runtime('scout', 'working')],
      [permission('scout')],
      true
    )

    expect(pips.map((p) => [p.agentId, p.state])).toEqual([
      ['scout', 'needs-attention'],
      ['atlas', 'paused']
    ])
  })
})
