import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArchiveMap } from '@shared/archive'
import { ArchiveSweeper, SWEEP_DELAY_MS, SWEEP_INTERVAL_MS } from './archive-sweeper'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 8, 10, 12)

function sweeper(
  archives: Record<string, ArchiveMap>,
  retentionDays: number
): { sweeper: ArchiveSweeper; removed: string[] } {
  const removed: string[] = []
  const sweeper = new ArchiveSweeper({
    agents: async () => Object.keys(archives),
    archive: { read: async (agentId) => archives[agentId] ?? {} },
    retentionDays: () => retentionDays,
    remove: async (agentId, sessionId) => {
      removed.push(`${agentId}/${sessionId}`)
    },
    now: () => NOW
  })
  return { sweeper, removed }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ArchiveSweeper', () => {
  const archives = {
    atlas: { old: { archivedAt: NOW - 40 * DAY }, fresh: { archivedAt: NOW - DAY } },
    juno: { stale: { archivedAt: NOW - 90 * DAY } }
  }

  it('waits out the launch before its first sweep, then removes what is due', async () => {
    const { sweeper: s, removed } = sweeper(archives, 30)
    s.start()
    await vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS - 1)
    expect(removed).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(removed.sort()).toEqual(['atlas/old', 'juno/stale'])
  })

  it('sweeps again on the interval', async () => {
    const { sweeper: s, removed } = sweeper(archives, 30)
    s.start()
    await vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS + SWEEP_INTERVAL_MS)
    // The same two are due again, since the fake store never forgets them.
    expect(removed).toHaveLength(4)
  })

  it('removes nothing at a retention of never', async () => {
    const { sweeper: s, removed } = sweeper(archives, 0)
    s.start()
    await vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS)
    expect(removed).toEqual([])
  })

  it('keeps going when one removal fails', async () => {
    const removed: string[] = []
    const s = new ArchiveSweeper({
      agents: async () => ['atlas', 'juno'],
      archive: { read: async (agentId) => archives[agentId as keyof typeof archives] },
      retentionDays: () => 30,
      remove: async (agentId, sessionId) => {
        if (agentId === 'atlas') throw new Error('dirty worktree')
        removed.push(`${agentId}/${sessionId}`)
      },
      now: () => NOW
    })
    s.start()
    await vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS)
    expect(removed).toEqual(['juno/stale'])
  })

  it('stops cleanly', async () => {
    const { sweeper: s, removed } = sweeper(archives, 30)
    s.start()
    s.stop()
    await vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS + SWEEP_INTERVAL_MS)
    expect(removed).toEqual([])
  })
})
