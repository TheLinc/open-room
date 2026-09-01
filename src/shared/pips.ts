import type { Agent } from './agent'
import { colorHexFor } from './agent-colors'
import type { AgentRuntime, PermissionRequest } from './agent-runtime'
import { permissionSummary } from './permission-detail'
import type { PipEntry } from './voice-input'

/** Order the HUD shows states in; the most stuck first. */
const STATE_ORDER: Record<PipEntry['state'], number> = {
  'needs-attention': 0,
  asking: 1,
  paused: 2,
  working: 3
}

/**
 * Which agents the HUD shows.
 *
 * A blocked agent appears whether or not it is working: an agent sitting on a
 * permission prompt while you assume it is busy is the worst failure this
 * design can produce, and with the main window closed it is otherwise
 * completely invisible. Those sort first for the same reason, and carry the
 * prompt itself so the roster can answer it without raising the window.
 *
 * An agent waiting on a reply to a spoken question is the same failure one
 * notch down: idle, `ready`, and indistinguishable from one with nothing to
 * do. It appears with the question, after any permission prompt — a prompt
 * blocks the agent right now, the question can be answered once it is free.
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
  pendingPermissions: PermissionRequest[],
  quotaReached = false
): PipEntry[] {
  const byId = new Map(agents.map((agent) => [agent.config.id, agent]))
  const entries: PipEntry[] = []

  for (const runtime of runtimes) {
    const agent = byId.get(runtime.agentId)
    if (!agent) continue

    // The SDK awaits one permission at a time per session, so there is at
    // most one; the first is the one blocking the turn.
    const request = pendingPermissions.find((p) => p.agentId === runtime.agentId)
    const asking = runtime.awaiting
    // A session that exists but cannot run is the case worth showing: with
    // the window hidden, a quota stall is otherwise indistinguishable from
    // an agent that simply has nothing to do.
    const hasSession = runtime.state === 'working' || runtime.state === 'ready'
    const paused = quotaReached && hasSession

    if (!request && !asking && !paused && runtime.state !== 'working') continue

    const base = {
      agentId: runtime.agentId,
      name: agent.config.name,
      color: colorHexFor(agent.config.color)
    }

    // Permission still wins: it is the one a person can clear right now.
    if (request) {
      entries.push({
        ...base,
        state: 'needs-attention',
        permission: {
          id: request.id,
          summary: permissionSummary(request),
          canRemember: request.canRemember
        }
      })
    } else if (asking) {
      entries.push({ ...base, state: 'asking', question: asking.text })
    } else {
      entries.push({ ...base, state: paused ? 'paused' : 'working' })
    }
  }

  return entries.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state])
}
