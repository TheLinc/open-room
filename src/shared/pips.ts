import type { Agent } from './agent'
import { colorHexFor } from './agent-colors'
import type { AgentRuntime } from './agent-runtime'
import type { PipEntry } from './voice-input'

/** Order the HUD shows states in; the most stuck first. */
const STATE_ORDER: Record<PipEntry['state'], number> = {
  'needs-attention': 0,
  paused: 1,
  working: 2
}

/**
 * Which agents the HUD shows.
 *
 * A blocked agent appears whether or not it is working: an agent sitting on a
 * permission prompt while you assume it is busy is the worst failure this
 * design can produce, and with the main window closed it is otherwise
 * completely invisible. Those sort first for the same reason.
 *
 * `quotaReached` is account-wide rather than per-agent — every agent draws on
 * the same subscription — so it pauses all of them that have a live session.
 * They appear even when idle, because the failure it describes is precisely
 * that nothing is happening and nothing says why.
 *
 * The sort is stable, so pips keep their positions while unrelated runtimes
 * update. The cluster is on screen for minutes at a time and it is a click
 * target — reshuffling under the pointer would make it unusable.
 */
export function pipsFor(
  agents: Agent[],
  runtimes: AgentRuntime[],
  pendingPermissions: Set<string>,
  quotaReached = false
): PipEntry[] {
  const byId = new Map(agents.map((agent) => [agent.config.id, agent]))
  const entries: PipEntry[] = []

  for (const runtime of runtimes) {
    const agent = byId.get(runtime.agentId)
    if (!agent) continue

    const blocked = pendingPermissions.has(runtime.agentId)
    // A session that exists but cannot run is the case worth showing: with
    // the window hidden, a quota stall is otherwise indistinguishable from
    // an agent that simply has nothing to do.
    const hasSession = runtime.state === 'working' || runtime.state === 'ready'
    const paused = quotaReached && hasSession

    if (!blocked && !paused && runtime.state !== 'working') continue

    entries.push({
      agentId: runtime.agentId,
      name: agent.config.name,
      color: colorHexFor(agent.config.color),
      // Permission still wins: it is the one a person can clear right now.
      state: blocked ? 'needs-attention' : paused ? 'paused' : 'working'
    })
  }

  return entries.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state])
}
