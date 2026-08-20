import { describe, expect, it } from 'vitest'
import type { Agent } from './agent'
import { emptyRuntime, type AgentRuntime } from './agent-runtime'
import { pipsFor } from './pips'

// `color` is an identity colour id from AGENT_COLORS, not a hex string.
const agent = (id: string, name: string, color: string): Agent =>
  ({ config: { id, name, color }, context: '' }) as unknown as Agent

const runtime = (agentId: string, state: AgentRuntime['state']): AgentRuntime => ({
  ...emptyRuntime(agentId),
  state
})

describe('pipsFor', () => {
  const agents = [agent('atlas', 'Atlas', 'cyan'), agent('scout', 'Scout', 'amber')]

  it('includes only agents that are working', () => {
    const pips = pipsFor(
      agents,
      [runtime('atlas', 'working'), runtime('scout', 'ready')],
      new Set()
    )

    expect(pips.map((p) => p.agentId)).toEqual(['atlas'])
  })

  it('marks an agent with a pending permission request as needing attention', () => {
    const pips = pipsFor(agents, [runtime('atlas', 'working')], new Set(['atlas']))

    expect(pips[0].state).toBe('needs-attention')
  })

  it('includes a blocked agent even when it is not working', () => {
    // An agent sitting on a permission prompt reports `ready`, not `working`.
    // Dropping it would make the one agent that needs you the one you cannot
    // see.
    const pips = pipsFor(agents, [runtime('scout', 'ready')], new Set(['scout']))

    expect(pips.map((p) => p.agentId)).toEqual(['scout'])
    expect(pips[0].state).toBe('needs-attention')
  })

  it('carries the name and resolves the identity colour to hex for the roster', () => {
    const pips = pipsFor(agents, [runtime('scout', 'working')], new Set())

    expect(pips[0]).toMatchObject({ name: 'Scout', color: '#f59e0b' })
  })

  it('puts agents needing attention first', () => {
    const pips = pipsFor(
      agents,
      [runtime('atlas', 'working'), runtime('scout', 'working')],
      new Set(['scout'])
    )

    expect(pips.map((p) => p.agentId)).toEqual(['scout', 'atlas'])
  })

  it('keeps a stable order among agents in the same state', () => {
    // The cluster is on screen for minutes; pips reshuffling under the pointer
    // as unrelated runtimes update would make it unclickable.
    const pips = pipsFor(
      agents,
      [runtime('atlas', 'working'), runtime('scout', 'working')],
      new Set()
    )

    expect(pips.map((p) => p.agentId)).toEqual(['atlas', 'scout'])
  })

  it('ignores a runtime whose agent no longer exists', () => {
    const pips = pipsFor(agents, [runtime('deleted', 'working')], new Set())

    expect(pips).toEqual([])
  })

  it('is empty when nothing is happening', () => {
    expect(pipsFor(agents, [runtime('atlas', 'ready')], new Set())).toEqual([])
  })

  it('does not show a starting agent, which has nothing to report yet', () => {
    expect(pipsFor(agents, [runtime('atlas', 'starting')], new Set())).toEqual([])
  })
})

describe('pipsFor under account quota', () => {
  const agents = [agent('atlas', 'Atlas', 'cyan'), agent('scout', 'Scout', 'amber')]

  it('shows an idle-but-ready agent as paused', () => {
    // The failure this exists for: with the window hidden, an agent stalled
    // on quota looks exactly like one with nothing to do.
    const pips = pipsFor(agents, [runtime('atlas', 'ready')], new Set(), true)

    expect(pips).toHaveLength(1)
    expect(pips[0].state).toBe('paused')
  })

  it('leaves agents with no session alone', () => {
    // Nothing was going to happen for these anyway, so pausing them would be
    // noise rather than news.
    const pips = pipsFor(agents, [runtime('atlas', 'idle')], new Set(), true)
    expect(pips).toEqual([])
  })

  it('does not pause anything while quota is fine', () => {
    const pips = pipsFor(agents, [runtime('atlas', 'ready')], new Set(), false)
    expect(pips).toEqual([])
  })

  it('keeps a permission prompt ahead of a quota pause', () => {
    // A permission is something the user can clear right now; quota is not.
    const pips = pipsFor(
      agents,
      [runtime('atlas', 'working'), runtime('scout', 'working')],
      new Set(['scout']),
      true
    )

    expect(pips.map((p) => [p.agentId, p.state])).toEqual([
      ['scout', 'needs-attention'],
      ['atlas', 'paused']
    ])
  })
})
