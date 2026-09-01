import type { Agent } from '@shared/agent'
import { resolvePageRange, type Conversation, type ConversationPage } from '@shared/conversation'
import type { WorktreeMap, WorktreeRecord } from '@shared/worktrees'
import { hostSessions, type SessionApi } from './session-reader'

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
 *
 * A session's files live under a project key derived from its `cwd`, so every
 * call here takes a `dir`. A conversation that ran in its own git worktree
 * has that worktree as its `dir`, looked up from the agent's worktree
 * records; everything else is the workspace.
 */

export const AGENT_TAG_PREFIX = 'open-room:'

export function agentTag(agentId: string): string {
  return `${AGENT_TAG_PREFIX}${agentId}`
}

/** What the store needs to know about worktrees; `WorktreeManager` provides it. */
export type WorktreeLookup = {
  records(agentId: string): Promise<WorktreeMap>
  recordFor(agentId: string, sessionId: string): Promise<WorktreeRecord | null>
}

export class ConversationStore {
  constructor(
    private readonly worktrees: WorktreeLookup | null = null,
    private readonly sessionsFor: (agent: Agent) => SessionApi = () => hostSessions
  ) {}

  /**
   * Conversations belonging to this agent, newest first.
   *
   * A workspace may also hold sessions from terminal Claude Code or from
   * another agent pointed at the same folder; the tag filter keeps those out,
   * since mixing personas would break the model the UI presents.
   *
   * Worktree sessions are found two ways on purpose. `includeWorktrees` has
   * the SDK walk `git worktree list`, which covers every worktree still
   * attached to the repository; the recorded paths are listed as well, so a
   * conversation whose worktree was pruned by hand does not vanish from the
   * switcher — its transcript is still on disk, keyed by that path.
   */
  async list(agent: Agent): Promise<Conversation[]> {
    if (!agent.config.persistSession) return []

    const dirs = new Set<string>([agent.config.workspacePath])
    const records = this.worktrees ? await this.worktrees.records(agent.config.id) : {}
    for (const record of Object.values(records)) dirs.add(record.path)

    const api = this.sessionsFor(agent)
    const seen = new Set<string>()
    const conversations: Conversation[] = []
    for (const dir of dirs) {
      const sessions = await api
        .listSessions({
          dir,
          limit: 100,
          includeWorktrees: dir === agent.config.workspacePath
        })
        .catch(() => [])

      for (const session of sessions) {
        if (session.tag !== agentTag(agent.config.id) || seen.has(session.sessionId)) continue
        seen.add(session.sessionId)
        conversations.push({
          sessionId: session.sessionId,
          // `firstPrompt` is preferred over `summary` deliberately. The SDK's
          // summary tracks the latest prompt, so a conversation renames itself
          // as it goes and two conversations can end up sharing a title. How a
          // conversation started is both stable and how people recall it.
          title: session.customTitle || session.firstPrompt || session.summary || 'Untitled',
          lastModified: session.lastModified,
          createdAt: session.createdAt
        })
      }
    }

    return conversations.sort((a, b) => b.lastModified - a.lastModified)
  }

  /** Marks a session as this agent's, so `list` can find it later. */
  async claim(agent: Agent, sessionId: string): Promise<void> {
    if (!agent.config.persistSession) return
    await this.sessionsFor(agent)
      .tagSession(sessionId, agentTag(agent.config.id), {
        dir: await this.dirFor(agent, sessionId)
      })
      .catch(() => {
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
    const all = await this.sessionsFor(agent)
      .getSessionMessages(sessionId, {
        dir: await this.dirFor(agent, sessionId)
      })
      .catch(() => [])

    const total = all.length
    const { start, end } = resolvePageRange(total, options)

    return { sessionId, total, offset: start, messages: all.slice(start, end) }
  }

  async rename(agent: Agent, sessionId: string, title: string): Promise<void> {
    await this.sessionsFor(agent).renameSession(sessionId, title, {
      dir: await this.dirFor(agent, sessionId)
    })
  }

  async remove(agent: Agent, sessionId: string): Promise<void> {
    await this.sessionsFor(agent).deleteSession(sessionId, {
      dir: await this.dirFor(agent, sessionId)
    })
  }

  async removeAll(agent: Agent): Promise<void> {
    const conversations = await this.list(agent)
    // Sequential rather than parallel: these mutate a shared projects
    // directory, and a partial failure should not leave the rest unattempted.
    for (const conversation of conversations) {
      await this.remove(agent, conversation.sessionId).catch(() => {})
    }
  }

  /** The project directory a session's files are keyed by. */
  async dirFor(agent: Agent, sessionId: string): Promise<string> {
    const record = this.worktrees
      ? await this.worktrees.recordFor(agent.config.id, sessionId)
      : null
    return record?.path ?? agent.config.workspacePath
  }
}
