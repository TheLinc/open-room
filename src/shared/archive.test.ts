import { describe, expect, it } from 'vitest'
import type { Conversation } from './conversation'
import {
  deletionDue,
  describeDeletion,
  latestActive,
  partitionArchived,
  sweepDue,
  type ArchiveMap
} from './archive'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 8, 10, 12)

function conversation(sessionId: string, lastModified: number, archivedAt?: number): Conversation {
  return { sessionId, title: sessionId, lastModified, ...(archivedAt ? { archivedAt } : {}) }
}

describe('deletionDue', () => {
  it('is due once the retention window has passed', () => {
    expect(deletionDue({ archivedAt: NOW - 31 * DAY }, 30, NOW)).toBe(true)
    expect(deletionDue({ archivedAt: NOW - 30 * DAY }, 30, NOW)).toBe(true)
    expect(deletionDue({ archivedAt: NOW - 29 * DAY }, 30, NOW)).toBe(false)
  })

  it('is never due at a retention of zero', () => {
    expect(deletionDue({ archivedAt: NOW - 400 * DAY }, 0, NOW)).toBe(false)
  })
})

describe('sweepDue', () => {
  it('names only the sessions whose window has passed', () => {
    const archive: ArchiveMap = {
      old: { archivedAt: NOW - 40 * DAY },
      recent: { archivedAt: NOW - 2 * DAY },
      edge: { archivedAt: NOW - 30 * DAY }
    }
    expect(sweepDue(archive, 30, NOW).sort()).toEqual(['edge', 'old'])
    expect(sweepDue(archive, 0, NOW)).toEqual([])
  })
})

describe('describeDeletion', () => {
  it('counts down in days, and says today on the last one', () => {
    expect(describeDeletion({ archivedAt: NOW - 60_000 }, 30, NOW)).toBe('Deletes in 30 days')
    expect(describeDeletion({ archivedAt: NOW - 18 * DAY }, 30, NOW)).toBe('Deletes in 12 days')
    expect(describeDeletion({ archivedAt: NOW - 29 * DAY }, 30, NOW)).toBe('Deletes in 1 day')
    expect(describeDeletion({ archivedAt: NOW - 29.5 * DAY }, 30, NOW)).toBe('Deletes today')
    expect(describeDeletion({ archivedAt: NOW - 31 * DAY }, 30, NOW)).toBe('Deletes today')
  })

  it('says so when nothing will delete it', () => {
    expect(describeDeletion({ archivedAt: NOW - DAY }, 0, NOW)).toBe('Kept until you delete it')
  })
})

describe('partitionArchived', () => {
  it('splits the list and orders archived by when they were archived', () => {
    const list = [
      conversation('a', NOW - DAY),
      conversation('b', NOW - 2 * DAY, NOW - 5 * DAY),
      conversation('c', NOW - 3 * DAY, NOW - DAY)
    ]
    const { active, archived } = partitionArchived(list)
    expect(active.map((c) => c.sessionId)).toEqual(['a'])
    expect(archived.map((c) => c.sessionId)).toEqual(['c', 'b'])
  })
})

describe('latestActive', () => {
  it('is the most recent conversation that is not archived', () => {
    const list = [
      conversation('archived-newest', NOW, NOW - DAY),
      conversation('live', NOW - DAY),
      conversation('older', NOW - 2 * DAY)
    ]
    expect(latestActive(list)).toBe('live')
  })

  it('is null when every conversation is archived', () => {
    expect(latestActive([conversation('x', NOW, NOW - DAY)])).toBeNull()
    expect(latestActive([])).toBeNull()
  })
})
