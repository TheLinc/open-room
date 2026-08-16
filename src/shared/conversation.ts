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
