/**
 * Conversations are the unit Open Room presents: one conversation is one
 * Claude Code session, owned by an agent, persisting across restarts.
 *
 * This is what makes the app a conversational layer rather than a task
 * launcher — a persona that forgot everything between launches would not be
 * conversational at all.
 */

export type Conversation = {
  sessionId: string
  /** User-set title, else the SDK's summary, else the first prompt. */
  title: string
  /** Epoch ms. */
  lastModified: number
  createdAt?: number
}

/** A bounded slice of a conversation's transcript. */
export type ConversationPage = {
  sessionId: string
  /** Total messages in the conversation, for "load earlier" arithmetic. */
  total: number
  /** Index of the first message in `messages`. */
  offset: number
  /** Raw SDK message objects, rendered verbatim. */
  messages: unknown[]
}

/** How many messages a pane loads at a time. */
export const CONVERSATION_PAGE_SIZE = 60

/**
 * Resolves which slice of a transcript to return.
 *
 * The SDK paginates from the start, so landing on the tail — what a chat pane
 * wants on open — has to be computed from the total. Extracted from the store
 * so the arithmetic is testable without touching the filesystem.
 */
export function resolvePageRange(
  total: number,
  options: { limit: number; offset?: number }
): { start: number; end: number } {
  const limit = Math.max(1, options.limit)
  // No offset means "the most recent slice".
  const wanted = options.offset ?? total - limit
  const start = Math.min(Math.max(0, wanted), Math.max(0, total))
  return { start, end: Math.min(start + limit, total) }
}

export function describeLastActive(lastModified: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - lastModified) / 1000))

  if (seconds < 60) return 'just now'
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  if (seconds < 86_400) {
    const hours = Math.round(seconds / 3600)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }

  const days = Math.round(seconds / 86_400)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * Which conversation an agent should land in when its pane opens, or null
 * to leave things as they are.
 *
 * Only an idle agent with nothing chosen yet, and only once per agent, so
 * this cannot fight a user's choice or tear down a session mid-turn. The
 * list must have been loaded *for this agent*: it refreshes asynchronously
 * after the selected agent changes, and for a moment it is still the
 * previous agent's. Selecting from it during that window handed one agent
 * another's session id — measured: the second agent's turn was appended
 * to the first agent's transcript file, with the first agent's context.
 */
export function autoSelectTarget(input: {
  agentId: string | null
  /** The agent the list was fetched for. */
  listedFor: string | null
  conversations: Conversation[]
  activeId: string | null
  state: string
  /** The agent this already fired for, if any. */
  alreadyFor: string | null
}): string | null {
  const { agentId, listedFor, conversations, activeId, state, alreadyFor } = input
  if (!agentId || listedFor !== agentId) return null
  if (activeId || conversations.length === 0) return null
  if (state !== 'idle') return null
  if (alreadyFor === agentId) return null
  return conversations[0].sessionId
}
