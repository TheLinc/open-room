import { useCallback, useEffect, useState } from 'react'
import type { AgentsSnapshot } from '@shared/ipc'

type UseAgents = AgentsSnapshot & {
  loading: boolean
  refresh: () => Promise<void>
}

/**
 * Mirrors the agents on disk. Main owns the data; this only reflects it.
 *
 * Re-reads whenever main reports a change, so edits made to config.json or
 * AGENT.md outside the app appear without a restart.
 */
export function useAgents(): UseAgents {
  const [snapshot, setSnapshot] = useState<AgentsSnapshot>({ agents: [], errors: [] })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const next = await window.openRoom.listAgents()
    setSnapshot(next)
    setLoading(false)
  }, [])

  useEffect(() => {
    // Loading external data on mount is what effects are for, and `refresh`
    // awaits before it sets anything — the lint rule cannot see across the
    // async boundary and assumes the worst.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    return window.openRoom.onAgentsChanged(() => {
      void refresh()
    })
  }, [refresh])

  return { ...snapshot, loading, refresh }
}
