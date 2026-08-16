import {
  deleteSession,
  getSessionMessages,
  listSessions,
  renameSession,
  tagSession
} from '@anthropic-ai/claude-agent-sdk'
import type { Agent } from '@shared/agent'
import { resolvePageRange, type Conversation, type ConversationPage } from '@shared/conversation'

/**
 * Reads and manages an agent's conversations.
 *
 * Built entirely on the SDK's own session functions rather than parsing the
 * JSONL transcripts directly — those are Claude Code's format to change, and
 * `listSessions` / `getSessionMessages` exist for exactly this.
 *
 * Sessions are scoped to an agent by **tag**, not by title. Titles are the
 * user's to rename, so keying off them would make a renamed conversation
 * vanish from its agent. Tags are separate metadata and survive a rename.
 */

export const AGENT_TAG_PREFIX = 'open-room:'

export function agentTag(agentId: string): string {
  return `${AGENT_TAG_PREFIX}${agentId}`
}

export class ConversationStore {
  /**
   * Conversations belonging to this agent, newest first.
   *
   * A workspace may also hold sessions from terminal Claude Code or from
   * another agent pointed at the same folder; the tag filter keeps those out,
   * since mixing personas would break the model the UI presents.
   */
  async list(agent: Agent): Promise<Conversation[]> {
    if (!agent.config.persistSession) return []

    const sessions = await listSessions({
      dir: agent.config.workspacePath,
      limit: 100,
      includeWorktrees: false
    }).catch(() => [])

    return sessions
      .filter((session) => session.tag === agentTag(agent.config.id))
      .map((session) => ({
        sessionId: session.sessionId,
        // `firstPrompt` is preferred over `summary` deliberately. The SDK's
        // summary tracks the latest prompt, so a conversation renames itself
        // as it goes and two conversations can end up sharing a title. How a
        // conversation started is both stable and how people recall it.
        title: session.customTitle || session.firstPrompt || session.summary || 'Untitled',
        lastModified: session.lastModified,
        createdAt: session.createdAt
      }))
      .sort((a, b) => b.lastModified - a.lastModified)
  }

  /** Marks a session as this agent's, so `list` can find it later. */
  async claim(agent: Agent, sessionId: string): Promise<void> {
    if (!agent.config.persistSession) return
    await tagSession(sessionId, agentTag(agent.config.id), {
      dir: agent.config.workspacePath
    }).catch(() => {
      // A session that cannot be tagged still works; it just will not appear
      // in the switcher. Not worth failing a turn over.
    })
  }

  /**
   * Loads a slice of a conversation.
   *
   * The SDK paginates from the start, so reaching the tail needs the total
   * first. Reading the whole transcript from disk is cheap; *rendering* it is
   * what janks, so the full read happens here and only a bounded slice
   * crosses IPC.
   */
  async page(
    agent: Agent,
    sessionId: string,
    options: { limit: number; offset?: number }
  ): Promise<ConversationPage> {
    const all = await getSessionMessages(sessionId, {
      dir: agent.config.workspacePath
    }).catch(() => [])

    const total = all.length
    const { start, end } = resolvePageRange(total, options)

    return { sessionId, total, offset: start, messages: all.slice(start, end) }
  }

  async rename(agent: Agent, sessionId: string, title: string): Promise<void> {
    await renameSession(sessionId, title, { dir: agent.config.workspacePath })
  }

  async remove(agent: Agent, sessionId: string): Promise<void> {
    await deleteSession(sessionId, { dir: agent.config.workspacePath })
  }

  async removeAll(agent: Agent): Promise<void> {
    const conversations = await this.list(agent)
    // Sequential rather than parallel: these mutate a shared projects
    // directory, and a partial failure should not leave the rest unattempted.
    for (const conversation of conversations) {
      await this.remove(agent, conversation.sessionId).catch(() => {})
    }
  }
}
