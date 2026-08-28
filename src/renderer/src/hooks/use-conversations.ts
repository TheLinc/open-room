import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentRuntime, TranscriptEntry } from '@shared/agent-runtime'
import { CONVERSATION_PAGE_SIZE, type Conversation } from '@shared/conversation'

const EMPTY_CONVERSATIONS: Conversation[] = []

export type ConversationsApi = {
  conversations: Conversation[]
  active: Conversation | null
  /** Persisted history, newest last, shaped for the transcript renderer. */
  history: TranscriptEntry[]
  /** True when older messages exist above what is loaded. */
  hasEarlier: boolean
  loadingEarlier: boolean
  loadEarlier: () => Promise<void>
  select: (sessionId: string) => Promise<void>
  startNew: () => Promise<void>
  rename: (sessionId: string, title: string) => Promise<void>
  remove: (sessionId: string) => Promise<void>
  clearAll: () => Promise<void>
  refresh: () => Promise<void>
}

/**
 * Loads an agent's conversations and the transcript of the active one.
 *
 * Persisted history and live streaming are kept separate: history is read
 * from the session file on disk, live entries arrive over IPC during a turn.
 * The pane renders history, then a resumed-here divider, then live entries.
 */
export function useConversations(
  agentId: string | null,
  runtime: AgentRuntime,
  persistSession: boolean
): ConversationsApi {
  /**
   * The list, stamped with the agent it was fetched for. The fetch is async,
   * so after switching agents this briefly holds the previous agent's
   * conversations; deriving from the stamp keeps them from being shown or —
   * worse — auto-selected for the wrong agent.
   */
  const [listed, setListed] = useState<{ agentId: string; list: Conversation[] } | null>(null)
  const conversations = listed && listed.agentId === agentId ? listed.list : EMPTY_CONVERSATIONS
  const [loadingEarlier, setLoadingEarlier] = useState(false)

  /**
   * Loaded history, stamped with the conversation it came from.
   *
   * Keeping the id alongside the entries lets the render derive whether they
   * are still relevant. Clearing them in an effect instead would briefly show
   * the previous conversation's transcript under the newly selected one.
   */
  const [loaded, setLoaded] = useState<{
    sessionId: string
    total: number
    offset: number
    entries: TranscriptEntry[]
  } | null>(null)

  const activeId = runtime.activeConversationId
  const active = conversations.find((c) => c.sessionId === activeId) ?? null

  /**
   * Synchronous re-entry guard for pagination.
   *
   * `loadingEarlier` state exists for the UI, but it updates on the next
   * render — several scroll events in one frame would all pass a state-based
   * check and fire overlapping fetches for the same page.
   */
  const fetching = useRef(false)

  const refresh = useCallback(async () => {
    if (!agentId || !persistSession) {
      setListed(null)
      return
    }
    const list = await window.openRoom.listConversations(agentId)
    setListed({ agentId, list })
  }, [agentId, persistSession])

  useEffect(() => {
    // Loading external data on mount is what effects are for; `refresh` awaits
    // before it sets anything, which the rule cannot see across.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  // Landing in the most recent conversation on open is main's decision, made
  // on `selectAgent`; the runtime's activeConversationId is what arrives here.

  /**
   * Persisted messages are wrapped in the same envelope live entries use, so
   * one renderer handles both. Sequence numbers run negative to guarantee
   * they never collide with live ones, which start at 1.
   */
  const wrap = useCallback(
    (messages: unknown[], startIndex: number, agent: string): TranscriptEntry[] =>
      messages.map((message, i) => ({
        agentId: agent,
        seq: -(startIndex + messages.length - i),
        receivedAt: 0,
        message
      })),
    []
  )

  useEffect(() => {
    if (!agentId || !activeId) return
    let cancelled = false

    void window.openRoom
      .loadConversation(agentId, activeId, { limit: CONVERSATION_PAGE_SIZE })
      .then((page) => {
        if (cancelled) return
        setLoaded({
          sessionId: activeId,
          total: page.total,
          offset: page.offset,
          entries: wrap(page.messages, page.offset, agentId)
        })
      })

    return () => {
      cancelled = true
    }
  }, [agentId, activeId, wrap])

  // Only render history that belongs to the conversation currently selected.
  const current = loaded && loaded.sessionId === activeId ? loaded : null
  const history = current?.entries ?? []
  const offset = current?.offset ?? 0
  const total = current?.total ?? 0

  const loadEarlier = useCallback(async () => {
    if (!agentId || !activeId || offset === 0) return
    if (fetching.current) return

    fetching.current = true
    setLoadingEarlier(true)
    try {
      const nextOffset = Math.max(0, offset - CONVERSATION_PAGE_SIZE)
      const page = await window.openRoom.loadConversation(agentId, activeId, {
        limit: offset - nextOffset,
        offset: nextOffset
      })
      setLoaded((prev) =>
        prev && prev.sessionId === activeId
          ? {
              ...prev,
              offset: page.offset,
              entries: [...wrap(page.messages, page.offset, agentId), ...prev.entries]
            }
          : prev
      )
    } finally {
      fetching.current = false
      setLoadingEarlier(false)
    }
  }, [agentId, activeId, offset, wrap])

  const select = useCallback(
    async (sessionId: string) => {
      if (!agentId) return
      await window.openRoom.selectConversation(agentId, sessionId)
      await refresh()
    },
    [agentId, refresh]
  )

  const startNew = useCallback(async () => {
    if (!agentId) return
    await window.openRoom.newConversation(agentId)
    await refresh()
  }, [agentId, refresh])

  const rename = useCallback(
    async (sessionId: string, title: string) => {
      if (!agentId) return
      await window.openRoom.renameConversation(agentId, sessionId, title)
      await refresh()
    },
    [agentId, refresh]
  )

  const remove = useCallback(
    async (sessionId: string) => {
      if (!agentId) return
      await window.openRoom.deleteConversation(agentId, sessionId)
      await refresh()
    },
    [agentId, refresh]
  )

  const clearAll = useCallback(async () => {
    if (!agentId) return
    await window.openRoom.clearConversations(agentId)
    await refresh()
  }, [agentId, refresh])

  return {
    conversations,
    active,
    history,
    hasEarlier: offset > 0 && total > 0,
    loadingEarlier,
    loadEarlier,
    select,
    startNew,
    rename,
    remove,
    clearAll,
    refresh
  }
}
