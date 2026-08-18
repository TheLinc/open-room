import type { Agent } from './agent'
import { colorHexFor } from './agent-colors'
import type { AgentRuntime } from './agent-runtime'
import type { PipEntry } from './voice-input'

/**
 * Which agents the HUD shows.
 *
 * A blocked agent appears whether or not it is working: an agent sitting on a
 * permission prompt while you assume it is busy is the worst failure this
 * design can produce, and with the main window closed it is otherwise
 * completely invisible. Those sort first for the same reason.
 *
 * The sort is stable, so pips keep their positions while unrelated runtimes
 * update. The cluster is on screen for minutes at a time and it is a click
 * target — reshuffling under the pointer would make it unusable.
 */
export function pipsFor(
  agents: Agent[],
  runtimes: AgentRuntime[],
  pendingPermissions: Set<string>
): PipEntry[] {
  const byId = new Map(agents.map((agent) => [agent.config.id, agent]))
  const entries: PipEntry[] = []

  for (const runtime of runtimes) {
    const agent = byId.get(runtime.agentId)
    if (!agent) continue

    const blocked = pendingPermissions.has(runtime.agentId)
    if (!blocked && runtime.state !== 'working') continue

    entries.push({
      agentId: runtime.agentId,
      name: agent.config.name,
      color: colorHexFor(agent.config.color),
      state: blocked ? 'needs-attention' : 'working'
    })
  }

  return entries.sort((a, b) => {
    if (a.state === b.state) return 0
    return a.state === 'needs-attention' ? -1 : 1
  })
}
