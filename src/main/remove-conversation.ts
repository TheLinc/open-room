import type { Agent } from '@shared/agent'

/**
 * The one way a conversation leaves the disk.
 *
 * Shared by the switcher's delete and the archive sweeper, so both take the
 * same care: a live session on that conversation is stopped first, the
 * transcript goes before the worktree (it is keyed by the worktree's path,
 * and releasing the worktree first would leave it unreachable), the
 * worktree is released without force so uncommitted work is refused and
 * kept, and the archive record is dropped whichever way the rest went.
 *
 * Returns the worktree's "kept" message, if git refused, for the caller to
 * surface as it sees fit.
 */
export type RemovalDeps = {
  read(agentId: string): Promise<Agent>
  activeConversationId(agentId: string): string | null
  stop(agentId: string): Promise<void>
  clearActive(agentId: string): void
  removeTranscript(agent: Agent, sessionId: string): Promise<void>
  releaseWorktree: ((agent: Agent, sessionId: string) => Promise<{ message: string | null }>) | null
  forgetArchive: ((agentId: string, sessionId: string) => Promise<void>) | null
}

export async function removeConversation(
  deps: RemovalDeps,
  agentId: string,
  sessionId: string
): Promise<string | null> {
  const agent = await deps.read(agentId)
  if (deps.activeConversationId(agentId) === sessionId) {
    await deps.stop(agentId)
    deps.clearActive(agentId)
  }
  try {
    await deps.removeTranscript(agent, sessionId)
    return deps.releaseWorktree ? (await deps.releaseWorktree(agent, sessionId)).message : null
  } finally {
    await deps.forgetArchive?.(agentId, sessionId)
  }
}
