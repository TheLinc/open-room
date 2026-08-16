import { useCallback, useEffect, useRef, useState } from 'react'
import {
  emptyRuntime,
  type AgentRuntime,
  type PermissionRequest,
  type TranscriptEntry
} from '@shared/agent-runtime'

/**
 * How many transcript entries are kept mounted per agent.
 *
 * "Chat output is never altered" is a promise about content, not a promise to
 * keep every message in the DOM forever. A long-running agent emits thousands
 * of tool calls, and N agents streaming at once will jank the renderer.
 * Older entries are dropped from the view; the CLI's own transcript on disk
 * remains the complete record.
 */
export const MAX_RETAINED_ENTRIES = 400

export type SessionsApi = {
  runtimeFor: (agentId: string) => AgentRuntime
  entriesFor: (agentId: string) => TranscriptEntry[]
  /** True when entries have been dropped from the head of this transcript. */
  truncatedFor: (agentId: string) => boolean
  permissionsFor: (agentId: string) => PermissionRequest[]
}

type State = {
  runtimes: Record<string, AgentRuntime>
  entries: Record<string, TranscriptEntry[]>
  truncated: Record<string, boolean>
  permissions: PermissionRequest[]
}

const EMPTY_ENTRIES: TranscriptEntry[] = []

export function useSessions(): SessionsApi {
  const [state, setState] = useState<State>({
    runtimes: {},
    entries: {},
    truncated: {},
    permissions: []
  })

  // Streaming appends arrive far faster than React can usefully re-render, so
  // they are batched into one state update per frame.
  const pending = useRef<TranscriptEntry[]>([])
  const frame = useRef<number | null>(null)

  const flush = useCallback(() => {
    frame.current = null
    const batch = pending.current
    if (batch.length === 0) return
    pending.current = []

    setState((prev) => {
      const entries = { ...prev.entries }
      const truncated = { ...prev.truncated }

      for (const entry of batch) {
        const existing = entries[entry.agentId] ?? []
        const next = [...existing, entry]

        if (next.length > MAX_RETAINED_ENTRIES) {
          next.splice(0, next.length - MAX_RETAINED_ENTRIES)
          truncated[entry.agentId] = true
        }
        entries[entry.agentId] = next
      }

      return { ...prev, entries, truncated }
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    void window.openRoom.listRuntimes().then((runtimes) => {
      if (cancelled) return
      setState((prev) => ({
        ...prev,
        runtimes: Object.fromEntries(runtimes.map((r) => [r.agentId, r]))
      }))
    })

    const offRuntime = window.openRoom.onRuntimeChanged((runtime) => {
      setState((prev) => ({
        ...prev,
        runtimes: { ...prev.runtimes, [runtime.agentId]: runtime }
      }))
    })

    const offTranscript = window.openRoom.onTranscriptAppended((entry) => {
      pending.current.push(entry)
      if (frame.current === null) frame.current = requestAnimationFrame(flush)
    })

    const offCleared = window.openRoom.onTranscriptCleared((agentId) => {
      // Anything still queued for this agent belongs to the conversation being
      // left behind, so it is dropped too.
      pending.current = pending.current.filter((entry) => entry.agentId !== agentId)
      setState((prev) => ({
        ...prev,
        entries: { ...prev.entries, [agentId]: [] },
        truncated: { ...prev.truncated, [agentId]: false }
      }))
    })

    const offPermission = window.openRoom.onPermissionRequested((request) => {
      setState((prev) => ({ ...prev, permissions: [...prev.permissions, request] }))
    })

    const offResolved = window.openRoom.onPermissionResolved((requestId) => {
      // Main resolves these on abort and on stop too, not just on an answer,
      // so a stale prompt cannot outlive the turn that raised it.
      setState((prev) => ({
        ...prev,
        permissions: prev.permissions.filter((p) => p.id !== requestId)
      }))
    })

    return () => {
      cancelled = true
      offRuntime()
      offTranscript()
      offCleared()
      offPermission()
      offResolved()
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [flush])

  const runtimeFor = useCallback(
    (agentId: string): AgentRuntime => state.runtimes[agentId] ?? emptyRuntime(agentId),
    [state.runtimes]
  )

  const entriesFor = useCallback(
    (agentId: string): TranscriptEntry[] => state.entries[agentId] ?? EMPTY_ENTRIES,
    [state.entries]
  )

  const truncatedFor = useCallback(
    (agentId: string): boolean => state.truncated[agentId] ?? false,
    [state.truncated]
  )

  const permissionsFor = useCallback(
    (agentId: string): PermissionRequest[] =>
      state.permissions.filter((p) => p.agentId === agentId),
    [state.permissions]
  )

  return { runtimeFor, entriesFor, truncatedFor, permissionsFor }
}
